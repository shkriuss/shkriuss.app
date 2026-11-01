/**
 * The account on this device: the secret, kept in this browser's storage for
 * the hub only. It's under "shkriuss-device:", so it's never in backups.
 *
 * It also keeps account keys this device replaced. When an app connects, it
 * gets its keys from those too, so it can move its old online copy to the
 * new key (packages/sync). Each comes with a tag for the key that replaced
 * it (successorTag), so they're kept only when this device signs in to that
 * account: another account mustn't get this one's old data (audit A-3). A
 * device signed out because its key was replaced elsewhere keeps nothing,
 * as if it had signed out (forgetReplaced, audit 3 D-8). Each is kept for
 * 13 months from when it was noted (REPLACED_NOTE_MS), as long as the
 * account service keeps its note: after that, the "moved" notes on the
 * apps' old copies may be gone too, and a copy a lost device started with
 * the old key would have come along (audit 5 A-1). While it replaces its
 * key, it keeps the new one too (noteReplacing), in case the account
 * service's answer is lost (audit 6 A-1).
 *
 * And it keeps which apps this device turned on sync for, so the Account
 * page can offer to turn it off again (see `syncedApps`).
 */
import { fromBase64Url, toBase64Url } from '@shkriuss/crypto';
import { accountCodeOf, SECRET_BYTES, successorTag } from './secret.ts';
import { REPLACED_NOTE_MS } from './validate.ts';

const STORAGE_KEY = 'shkriuss-device:account';
const SYNCED_KEY = 'shkriuss-device:synced-apps';
/** Replaced keys kept, newest first. */
const MAX_REPLACED = 5;

export interface Account {
  secret: Uint8Array<ArrayBuffer>;
  /** e.g. "K7Q2-M9XD" */
  code: string;
  /** When this device signed in (ISO date). */
  since: string;
}

interface Saved {
  secret?: string;
  since?: string;
  /**
   * The key this device is replacing `secret` with, from just before it
   * tells the account service until it signs in with it (noteReplacing).
   */
  next?: string;
  replaced: string[];
  /** For a replaced key, the tag of the key that replaced it (when known). */
  successors: Record<string, string>;
  /**
   * For a replaced key, when it was noted here (ms). Missing for keys noted
   * before this was kept: they count from the next sign-in or replacement,
   * which notes the time.
   */
  replacedAt: Record<string, number>;
}

const EMPTY: Saved = { replaced: [], successors: {}, replacedAt: {} };

/** The entries of `value` whose values `keep` accepts, if it's a plain object. */
function entriesOf<T>(value: unknown, keep: (entry: unknown) => entry is T): Record<string, T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, T] => keep(entry[1])),
  );
}

function read(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return EMPTY;
    const { secret, since, next, replaced, successors, replacedAt } = value as Record<
      string,
      unknown
    >;
    return {
      ...(typeof secret === 'string' && typeof since === 'string' ? { secret, since } : {}),
      ...(typeof next === 'string' ? { next } : {}),
      replaced: Array.isArray(replaced)
        ? replaced.filter((key): key is string => typeof key === 'string')
        : [],
      successors: entriesOf(successors, (tag): tag is string => typeof tag === 'string'),
      replacedAt: entriesOf(replacedAt, (time): time is number => typeof time === 'number'),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * `saved` without the replaced keys noted more than REPLACED_NOTE_MS ago,
 * and with the time noted for those that have none yet (`now`). Only the
 * keys listed in `keys` (the replaced keys to keep, newest first) stay.
 */
function withFreshReplaced(saved: Saved, keys: readonly string[], now: number): Saved {
  const replaced = keys.filter((key) => (saved.replacedAt[key] ?? now) > now - REPLACED_NOTE_MS);
  return {
    ...saved,
    replaced,
    successors: Object.fromEntries(
      replaced.flatMap((key) => {
        const tag = saved.successors[key];
        return tag === undefined ? [] : [[key, tag]];
      }),
    ),
    replacedAt: Object.fromEntries(replaced.map((key) => [key, saved.replacedAt[key] ?? now])),
  };
}

function write(saved: Saved): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const secret = fromBase64Url(text);
    return secret.length === SECRET_BYTES ? secret : null;
  } catch {
    return null;
  }
}

/** The account this device is signed in to, or null. */
export async function currentAccount(): Promise<Account | null> {
  const { secret: text, since } = read();
  const secret = text === undefined ? null : decode(text);
  if (!secret || since === undefined) return null;
  return { secret, code: await accountCodeOf(secret), since };
}

/**
 * The replaced keys that led to `secret`: replaced by it, or by a key that
 * was (a key replaced twice). Keys with no tag, or another account's, aren't.
 */
async function leadingTo(secret: Uint8Array<ArrayBuffer>, saved: Saved): Promise<string[]> {
  const leads = new Set<string>();
  let reached = [secret];
  while (reached.length > 0) {
    const next: Uint8Array<ArrayBuffer>[] = [];
    for (const key of saved.replaced) {
      const old = leads.has(key) ? null : decode(key);
      const tag = saved.successors[key];
      if (!old || tag === undefined) continue;
      for (const successor of reached) {
        if ((await successorTag(old, successor)) === tag) {
          leads.add(key);
          next.push(old);
          break;
        }
      }
    }
    reached = next;
  }
  return saved.replaced.filter((key) => leads.has(key));
}

