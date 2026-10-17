/**
 * "Also remind me when Calendar is closed" (docs/adr/0009-push-notifications.md).
 *
 * When it's on, Calendar uploads its reminders to its notification service
 * after every change: each one encrypted on this device (only this device can
 * read it), with when it's due. The service then sends them on time, even when
 * Calendar and the browser are closed.
 */
import {
  disablePush,
  enablePush,
  isPushEnabled,
  PushError,
  pushSupport,
  sendTestPush,
  syncPush,
  type Notice,
  type PushErrorCode,
} from '@shkriuss/push';
import { toStamp } from '../lib/dates.ts';
import { REPEAT_LABELS, type CalendarEvent } from '../lib/events.ts';
import { formatTime, required, shortDate, utc, type CalendarPage } from './shared.ts';

/** Waits this long after a change before uploading, so quick edits go up together. */
const SYNC_DELAY_MS = 800;

const ON = 'On: reminders arrive even when Calendar is closed.';
const OFF = 'Off: reminders only arrive while Calendar is open.';

const PROBLEMS: Record<PushErrorCode, string> = {
  unsupported: 'This browser can’t get notifications while Calendar is closed.',
  denied:
    'Notifications are blocked for Calendar. To allow them, change this site’s settings in your browser.',
  unavailable:
    'This browser couldn’t connect to a push service. On phones without Google services, like GrapheneOS, use a browser with UnifiedPush, such as IronFox.',
  server: 'Couldn’t reach Calendar’s notification service. Check your connection and try again.',
};

const problemOf = (error: unknown): string =>
  error instanceof PushError ? PROBLEMS[error.code] : 'Something went wrong. Please try again.';

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
  const block = required<HTMLElement>(root, '[data-closed-block]');
  const toggle = required<HTMLInputElement>(block, '[data-closed-switch]');
  const status = required<HTMLElement>(block, '[data-closed-status]');
  const testRow = required<HTMLElement>(block, '[data-closed-test]');
  const testButton = required<HTMLButtonElement>(testRow, '[data-action="test-push"]');
  let timer: number | undefined;
  /** Uploads run one after another, never at the same time. */
  let queue: Promise<void> = Promise.resolve();

  function render(message?: string): void {
    const on = isPushEnabled();
    toggle.checked = on;
    testRow.hidden = !on;
    status.textContent = message ?? (on ? ON : OFF);
  }

  function upload(force = false): void {
    queue = queue.then(
      () =>
        syncPush(noticesOf(page.state().events), { force }).then(
          () => {
            // Turned off in the browser's settings meanwhile?
            if (!isPushEnabled()) render();
          },
          (error: unknown) => {
            render(problemOf(error));
          },
        ),
      () => undefined,
    );
  }

  function sync(): void {
    if (!isPushEnabled()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      upload();
    }, SYNC_DELAY_MS);
  }

  toggle.addEventListener('change', () => {
    toggle.disabled = true;
    if (toggle.checked) {
      status.textContent = 'Turning on…';
      enablePush()
        .then(() => syncPush(noticesOf(page.state().events), { force: true }))
        .then(
          () => {
            render(ON);
            page.announce('Reminders will arrive even when Calendar is closed.');
          },
          (error: unknown) => {
            render(problemOf(error));
          },
        )
        .finally(() => {
          toggle.disabled = false;
          onChange();
        });
    } else {
      status.textContent = 'Turning off…';
      void disablePush().finally(() => {
        render(OFF);
        toggle.disabled = false;
        onChange();
      });
    }
  });

  testButton.addEventListener('click', () => {
    testButton.disabled = true;
    sendTestPush('Calendar', 'Notifications are working.')
      .then(
        () => {
          render('Test sent. It should appear in a few seconds.');
        },
        (error: unknown) => {
          render(problemOf(error));
        },
      )
      .finally(() => {
        testButton.disabled = false;
      });
  });

  const support = pushSupport();
  if (support === 'supported') {
    render();
    // Refresh the server's copy now and then (and notice a renewed subscription).
    if (isPushEnabled()) upload();
  } else {
    toggle.disabled = true;
    status.textContent =
      support === 'needs-home-screen'
        ? 'On iPhone and iPad, add Calendar to your Home Screen and open it from there to get reminders while it’s closed.'
        : PROBLEMS.unsupported;
  }

  return { sync };
}
