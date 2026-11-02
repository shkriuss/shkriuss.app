/**
 * Uploading an app's scheduled notifications, and whether the server has
 * them (./client.ts loads this when it's first needed: the switch itself,
 * ./device.ts, is all a page needs to open).
 *
 * Every message is encrypted here, to this device's own subscription, before
 * it's uploaded.
 */
import { fromBase64Url, toBase64Url } from './base64.ts';
import {
  api,
  disablePush,
  finishPushDelete,
  isPushDeletePending,
  load,
  noteDelete,
  PushError,
  registration,
  startUpload,
  store,
  subscribe,
  type DeviceState,
  type Synced,
  type SyncedEntry,
} from './device.ts';
import { encryptPayload, MAX_PLAINTEXT_BYTES } from './encrypt.ts';
import { dueBetween, nextOccurrence, REPEATS, wallOf, type Repeat } from './schedule.ts';
import { LIMITS, timingProblem } from './validate.ts';

/** Re-upload at least this often, even if nothing changed (keeps the server's copy fresh). */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * In between, ask at most this often whether the server still has this
 * device: it forgets one whose push service said its subscription is gone,
 * or that hasn't had a message through for two days, and nothing else tells
 * the device (audit 4 F1-2). Only asked when the app is used.
 */
const CHECK_MS = 24 * 60 * 60 * 1000;

/** Whether the server still has this device; null if that can't be told now. */
async function serverHas(deviceKey: string): Promise<boolean | null> {
  const response = await api('/schedule', { method: 'GET' }, deviceKey).catch(() => null);
  if (response?.ok) return true;
  return response?.status === 404 ? false : null;
}

/** One scheduled notification, in the app's own local time. */
export interface Notice {
  /** Unique within the app, e.g. an event id. It stays on the device. */
  id: string;
  /** When the thing starts, local time "YYYY-MM-DDTHH:MM". */
  start: string;
  repeat: Repeat;
  /** The last day it may start on, "YYYY-MM-DD", or null. */
  until: string | null;
  /** Minutes before the start to notify (negative = after). */
  offset: number;
  title: string;
  body: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
  /** Page to open when it's tapped (this app's own path). */
  url?: string;
}

/** Characters as people see them, where the browser can tell (not Firefox before 125). */
const characters =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

/**
 * At most `length` JavaScript characters of `text` (what fits in the
 * message), cut between characters as people see them: a flag, a family or
 * any emoji cut in two showed as half of it, or as "�" (audit 4 F3-4).
 */
export function cutText(text: string, length: number): string {
  if (text.length <= length) return text;
  if (!characters) {
    // At least never half of an emoji's two halves.
    const last = text.charCodeAt(length - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? length - 1 : length);
  }
  let end = 0;
  for (const { segment } of characters.segment(text)) {
    if (end + segment.length > length) break;
    end += segment.length;
  }
  return text.slice(0, end);
}

/** Cuts text so the encrypted message fits (push services take 4 KB). */
export function messageOf(
  notice: Pick<Notice, 'title' | 'body' | 'tag' | 'url'>,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const message = {
    title: cutText(notice.title, 200),
    body: cutText(notice.body, 500),
    tag: notice.tag,
    url: notice.url,
  };
  const bytes = encoder.encode(JSON.stringify(message));
  return bytes.length <= MAX_PLAINTEXT_BYTES
    ? bytes
    : encoder.encode(JSON.stringify({ ...message, body: '' }));
}

/** A short fingerprint of some text or bytes: the first 72 bits of their SHA-256. */
async function fingerprint(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(new Uint8Array(digest, 0, 9));
}

/** Which reminder a notification is, as an open app knows it too: its tag and title. */
const reminderOf = (tag: string | undefined, title: string): Promise<string> =>
  fingerprint(JSON.stringify([tag ?? null, title]));

const timeZoneNow = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Runs `work` in one tab at a time, where the browser can say so (Web Locks). */
function oneTabAtATime<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = (navigator as Partial<Navigator>).locks;
  return locks ? locks.request(name, work) : work();
}

/**
 * Makes sure the subscription is still the one we know (browsers can renew
 * it) and returns the current device state, or null if push is off.
 */