/**
 * Signs this device in. Replaced keys are kept only if they led to this
 * account. Returns false if the browser won't store it.
 */
export async function saveAccount(
  secret: Uint8Array<ArrayBuffer>,
  now = new Date(),
): Promise<boolean> {
  const saved = read();
  // Signed in: a replacement this device had under way (`next`) is over.
  const { replaced, successors, replacedAt } = withFreshReplaced(
    saved,
    await leadingTo(secret, saved),
    now.getTime(),
  );
  return write({
    replaced,
    successors,
    replacedAt,
    secret: toBase64Url(secret),
    since: now.toISOString(),
  });
}

/**
 * Notes, before the account service is told, that this device is replacing
 * its key `current` with `next`. The service may note the old key as
 * replaced while its answer is lost (the connection drops, or the page is
 * closed): without this, the next visit took this device for a lost one,
 * signed it out and forgot the old key, so no app could move its old copy
 * any more (audit 6 A-1). With it, the next visit finishes the replacement
 * (finishReplacing in ./status.ts). The person has saved `next`'s recovery
 * key by then.
 */
export function noteReplacing(
  current: Uint8Array<ArrayBuffer>,
  next: Uint8Array<ArrayBuffer>,
): void {
  const saved = read();
  if (saved.secret !== toBase64Url(current)) return;
  write({ ...saved, next: toBase64Url(next) });
}

/** The key this device was replacing `account`'s with (noteReplacing), if it hasn't signed in with it yet. */
export function replacingWith(account: Account): Uint8Array<ArrayBuffer> | null {
  const { secret, next } = read();
  if (secret !== toBase64Url(account.secret) || next === undefined) return null;
  return decode(next);
}

/**
 * Remembers that an account key was replaced, and the tag of the key that
 * replaced it (null if not known). If this device is signed in with it, it's
 * signed out.
 */
export function noteReplaced(
  secret: Uint8Array<ArrayBuffer>,
  successor: string | null,
  now = Date.now(),
): void {
  const text = toBase64Url(secret);
  const saved = read();
  const noted = {
    ...saved,
    successors: successor ? { ...saved.successors, [text]: successor } : saved.successors,
    replacedAt: { ...saved.replacedAt, [text]: now },
  };
  const keys = [text, ...saved.replaced.filter((key) => key !== text)].slice(0, MAX_REPLACED);
  const fresh = withFreshReplaced(noted, keys, now);
  const { replaced, successors, replacedAt } = fresh;
  // Signed in with the replaced key: signed out.
  write(saved.secret === text ? { replaced, successors, replacedAt } : fresh);
}

/** Account keys this device knows were replaced, newest first (for 13 months each). */
export function replacedSecrets(now = Date.now()): Uint8Array<ArrayBuffer>[] {
  const saved = read();
  return withFreshReplaced(saved, saved.replaced, now)
    .replaced.map(decode)
    .filter((secret) => secret !== null);
}

// ---------- Apps that sync on this device ----------

interface SyncedApp {
  app: string;
  /** The account code it was turned on with. */
  code: string;
  /** The app's address it was turned on at. */
  origin: string;
}

function readSynced(): SyncedApp[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is SyncedApp =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SyncedApp).app === 'string' &&
        typeof (entry as SyncedApp).code === 'string' &&
        typeof (entry as SyncedApp).origin === 'string',
    );
  } catch {
    return [];
  }
}

function writeSynced(synced: SyncedApp[]): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(synced));
  } catch {
    // Storage blocked: the Account page just offers "Turn on sync" again.
  }
}

/**
 * The apps this device turned on sync for with the account `code`: slug →
 * the app's address. Apps are other sites, so the hub can't look inside
 * them; this is what it remembers from turning sync on and off here. Turned
 * off inside an app, an app stays in this list until it's turned off here.
 */
export function syncedApps(code: string): Map<string, string> {
  return new Map(
    readSynced()
      .filter((entry) => entry.code === code)
      .map((entry) => [entry.app, entry.origin]),
  );
}

/** Remembers that `app`, at `origin`, now syncs with the account `code` on this device. */
export function noteSyncOn(app: string, code: string, origin: string): void {
  writeSynced([...readSynced().filter((entry) => entry.app !== app), { app, code, origin }]);
}

/** Remembers that `app` no longer syncs on this device. */
export function noteSyncOff(app: string): void {
  writeSynced(readSynced().filter((entry) => entry.app !== app));
}

/** Signs this device out (forgets the secret here only, any replaced keys, and synced apps). */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SYNCED_KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}

/**
 * Signs this device out because its account key was replaced on another
 * device (a lost one), forgetting what signing out forgets: the key and
 * which apps turned on sync here. That page has no "Sign out" to tap, and
 * only the device that replaced the key needs the old one, to move the
 * apps' copies (audit 3 D-8). Returns the apps that synced here with it:
 * each keeps its own key, and syncs with the old one until sync is turned
 * on in it again. Null, and nothing changes, if this device is signed in
 * with another key by now (in another tab).
 */
export function forgetReplaced(account: Account): string[] | null {
  if (read().secret !== toBase64Url(account.secret)) return null;
  const apps = [...syncedApps(account.code).keys()];
  forgetAccount();
  return apps;
}
