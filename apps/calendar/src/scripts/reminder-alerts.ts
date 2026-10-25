/**
 * Reminders on the page and as notifications.
 *
 * While Calendar is open it checks for due reminders every few seconds, lists
 * them at the top of the page and, if the person allowed it, shows a
 * notification. When Calendar opens again after being closed, it shows the
 * reminders it missed (up to LOOKBACK_MINUTES ago, for events not yet over).
 *
 * When "Also remind me when Calendar is closed" is on (push-reminders.ts),
 * the notification service sends them instead, so this file only lists them
 * on the page (no second copy as a notification).
 */
import { isPushEnabled } from '@shkriuss/push';
import { createStore } from '@shkriuss/storage';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import {
  addDays,
  addMinutes,
  daysBetween,
  nowStamp,
  today,
  type IsoDate,
  type Stamp,
} from '../lib/dates.ts';
import { timeLabel, type Occurrence } from '../lib/events.ts';
import { dueReminders } from '../lib/reminders.ts';
import { formatTime, plural, required, shortDate, utc, type CalendarPage } from './shared.ts';

const CHECK_EVERY_MS = 20_000;
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

interface Checks {
  /** Reminders up to this time have been shown. */
  checkedUntil: Stamp;
}

const checks = createStore<Checks>({
  key: 'calendar-reminders',
  version: 1,
  fallback: () => ({ checkedUntil: '' }),
  validate: (value): value is Checks =>
    typeof value === 'object' &&
    value !== null &&
    STAMP_PATTERN.test(String((value as Record<string, unknown>)['checkedUntil'])),
});

type Permission = NotificationPermission | 'unsupported';

const permission = (): Permission =>
  'Notification' in window ? Notification.permission : 'unsupported';

const STATUS: Record<Permission, string> = {
  unsupported:
    'This browser can’t show notifications, so reminders show on this page while Calendar is open. On iPhone or iPad, add Calendar to your Home Screen to get notifications.',
  default: 'Notifications are off. Reminders show on this page while Calendar is open.',
  granted: 'Notifications are on. Reminders also show on this page while Calendar is open.',
  denied:
    'Notifications are blocked for Calendar, so reminders only show on this page. To allow them, change this site’s settings in your browser.',
};

export interface ReminderAlerts {
  /** Redraws the reminder list (after events change). */
  render(): void;
  /** Asks to show notifications if the person hasn't been asked. Call it from a tap or click. */
  offerNotifications(): void;
  /** Updates the notifications status (after permission may have changed). */
  refreshStatus(): void;
}

export function mountReminderAlerts(root: Document, page: CalendarPage): ReminderAlerts {
  const box = required<HTMLElement>(root, '[data-due]');
  const list = required<HTMLUListElement>(box, '[data-due-list]');
  const status = required<HTMLElement>(root, '[data-notify-status]');
  const enable = required<HTMLElement>(root, '[data-notify-enable]');
  /** Reminders on screen, as event id + the date that time of the event starts. */
  let shown: { id: string; start: IsoDate }[] = [];
  /** Used when the browser won't let Calendar save (it then works until the page closes). */
  let checkedInMemory = '';

  function render(): void {
    const { events } = page.state();
    const items = shown.flatMap(({ id, start }) => {
      const event = events.find((entry) => entry.id === id);
      if (!event) return [];
      const end = addDays(start, daysBetween(event.startDate, event.endDate));
      return [page.eventItem({ event, start, end }, start, true)];
    });
    list.replaceChildren(...items);
    box.hidden = items.length === 0;
  }

  const whenText = (occurrence: Occurrence): string => {
    const days = daysBetween(today(), occurrence.start);
    const day =
      days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : shortDate.format(utc(occurrence.start));
    return `${day} · ${timeLabel(occurrence, occurrence.start, formatTime)}`;
  };

  async function notify(occurrences: Occurrence[]): Promise<void> {
    // With push on, the notification service sends these; don't show them twice.
    if (permission() !== 'granted' || isPushEnabled()) return;
    // Phones only show notifications through the service worker (see sw.js).
    const registration =
      'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
        : undefined;
    for (const occurrence of occurrences) {
      const options: NotificationOptions = {
        body: whenText(occurrence),
        // The same reminder from two open tabs shows once.
        tag: `${occurrence.event.id}/${occurrence.start}`,
        icon: '/icon-192.png',
      };
      try {
        if (registration) await registration.showNotification(occurrence.event.title, options);
        else new Notification(occurrence.event.title, options);
      } catch {
        // The reminder is still on the page.
      }
    }
  }

  function check(): void {
    const now = nowStamp();
    const last = checks.load().checkedUntil || checkedInMemory;
    const remember = (stamp: Stamp): void => {
      checkedInMemory = stamp;
      checks.save({ checkedUntil: stamp });
    };
    // First visit, or the clock was far ahead: start from now.
    if (!last || last > addMinutes(now, 1440)) {
      remember(now);
      return;
    }
    if (last >= now) return;
    remember(now);

    const due = dueReminders(page.state(), last, now).map(({ occurrence }) => occurrence);
    if (due.length === 0) return;
    for (const { event, start } of due) {
      if (!shown.some((item) => item.id === event.id && item.start === start)) {
        shown.push({ id: event.id, start });
      }
    }
    // Drawn again while the person may be in the list (audit G-3).
    keepFocus(render, page.newEventButton);
    const [first] = due;
    page.announce(
      due.length === 1 && first
        ? `Reminder: ${first.event.title}, ${whenText(first)}.`
        : `${plural(due.length, 'reminder')}: ${due.map((o) => o.event.title).join(', ')}.`,
    );
    void notify(due);
  }

  function renderStatus(): void {
    const current = permission();
    status.textContent = STATUS[current];
    enable.hidden = current !== 'default';
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
        if (permission() === 'granted') page.announce('Notifications are on.');
      },
      () => undefined,
    );
  }

  required<HTMLButtonElement>(enable, '[data-action="enable-notifications"]').addEventListener(
    'click',
    offerNotifications,
  );

  required<HTMLButtonElement>(box, '[data-action="dismiss-reminders"]').addEventListener(
    'click',
    () => {
      shown = [];
      render();
      page.newEventButton.focus();
    },
  );

  // Keep the status right if notifications are allowed or blocked in the browser's settings.
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'notifications' }).then(
      (result) => result.addEventListener('change', renderStatus),
      () => undefined,
    );
  }

  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') {
      renderStatus();
      check();
    }
  });
  window.setInterval(check, CHECK_EVERY_MS);
  renderStatus();
  check();

  return { render, offerNotifications, refreshStatus: renderStatus };
}
