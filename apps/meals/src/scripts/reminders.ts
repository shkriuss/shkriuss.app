/**
 * Meals' reminders: a notification at the time chosen for a meal of the day,
 * saying what's planned ("Dinner: Lentil soup"), on days something is.
 *
 * While Meals is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Meals is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends them instead, even when Meals is closed. Its schedule is uploaded
 * again after every change to the plan or the reminder times.
 */
import { addMinutes, nowStamp } from '@shkriuss/dates';
import { isPushEnabled } from '@shkriuss/push';
import { mountPushControls } from '@shkriuss/ui/push-controls';
import {
  dueReminders,
  REMINDER_BODY,
  reminderNotices,
  type PlanState,
  type RemindersState,
} from '../lib/meals.ts';

const CHECK_EVERY_MS = 20_000;
/** Reminders later than this (the page was asleep) aren't shown: it's on screen again. */
const LATE_MINUTES = 5;

type Permission = NotificationPermission | 'unsupported';

const permission = (): Permission =>
  'Notification' in window ? Notification.permission : 'unsupported';

const STATUS: Record<Permission, string> = {
  unsupported:
    'This browser can’t show notifications. On iPhone or iPad, add Meals to your Home Screen to get them.',
  default: 'Notifications are off. Turn them on to get reminders.',
  granted: 'Notifications are on.',
  denied:
    'Notifications are blocked for Meals. To allow them, change this site’s settings in your browser.',
};

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Meals: missing element ${selector}`);
  return element;
}

export interface RemindersData {
  plan: () => PlanState;
  reminders: () => RemindersState;
  announce: (message: string) => void;
}

export interface Reminders {
  /** After the plan or the reminder times changed (uploads the schedule again, if that's on). */
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
    notices: () => reminderNotices(data.plan(), data.reminders(), nowStamp()),
    announce: data.announce,
    onChange: renderStatus,
  });

  async function notify(due: { id: string; title: string }[]): Promise<void> {
    // With push on, the notification service sends these; don't show them twice.
    if (permission() !== 'granted' || isPushEnabled()) return;
    // Phones only show notifications through the service worker.
    const registration =
      'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
        : undefined;
    for (const reminder of due) {
      const options: NotificationOptions = {
        body: REMINDER_BODY,
        tag: reminder.id,
        icon: '/icon-192.png',
      };
      try {
        if (registration) await registration.showNotification(reminder.title, options);
        else new Notification(reminder.title, options);
      } catch {
        // The plan is still on the page.
      }
    }
  }

  function check(): void {
    const now = nowStamp();
    if (now <= checkedUntil) return;
    const late = addMinutes(now, -LATE_MINUTES);
    const due = dueReminders(
      data.plan(),
      data.reminders(),
      checkedUntil < late ? late : checkedUntil,
      now,
    );
    checkedUntil = now;
    if (due.length === 0) return;
    data.announce(`Reminder: ${due.map((reminder) => reminder.title).join('. ')}.`);
    void notify(due);
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