async function current(): Promise<DeviceState | null> {
  const state = load();
  if (!state) return null;
  // Turned off in the browser's or the phone's settings: forget it here and
  // on the server. Checked first, whatever the subscription: a browser may
  // keep it while notifications are blocked (perhaps Safari on an iPhone),
  // and the schedule would go up again instead (audit 4 D-6).
  if (Notification.permission !== 'granted') {
    await disablePush();
    return null;
  }
  const subscription = await (await registration()).pushManager.getSubscription();
  if (subscription?.endpoint === state.endpoint) return state;
  // Turned off meanwhile (here or in another tab): it stays off (audit 3 D-1).
  if (load()?.deviceKey !== state.deviceKey) return null;
  await subscribe(state.deviceKey);
  return load();
}

/** What an upload left on the server: how many notifications, and how many more didn't fit. */
export interface PushSynced {
  scheduled: number;
  /** Upcoming ones the server doesn't have (more than it keeps): only an open app shows them. */
  left: number;
}

const NONE: PushSynced = { scheduled: 0, left: 0 };

/** A notification still to come: when it's next due, and the message the server sends. */
interface Coming {
  notice: Notice;
  next: { moment: number; start: string };
  message: Uint8Array<ArrayBuffer>;
  /** A fingerprint of `message`. */
  print: string;
}

/**
 * What syncPush uploads for these notices at `now`: the ones that will still
 * happen, soonest first, up to the server's limit (`coming`); and the rest
 * still to come (`later`), which the server can't have.
 */
async function scheduleOf(notices: readonly Notice[], now: number) {
  const timeZone = timeZoneNow();
  const later: Notice[] = [];
  const soonest = notices
    .flatMap((notice) => {
      // Any the server would turn down stays here, so one odd reminder can't stop the rest.
      if (timingProblem(notice) !== undefined) {
        later.push(notice);
        return [];
      }
      const next = nextOccurrence(notice, timeZone, now);
      return next === null ? [] : [{ notice, next }];
    })
    .sort((a, b) => a.next.moment - b.next.moment);
  later.push(...soonest.splice(LIMITS.entries).map((item) => item.notice));
  const coming: Coming[] = await Promise.all(
    soonest.map(async (item) => {
      const message = messageOf(item.notice);
      return { ...item, message, print: await fingerprint(message) };
    }),
  );
  return { timeZone, coming, later };
}

type Schedule = Awaited<ReturnType<typeof scheduleOf>>;

const isSyncedEntry = (value: unknown): value is SyncedEntry =>
  Array.isArray(value) &&
  value.length === 6 &&
  typeof value[0] === 'string' &&
  REPEATS.includes(value[1] as Repeat) &&
  (value[2] === null || typeof value[2] === 'string') &&
  Number.isFinite(value[3]) &&
  typeof value[4] === 'string' &&
  typeof value[5] === 'string';

/** The notifications the last upload left on the server, or null if that isn't known here. */
function entriesOf(synced: Synced | undefined): SyncedEntry[] | null {
  const entries: unknown = synced?.entries;
  return Array.isArray(entries) && entries.every(isSyncedEntry) ? entries : null;
}

/**
 * A notification as the server sends it from now on: a repeating one as
 * starting at its next time.
 */
const lineOf = (
  { repeat, until, offset }: { repeat: Repeat; until: string | null; offset: number },
  nextStart: string,
  message: string,
): string => JSON.stringify([nextStart, repeat, until, offset, message]);

/**
 * How many notifications still to come the server has, if they're just what
 * uploading `coming` would give it now; null if not, or if that can't be
 * told (another time zone, or noted by an older version). Both as they are
 * from now on: so the same reminders worked out from another day (Habits and
 * Water start each week's or day's from today) are the same, and so is a
 * reminder an app no longer lists once it's due (Meals). Taken for a change,
 * that showed a reminder twice (audit 4 F1-5).
 */
