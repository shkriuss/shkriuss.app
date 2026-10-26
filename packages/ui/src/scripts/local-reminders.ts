/**
 * Reminders while an app is open, shared by the apps with reminders (audit
 * J-6). Every 20 seconds it asks the app what's due, reads it out on the
 * page, and shows it as a notification if the person allowed them. After
 * the page slept, only reminders a few minutes late are shown; when the
 * clocks change, ones in the skipped hour go off as they do
 * (../lib/reminder-window.ts). It keeps
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

const CHECK_EVERY_MS = 20_000;

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
        // The button is gone now; keep keyboard focus nearby.
        if (hadFocus && enable.hidden) {
          status.tabIndex = -1;
          status.focus();
        }
        if (permission() === 'granted') announce('Notifications are on.');
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
 * Shows reminders that are due as notifications, if the person allowed
 * them. With "Also remind me when … is closed" on, the notification service
 * sends them instead, so they don't show twice; unless it doesn't have them
 * as they are now (`notices`), say after a change made offline: then
 * nothing else would show them (audit F1-7). Nor does it have those that
 * didn't fit on it (more than 500): those show here too (audit 3 F1-5).
 */
export async function showNotifications(
  due: readonly DueReminder[],
  notices: () => Notice[],
): Promise<void> {
  if (permission() !== 'granted') return;
  const held = await pushHolds(notices()).catch(() => () => false);
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
  /** Reminders up to this local time have been checked, then (see ../lib/reminder-window.ts). */
  let checked: ReminderCheck = { stamp: nowStamp(), at: Date.now() };

  const status = mountNotificationStatus(
    root,
    statusTexts(options.app, options.what),
    options.announce,
  );
  const push = mountPushControls(required<HTMLElement>(root, '[data-push-controls]'), {
    notices: options.notices,
    announce: options.announce,
    onChange: status.render,
  });

  function check(): void {
    const now = { stamp: nowStamp(), at: Date.now() };
    // After sleep, only reminders a few minutes late; after the clocks
    // changed, every time they skipped (audit F1-6).
    const window = reminderWindow(checked, now);
    if (!window) return;
    checked = now;
    const due = options.due(window.from, window.to);
    if (due.length === 0) return;
    options.announce(spoken(due));
    void showNotifications(due, options.notices);
  }

  window.setInterval(check, CHECK_EVERY_MS);
  return { changed: push.sync, offerNotifications: status.offer };
}
