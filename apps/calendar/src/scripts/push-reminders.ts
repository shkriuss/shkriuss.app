/**
 * "Also remind me when Calendar is closed" (docs/adr/0009-push-notifications.md).
 *
 * When it's on, Calendar uploads its reminders to its notification service
 * after every change (the shared switch: @shkriuss/ui/push-controls). This
 * file says what those reminders are.
 */
import type { Notice } from '@shkriuss/push';
import { mountPushControls } from '@shkriuss/ui/push-controls';
import { toStamp } from '../lib/dates.ts';
import { REPEAT_LABELS, type CalendarEvent } from '../lib/events.ts';
import { formatTime, required, shortDate, utc, type CalendarPage } from './shared.ts';

/** What the notification says, e.g. "Every week · 6:30 PM – 7:30 PM". */
function bodyOf(event: CalendarEvent): string {
  const time =
    event.startTime === null
      ? 'All day'
      : event.endTime !== null && event.endDate === event.startDate
        ? `${formatTime(event.startTime)} – ${formatTime(event.endTime)}`
        : formatTime(event.startTime);
  // The same message is sent every time a repeating event comes round, so no dates.
  const when =
    event.repeat === 'none' ? shortDate.format(utc(event.startDate)) : REPEAT_LABELS[event.repeat];
  return `${when} · ${time}`;
}

/** Calendar's reminders, as the notification service schedules them. */
export function noticesOf(events: readonly CalendarEvent[]): Notice[] {
  return events.flatMap((event) =>
    event.reminder === null
      ? []
      : [
          {
            id: event.id,
            start: toStamp(event.startDate, event.startTime ?? '00:00'),
            repeat: event.repeat,
            until: event.repeatUntil,
            offset: event.reminder,
            title: event.title,
            body: bodyOf(event),
            tag: event.id,
            url: '/',
          },
        ],
  );
}

export interface PushReminders {
  /** Uploads the reminders again (after events change). */
  sync(): void;
}

export function mountPushReminders(
  root: Document,
  page: CalendarPage,
  onChange: () => void,
): PushReminders {
  return mountPushControls(required<HTMLElement>(root, '[data-push-controls]'), {
    notices: () => noticesOf(page.state().events),
    announce: page.announce,
    onChange,
  });
}