function sameOnServer(
  synced: Synced,
  coming: readonly Coming[],
  timeZone: string,
  now: number,
): number | null {
  const entries = entriesOf(synced);
  if (!entries || synced.timeZone !== timeZone) return null;
  const theirs = entries.flatMap(([start, repeat, until, offset, , message]) => {
    const next = nextOccurrence({ start, repeat, until, offset }, timeZone, now);
    return next === null ? [] : [lineOf({ repeat, until, offset }, next.start, message)];
  });
  // As many as it took, when very long texts left out some (`more`). Once
  // some are over, the next ones are added: so the server's 500 move on as
  // time passes (audit 3 F1-5).
  const ours = (synced.more ? coming.slice(0, entries.length) : coming).map(
    ({ notice, next, print }) => lineOf(notice, next.start, print),
  );
  theirs.sort();
  ours.sort();
  const same = theirs.length === ours.length && theirs.every((line, index) => line === ours[index]);
  return same ? theirs.length : null;
}

/**
 * Which of the reminders an open app found due after `from` and up to `to`
 * (its local times, "YYYY-MM-DDTHH:MM") the notification service sends, so
 * the app mustn't show them a second time: a test of a reminder's tag. It
 * sends one if the last upload that got through has it (the same tag and
 * title) due at that time on the clock, and had it before it was due.
 * Reminder by reminder: so one worked out again from a new day, or no longer
 * listed once it's due, still counts (audit 4 F1-5).
 *
 * None while push is off, and not one changed since in a way that couldn't
 * be uploaded (say, offline): then nothing would send it as it is now, so
 * the open app shows it itself (audit F1-7). Nor those that didn't fit on
 * the server (audit 3 F1-5).
 */
export async function pushHolds(
  due: readonly { tag: string; title: string }[],
  window: { from: string; to: string },
): Promise<(tag: string) => boolean> {
  const synced = load()?.synced;
  const entries = entriesOf(synced);
  const timeZone = timeZoneNow();
  const from = wallOf(window.from);
  const to = wallOf(window.to);
  if (!synced || !entries || synced.timeZone !== timeZone || from === null || to === null) {
    return () => false;
  }
  const tags = new Map<string, string>();
  for (const { tag, title } of due) tags.set(await reminderOf(tag, title), tag);
  const held = new Set<string>();
  for (const [start, repeat, until, offset, reminder] of entries) {
    const tag = tags.get(reminder);
    if (tag === undefined || held.has(tag)) continue;
    // The server works out each time when it's uploaded: one due before that, it doesn't send.
    const moments = dueBetween({ start, repeat, until, offset }, timeZone, from, to);
    if (moments.some((moment) => moment > synced.at)) held.add(tag);
  }
  return (tag) => held.has(tag);
}

/**
 * Whether the server still has this device ('kept'); if it forgot it, a new
 * subscription in place of the one it forgot ('forgotten'), and the
 * schedule goes up again. Asked in one tab at a time, so two tabs finding
 * it forgotten at once don't both subscribe again, one undoing the other's
 * (audit 4 F1-2).
 */
function checkServer(
  deviceKey: string,
  synced: Synced,
  now: number,
): Promise<'off' | 'kept' | 'forgotten'> {
  return oneTabAtATime('shkriuss-push-check', async () => {
    const latest = load();
    if (latest?.deviceKey !== deviceKey) return 'off';
    // Asked, or uploaded again, in another tab meanwhile.
    if (latest.synced?.at !== synced.at || latest.synced.checked !== synced.checked) return 'kept';
    const kept = await serverHas(deviceKey);
    const after = load();
    if (after?.deviceKey !== deviceKey) return 'off';
    if (kept !== false) {
      // Noted for the upload it was asked about, not one another tab made meanwhile.
      if (kept && after.synced?.at === synced.at) {
        store({ ...after, synced: { ...after.synced, checked: now } });
      }
      return 'kept';
    }
    // Forgotten there, though it has reminders to send: a new subscription
    // (the push service may have said the old one is gone), and the schedule
    // again. Until it's up, nothing says the server has them (pushHolds).
    const { synced: _forgotten, ...forgotten } = after;
    store(forgotten);
    await subscribe(deviceKey, after.endpoint);
    return 'forgotten';
  });
}

/**
 * Uploads the app's scheduled notifications (replacing earlier ones). Skips
 * the upload when the server sends the same from now on. Says how many are
 * scheduled, and how many more didn't fit (audit 3 F1-5).
 */
