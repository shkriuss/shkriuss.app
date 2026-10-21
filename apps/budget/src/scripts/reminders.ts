/**
 * Budget's monthly reminder to check the budget.
 *
 * While Budget is open it checks every few seconds and shows it (if the
 * person allowed notifications). When "Also remind me when Budget is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends it instead, even when Budget is closed. Its schedule is uploaded again
 * after every change.
 */
import { addMinutes, nowStamp, today } from '@shkriuss/dates';
import { isPushEnabled } from '@shkriuss/push';
import { mountPushControls } from '@shkriuss/ui/push-controls';
import {
  REMINDER_BODY,
  REMINDER_TAG,
  REMINDER_TITLE,
  reminderDue,
  reminderNotices,
  type SettingsState,
} from '../lib/budget.ts';

const CHECK_EVERY_MS = 20_000;
/** Reminders later than this (the page was asleep) aren't shown: it's on screen again. */
const LATE_MINUTES = 5;

type Permission = NotificationPermission | 'unsupported';

const permission = (): Permission =>
  'Notification' in window ? Notification.permission : 'unsupported';

const STATUS: Record<Permission, string> = {
  unsupported:
    'This browser can’t show notifications. On iPhone or iPad, add Budget to your Home Screen to get them.',
  default: 'Notifications are off. Turn them on to get the reminder.',
  granted: 'Notifications are on.',
  denied:
    'Notifications are blocked for Budget. To allow them, change this site’s settings in your browser.',
};

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Budget: missing element ${selector}`);
  return element;
}

export interface RemindersData {
  settings: () => SettingsState;
  announce: (message: string) => void;
}

export interface Reminders {
  /** After the settings changed (uploads the schedule again, if that's on). */
  changed(): void;
  /** Asks to show notifications if the person hasn't been asked. Call it from a tap. */
  offerNotifications(): void;
}

export function mountReminders(root: Document, data: RemindersData): Reminders {
  const status = required<HTMLElement>(root, '[data-notify-status]');
  const enable = required<HTMLElement>(root, '[data-notify-enable]');
  /** Reminders up to this time have been checked. */
  let checkedUntil = nowStamp();

  function renderStatus(): void {
    const current = permission();
    status.textContent = STATUS[current];
    enable.hidden = current !== 'default';
  }

  const push = mountPushControls(required<HTMLElement>(root, '[data-push-controls]'), {
    notices: () => reminderNotices(data.settings(), today()),
    announce: data.announce,
    onChange: renderStatus,
  });

  async function notify(): Promise<void> {
    // With push on, the notification service sends it; don't show it twice.
    if (permission() !== 'granted' || isPushEnabled()) return;
    // Phones only show notifications through the service worker.
    const registration =
      'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
        : undefined;
    const options: NotificationOptions = {
      body: REMINDER_BODY,
      tag: REMINDER_TAG,
      icon: '/icon-192.png',
    };
    try {
      if (registration) await registration.showNotification(REMINDER_TITLE, options);
      else new Notification(REMINDER_TITLE, options);
    } catch {
      // The page says so too.
    }
  }

  function check(): void {
    const now = nowStamp();
    if (now <= checkedUntil) return;
    const late = addMinutes(now, -LATE_MINUTES);
    const due = reminderDue(data.settings(), checkedUntil < late ? late : checkedUntil, now);
    checkedUntil = now;
    if (!due) return;
    data.announce(`Reminder: ${REMINDER_TITLE.toLowerCase()}.`);
    void notify();
  }

  function offerNotifications(): void {
    if (permission() !== 'default') return;
    Notification.requestPermission().then(
      () => {
        const hadFocus = enable.contains(root.activeElement);
        renderStatus();
        // The button is gone now; keep keyboard focus nearby.
        if (hadFocus && enable.hidden) {
          status.tabIndex = -1;
          status.focus();
        }
        if (permission() === 'granted') data.announce('Notifications are on.');
      },
      () => undefined,
    );
  }

  required<HTMLButtonElement>(enable, '[data-action="enable-notifications"]').addEventListener(
    'click',
    offerNotifications,
  );

  // Keep the status right if notifications are allowed or blocked in the browser's settings.
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'notifications' }).then(
      (result) => result.addEventListener('change', renderStatus),
      () => undefined,
    );
  }
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') renderStatus();
  });
  window.setInterval(check, CHECK_EVERY_MS);
  renderStatus();

  return { changed: push.sync, offerNotifications };
}
