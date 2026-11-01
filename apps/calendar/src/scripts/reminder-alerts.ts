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
 * on the page (no second copy as a notification), unless the service
 * doesn't have them as they are now (a change that couldn't be uploaded).
 * The status line and the notifications themselves are the shared ones
 * (@shkriuss/ui/local-reminders), with Calendar's own words.
 */
import { createStore } from '@shkriuss/storage';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import {
  mountNotificationStatus,
  showNotifications,
  STARTS_EMPTY_THERE,
  type Permission,
} from '@shkriuss/ui/local-reminders';
import { wentBackFar, type ReminderCheck } from '@shkriuss/ui/reminder-window';
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
  /**
   * When that was (ms since 1970), to tell the clock going back from time
   * passing (audit 4 F1-1). Not in what older versions saved, which read
   * what newer ones save too.
   */
  at?: number;
}

const checks = createStore<Checks>({
  key: 'calendar-reminders',
  version: 1,
  fallback: () => ({ checkedUntil: '' }),
  validate: (value): value is Checks => {
    if (typeof value !== 'object' || value === null) return false;
    const { checkedUntil, at } = value as Record<string, unknown>;
    return (
      STAMP_PATTERN.test(String(checkedUntil)) &&
      (at === undefined || (typeof at === 'number' && Number.isFinite(at)))
    );
  },
});

const STATUS: Record<Permission, string> = {
  unsupported: `This browser can’t show notifications, so reminders show on this page while Calendar is open. On iPhone or iPad, add Calendar to your Home Screen to get notifications. ${STARTS_EMPTY_THERE}`,
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
  const status = mountNotificationStatus(root, STATUS, page.announce);
  /** Reminders on screen, as event id + the date that time of the event starts. */
  let shown: { id: string; start: IsoDate }[] = [];
  /** Used when the browser won't let Calendar save (it then works until the page closes). */
  let checkedInMemory: ReminderCheck | null = null;

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

  function check(): void {
    const now = nowStamp();
    const current: ReminderCheck = { stamp: now, at: Date.now() };
    const saved = checks.load();
    // Saved by an older version, without when: as if just now, so only the
    // time on the clock counts, as it did then.
    const last: ReminderCheck | null = saved.checkedUntil
      ? { stamp: saved.checkedUntil, at: saved.at ?? current.at }
      : checkedInMemory;
    const remember = (check: ReminderCheck): void => {
      checkedInMemory = check;
      checks.save({ checkedUntil: check.stamp, at: check.at });
    };
    // First visit: start from now.
    if (!last) {
      remember(current);
      return;
    }
    // The clock went back further than summer time does (a new time zone
    // after flying west, say, also while Calendar was asleep or closed):
    // from the minute now, or nothing would be checked until it caught up
    // (audit 4 F1-1). Within that, the hour shown again was checked already.
    const wentBack = now <= last.stamp && wentBackFar(last, current);
    if (!wentBack && last.stamp >= now) return;
    const from = wentBack ? addMinutes(now, -1) : last.stamp;
    remember(current);

    const due = dueReminders(page.state(), from, now).map(({ occurrence }) => occurrence);
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
    void showNotifications(
      due.map((occurrence) => ({
        title: occurrence.event.title,
        body: whenText(occurrence),
        // The event's id, as the notification service's copy has
        // (push-reminders.ts), so the two replace each other and it shows
        // once, also from two open tabs (audit 3 F1-6).
        tag: occurrence.event.id,
      })),
      { from, to: now },
    );
  }

  required<HTMLButtonElement>(box, '[data-action="dismiss-reminders"]').addEventListener(
    'click',
    () => {
      shown = [];
      render();
      page.newEventButton.focus();
    },
  );

  // Back to Calendar: what's due now (the status line is drawn again too).
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') check();
  });
  window.setInterval(check, CHECK_EVERY_MS);
  check();

  return { render, offerNotifications: status.offer, refreshStatus: status.render };
}