export async function syncPush(
  notices: readonly Notice[],
  options: { force?: boolean } = {},
): Promise<PushSynced> {
  // An earlier copy still on the server (turned off while offline) would send twice.
  if (isPushDeletePending()) await finishPushDelete();
  let state = await current();
  if (!state) return NONE;
  const now = Date.now();
  const schedule = await scheduleOf(notices, now);
  const { coming, later } = schedule;
  const { synced } = state;
  const kept =
    !options.force && synced && now - synced.at < REFRESH_MS
      ? sameOnServer(synced, coming, schedule.timeZone, now)
      : null;
  if (synced && kept !== null) {
    const unchanged = { scheduled: kept, left: coming.length - kept + later.length };
    if (kept === 0 || now - (synced.checked ?? synced.at) < CHECK_MS) return unchanged;
    const found = await checkServer(state.deviceKey, synced, now);
    if (found === 'off') return NONE;
    if (found === 'kept') return unchanged;
    const latest = load();
    if (latest?.deviceKey !== state.deviceKey) return NONE;
    state = latest;
  }
  return uploadSchedule(state, schedule);
}

/** Uploads `schedule`, and notes what the server took. */
async function uploadSchedule(
  state: DeviceState,
  { timeZone, coming, later }: Schedule,
): Promise<PushSynced> {
  // disablePush() waits for this upload, so the server gets its deletion last (audit 3 D-1).
  const done = startUpload();
  let sent = false;
  try {
    const target = { p256dh: fromBase64Url(state.p256dh), auth: fromBase64Url(state.auth) };
    const entries = [];
    const noted: SyncedEntry[] = [];
    let payloadsLength = 0;
    for (const [index, { notice, message, print }] of coming.entries()) {
      const payload = toBase64Url(await encryptPayload(message, target));
      // Only as many as the server can keep (very long texts make big messages).
      payloadsLength += payload.length;
      if (payloadsLength > LIMITS.payloadsLength) break;
      const { start, repeat, until, offset } = notice;
      // A number, never the app's own id: an imported event's id can say where it came from.
      entries.push({ id: String(index + 1), start, repeat, until, offset, payload });
      noted.push([start, repeat, until, offset, await reminderOf(notice.tag, notice.title), print]);
    }
    // Turned off meanwhile: nothing to send.
    if (load()?.deviceKey !== state.deviceKey) return NONE;
    sent = true;
    const response = await api(
      '/schedule',
      {
        method: 'PUT',
        body: JSON.stringify({ endpoint: state.endpoint, timeZone, entries }),
        // Finishes even if the app is closed meanwhile (audit 7 Z-1).
        keepalive: true,
      },
      state.deviceKey,
    );
    if (!response.ok)
      throw new PushError('refused', 'The notification service didn’t accept the update.');
    // Saved only while it's still on with this device key.
    const latest = load();
    if (latest?.deviceKey !== state.deviceKey) return NONE;
    // Taken by now: the server doesn't send what was due before (pushHolds).
    const more = entries.length < coming.length;
    const synced: Synced = { at: Date.now(), timeZone, entries: noted, more };
    // No room to note it: then nothing says what the server has, rather than an older upload.
    if (!store({ ...latest, synced })) {
      const { synced: _older, ...unknown } = latest;
      store(unknown);
    }
    return { scheduled: entries.length, left: coming.length - entries.length + later.length };
  } finally {
    // Turned off while it was on its way (here, in another tab, or by "Delete
    // all data"): what it may have put back on the server is deleted again,
    // after it, whether its answer came or not (audit 3 D-1).
    if (sent && load()?.deviceKey !== state.deviceKey) {
      noteDelete(state.deviceKey);
      await finishPushDelete(state.deviceKey);
    }
    done();
  }
}

/** Sends one notification to this device right now. */
export async function sendTestPush(title: string, body: string): Promise<void> {
  const state = await current();
  if (!state) throw new PushError('unsupported', 'Notifications while closed are off.');
  const target = { p256dh: fromBase64Url(state.p256dh), auth: fromBase64Url(state.auth) };
  const payload = toBase64Url(
    await encryptPayload(messageOf({ title, body, tag: 'test', url: '/' }), target),
  );
  const response = await api(
    '/test',
    { method: 'POST', body: JSON.stringify({ endpoint: state.endpoint, payload }) },
    state.deviceKey,
  );
  if (!response.ok) throw new PushError('refused', 'The test notification couldn’t be sent.');
}
