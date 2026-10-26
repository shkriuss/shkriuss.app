/**
 * Reminders while an app is open, shared by the apps with reminders (audit
 * J-6). Every 20 seconds it asks the app what's due, reads it out on the
 * page, and shows it as a notification if the person allowed them. After
 * the page slept, only reminders a few minutes late are shown; when the
 * clocks change, ones in the skipped hour go off as they do
 * (../lib/reminder-window.ts). The app's open tabs share their last check,
 * so each reminder shows as a notification once, not once in each; each tab
 * on screen reads it out itself. It keeps
 * the "Notifications are …" line and the "Turn on notifications" button
 * (`[data-notify-status]`, `[data-notify-enable]`) right, and mounts
 * "Also remind me when … is closed" (./push-controls.ts, docs/adr/0009):
 * when that's on, the notification service sends them instead, as long as
 * it has them as they are now (pushHolds).
 *
 *   const reminders = mountLocalReminders(document, {
 *     app: 'Habits',
 *     due: (from, to) => dueReminders(habits(), from, to).map((habit) => ({
 *       title: habit.name, tag: habit.id, body: REMINDER_BODY,
 *     })),
 *     notices: () => reminderNotices(habits(), today()),
 *     announce,
 *   });
 *   reminders.changed();   // after every change: uploads the schedule again, if that's on
 *
 * Each app keeps its own rules for what's due (src/lib, unit-tested).
 * Calendar, which lists reminders on its page and shows ones missed while it
 * was closed, uses the parts: mountNotificationStatus() and
 * showNotifications().
 */
import { nowStamp, type Stamp } from '@shkriuss/dates';
import { pushHolds, type Notice } from '@shkriuss/push';
import { reminderWindow, type ReminderCheck } from '../lib/reminder-window.ts';
import { mountPushControls } from './push-controls.ts';
import { required } from './dom.ts';

export { MAX_SUMMER_TIME_MINUTES } from '../lib/reminder-window.ts';

const CHECK_EVERY_MS = 20_000;
/**
 * How far apart two tabs' clocks can read at once: some browsers blur the
 * time a page reads, for privacy. A check another tab made up to this much
 * "later" than now is one it made just before.
 */
const CLOCK_BLUR_MS = 1_000;
/**
 * The last check, shared by the app's open tabs, so a reminder rings once,
 * not once in each (audit 4 F1-6), as in Calendar. On this device only.
 */
const CHECKED_KEY = 'shkriuss-device:reminders-checked';
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function loadChecked(): ReminderCheck | null {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? 'null') as {
      stamp?: unknown;
      at?: unknown;
    } | null;
    const { stamp, at } = value ?? {};
    return typeof stamp === 'string' && STAMP_PATTERN.test(stamp) && typeof at === 'number'
      ? { stamp, at }
      : null;
  } catch {
    return null;
  }
}

function saveChecked(check: ReminderCheck): void {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(check));
  } catch {
    // Storage blocked or full: each tab goes by its own checks.
  }
}

/**
 * How long a tab keeps its turn after a check: another tab's copy of
 * storage can take a moment to show the check it saved, and a tab that
 * checked straight after (as all do when a phone wakes) showed the same
 * reminders again.
 */
const SETTLE_MS = 250;
/** How long a tab waits for its turn at most: one put to sleep during its turn would stop the others' checks. */
const WAIT_MS = 2_000;

/**
 * Runs `work` in one tab at a time, where the browser can say so (Web
 * Locks); in this tab alone when its turn doesn't come in time.
 */
function oneTabAtATime(work: () => void): void {
  const locks = (navigator as Partial<Navigator>).locks;
  if (!locks) {
    work();
    return;
  }
  locks
    .request('shkriuss-reminders-check', { signal: AbortSignal.timeout(WAIT_MS) }, async () => {
      work();
      await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'TimeoutError') work();
    });
}

/** One notification that's due. */
export interface DueReminder {
  title: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
  body?: string;
}

export interface LocalRemindersOptions {
  /** The app's name, for the status line ("Notifications are blocked for Habits."). */
  app: string;
  /** What's due after `from`, up to and including `to`. */
  due: (from: Stamp, to: Stamp) => readonly DueReminder[];
  /** The app's notifications as they are now, for the notification service. */
  notices: () => Notice[];
  announce: (message: string) => void;
  /** What notifications bring, in "Turn them on to get …" (default "reminders"). */
  what?: string;
  /** What's read out when something's due (default "Reminder: <titles>."). */
  spoken?: (due: readonly DueReminder[]) => string;
}

export interface LocalReminders {
  /** After the app's data changed (uploads the schedule again, if that's on). */
  changed(): void;
  /** Asks to show notifications if the person hasn't been asked. Call it from a tap. */
  offerNotifications(): void;
}

export type Permission = NotificationPermission | 'unsupported';

export const permission = (): Permission =>
  'Notification' in window ? Notification.permission : 'unsupported';

/** The status line for each permission. */
export function statusTexts(app: string, what = 'reminders'): Record<Permission, string> {
  return {
    unsupported: `This browser can’t show notifications. On iPhone or iPad, add ${app} to your Home Screen to get them.`,
    default: `Notifications are off. Turn them on to get ${what}.`,
    granted: 'Notifications are on.',
    denied: `Notifications are blocked for ${app}. To allow them, change this site’s settings in your browser.`,
  };
}

export interface NotificationStatus {
  /** Draws the status line and the button again (after permission may have changed). */
  render(): void;
  /** Asks to show notifications if the person hasn't been asked. Call it from a tap. */
  offer(): void;
}

/**
 * The "Notifications are …" line (`[data-notify-status]`, in `texts` for
 * each permission) and the "Turn on notifications" button
 * (`[data-notify-enable]`), kept right when notifications are allowed or
 * blocked in the browser's settings.
 */
export function mountNotificationStatus(
  root: Document,
  texts: Record<Permission, string>,
  announce: (message: string) => void,
): NotificationStatus {
  const status = required<HTMLElement>(root, '[data-notify-status]');
  const enable = required<HTMLElement>(root, '[data-notify-enable]');

  function render(): void {
    const current = permission();
    status.textContent = texts[current];
    enable.hidden = current !== 'default';
  }

  function offer(): void {
    if (permission() !== 'default') return;
    Notification.requestPermission().then(
      () => {
        const hadFocus = enable.contains(root.activeElement);
        render();
        // The button is gone now; keep keyboard focus nearby. Moving focus
        // there reads the line out, so it isn't announced as well (audit 3 G-11).
        if (hadFocus && enable.hidden) {
          status.tabIndex = -1;
          status.focus();
        } else if (permission() === 'granted') announce('Notifications are on.');
      },
      () => undefined,
    );
  }

  required<HTMLButtonElement>(enable, '[data-action="enable-notifications"]').addEventListener(
    'click',
    offer,
  );
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'notifications' }).then(
      (result) => result.addEventListener('change', render),
      () => undefined,
    );
  }
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') render();
  });
  render();
  return { render, offer };
}

/**
 * Shows reminders that are due (after `window.from` and up to `window.to`,
 * local times) as notifications, if the person allowed them. With "Also
 * remind me when … is closed" on, the notification service sends them
 * instead, so they don't show twice; unless it doesn't have them as they are
 * now, say after a change made offline: then nothing else would show them
 * (audit F1-7). Nor does it have those that didn't fit on it (more than
 * 500): those show here too (audit 3 F1-5).
 */
export async function showNotifications(
  due: readonly DueReminder[],
  window: { from: Stamp; to: Stamp },
): Promise<void> {
  if (permission() !== 'granted') return;
  const held = await pushHolds(due, window).catch(() => () => false);
  const shown = due.filter((item) => !held(item.tag));
  if (shown.length === 0) return;
  // Phones only show notifications through the service worker.
  const registration =
    'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
      : undefined;
  for (const item of shown) {
    // A repeat replaces the one before it with the same tag, and still rings
    // or buzzes (audit 3 F1-1). Chrome refuses renotify without a tag.
    const shown: NotificationOptions & { renotify?: boolean } = {
      tag: item.tag,
      renotify: Boolean(item.tag),
      icon: '/icon-192.png',
    };
    if (item.body !== undefined) shown.body = item.body;
    try {
      if (registration) await registration.showNotification(item.title, shown);
      else new Notification(item.title, shown);
    } catch {
      // It's read out on the page too.
    }
  }
}

export function mountLocalReminders(
  root: Document,
  options: LocalRemindersOptions,
): LocalReminders {
  const spoken =
    options.spoken ??
    ((due: readonly DueReminder[]) => `Reminder: ${due.map((item) => item.title).join(', ')}.`);
  /**
   * Reminders up to this local time have been checked, then (see
   * ../lib/reminder-window.ts), for notifications, by this tab. A later
   * check by another tab counts too (loadChecked).
   */
  let checked: ReminderCheck = { stamp: nowStamp(), at: Date.now() };
  /** And for reading out, by this tab alone. */
  let said: ReminderCheck = checked;

  const status = mountNotificationStatus(
    root,
    statusTexts(options.app, options.what),
    options.announce,
  );
  const push = mountPushControls(required<HTMLElement>(root, '[data-push-controls]'), {
    notices: options.notices,
    onChange: status.render,
  });

  /**
   * Reads out what's due in each tab on screen, by its own checks: the tab
   * that checks first, for notifications, may be a hidden one, where it
   * isn't heard (audit 4 F1-6). A hidden tab checks too, without a word, so
   * it doesn't say it again when it's back on screen.
   */
  function say(): void {
    const now = { stamp: nowStamp(), at: Date.now() };
    // After sleep, only reminders a few minutes late; after the clocks
    // changed, every time they skipped (audit F1-6).
    const window = reminderWindow(said, now);
    if (!window) return;
    said = now;
    if (root.visibilityState !== 'visible') return;
    const due = options.due(window.from, window.to);
    if (due.length > 0) options.announce(spoken(due));
  }

  /** Shows what's due as notifications, in whichever of the app's tabs checks first. */
  function notify(): void {
    const now = { stamp: nowStamp(), at: Date.now() };
    const shared = loadChecked();
    const last =
      shared && shared.at > checked.at && shared.at <= now.at + CLOCK_BLUR_MS ? shared : checked;
    const window = reminderWindow(last, now);
    if (!window) return;
    checked = now;
    saveChecked(now);
    const due = options.due(window.from, window.to);
    if (due.length > 0) void showNotifications(due, window);
  }

  window.setInterval(() => {
    say();
    oneTabAtATime(notify);
  }, CHECK_EVERY_MS);
  return { changed: push.sync, offerNotifications: status.offer };
}
