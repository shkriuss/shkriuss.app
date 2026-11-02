/**
 * "Also remind me when … is closed" (components/PushControls.astro,
 * docs/adr/0009-push-notifications.md).
 *
 * When it's on, the app uploads its notifications to its notification service
 * after every change: each one encrypted on this device (only this device can
 * read it), with when it's due. The service then sends them on time, even when
 * the app and the browser are closed.
 */
import {
  disablePush,
  enablePush,
  finishPushDelete,
  isPushDeletePending,
  isPushEnabled,
  PushError,
  pushSupport,
  sendTestPush,
  syncPush,
  type Notice,
  type PushErrorCode,
  type PushSynced,
} from '@shkriuss/push';
import { setBusy } from './busy.ts';
import { RELOAD_TO_UPDATE } from './problem.ts';

/**
 * Waits this long after a change before uploading, so quick edits go up
 * together; not when the app is put away or closed (see mountPushControls).
 */
const SYNC_DELAY_MS = 800;

/**
 * Said after "add … to your Home Screen": on an iPhone or iPad, the app there
 * keeps its own data, apart from Safari's, so it starts empty. "Your data"
 * (DataControls, at the bottom of every app) says how to bring it (audit 6 Z-1).
 */
export const STARTS_EMPTY_THERE =
  'It starts empty there: see “Your data” below to bring what’s saved here.';

export interface PushControlsOptions {
  /** The app's notifications as they are now. */
  notices: () => Notice[];
  /** After it was turned on or off (notification permission may have changed). */
  onChange?: () => void;
}

export interface PushControls {
  /** Uploads the notifications again (after what's scheduled changed). */
  sync(): void;
}

function find<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`PushControls: missing element ${selector}`);
  return element;
}

export function mountPushControls(block: HTMLElement, options: PushControlsOptions): PushControls {
  const app = block.dataset['appName'] ?? 'This app';
  const toggle = find<HTMLInputElement>(block, '[data-closed-switch]');
  const status = find<HTMLElement>(block, '[data-closed-status]');
  const testRow = find<HTMLElement>(block, '[data-closed-test]');
  const testButton = find<HTMLButtonElement>(testRow, '[data-action="test-push"]');
  let timer: number | undefined;
  /** Uploads run one after another, never at the same time. */
  let queue: Promise<void> = Promise.resolve();

  const ON = `On: reminders arrive even when ${app} is closed.`;
  const OFF = `Off: reminders only arrive while ${app} is open.`;
  const OFF_NOT_DELETED = `Off, but your reminders couldn’t be removed from ${app}’s server yet.`;
  const PROBLEMS: Record<PushErrorCode, string> = {
    unsupported: `This browser can’t get notifications while ${app} is closed.`,
    denied: `Notifications are blocked for ${app}. To allow them, change this site’s settings in your browser.`,
    unavailable:
      'This browser couldn’t connect to a push service. On phones without Google services, like GrapheneOS, use a browser with UnifiedPush, such as IronFox.',
    server: `Couldn’t reach ${app}’s notification service. Check your connection and try again.`,
    refused: `${app}’s notification service had a problem. Please try again later.`,
    storage: `${app} couldn’t save this setting on this device, so it’s off. Its storage may be full or blocked.`,
    outdated: `Part of ${app} couldn’t load. ${RELOAD_TO_UPDATE}`,
  };
  const problemOf = (error: unknown): string =>
    error instanceof PushError ? PROBLEMS[error.code] : 'Something went wrong. Please try again.';
  /** What the last upload left on the server (audit 3 F1-5). */
  let fit: PushSynced = { scheduled: 0, left: 0 };
  /** "On", or how many reminders the server has when they don't all fit. */
  const onText = ({ scheduled, left }: PushSynced): string =>
    left > 0
      ? `On, but only for your next ${scheduled} reminders: ${app}’s server can’t keep more. ${left === 1 ? 'The other one arrives' : `The other ${left} arrive`} only while ${app} is open.`
      : ON;

  function render(message?: string): void {
    const on = isPushEnabled();
    toggle.checked = on;
    // Turned off while focus is on "Send a test notification": it goes to the switch.
    if (!on && testRow.contains(document.activeElement)) toggle.focus();
    testRow.hidden = !on;
    const text =
      message ??
      (on
        ? onText(fit)
        : isPushDeletePending()
          ? `${OFF_NOT_DELETED} ${app} will try again when it’s open and online.`
          : OFF);
    // A line that's read out: written again with the same words after every
    // change and every return to the app, it can be read out again each time
    // (audit 4 G-8).
    if (status.textContent !== text) status.textContent = text;
  }

  /** After an upload got through: what the server has now. */
  function uploaded(synced: PushSynced): void {
    fit = synced;
    // Also takes away a problem that's over, or shows it was turned off in
    // the browser's settings meanwhile.
    render();
  }

  function upload(force = false): void {
    queue = queue.then(
      () =>
        syncPush(options.notices(), { force }).then(uploaded, (error: unknown) => {
          render(problemOf(error));
        }),
      () => undefined,
    );
  }

  /**
   * Brings the server up to date: refreshes its copy now and then (and
   * notices a renewed subscription), or finishes deleting reminders that
   * were turned off while it couldn't be reached.
   */
  function refresh(): void {
    if (isPushEnabled()) upload();
    else if (isPushDeletePending()) {
      void finishPushDelete().then(() => {
        if (!isPushEnabled()) render();
      });
    }
  }

  function sync(): void {
    if (!isPushEnabled()) return;
    window.clearTimeout(timer);
    // Put away (or a change from another tab or device meanwhile): at once,
    // as the page may not run again before it's closed.
    if (document.visibilityState === 'hidden') {
      timer = undefined;
      upload();
      return;
    }
    timer = window.setTimeout(() => {
      timer = undefined;
      upload();
    }, SYNC_DELAY_MS);
  }

  /**
   * Put away (the phone locked, another app) or closed with a change still
   * waiting to go up: it goes up now. It waited 800 ms, and nothing sent it
   * sooner, so a reminder set just before leaving stayed on the device and
   * didn't arrive while the app was closed (audit 7 Z-1). The upload is
   * sent so that it finishes even if the page is closed meanwhile
   * (`keepalive`, in @shkriuss/push).
   */
  function leaving(): void {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
    upload();
  }

  toggle.addEventListener('change', () => {
    // Busy, not disabled, so focus stays on the switch while it waits (audit G-7).
    setBusy(toggle, true);
    if (toggle.checked) {
      status.textContent = 'Turning on…';
      enablePush()
        .then(() => syncPush(options.notices(), { force: true }))
        .then(
          // "On" only if it really is (audit 3 F1-4). The status line is read
          // out, so nothing is announced as well (audit 3 G-11).
          uploaded,
          (error: unknown) => {
            render(problemOf(error));
          },
        )
        .finally(() => {
          setBusy(toggle, false);
          options.onChange?.();
        });
    } else {
      status.textContent = 'Turning off…';
      void disablePush().then((deleted) => {
        // Says so if the reminders couldn't be removed from the server yet, also
        // when storage was too full to note that and try again (audit 3 D-3).
        render(deleted || isPushDeletePending() ? undefined : OFF_NOT_DELETED);
        setBusy(toggle, false);
        options.onChange?.();
      });
    }
  });

  testButton.addEventListener('click', () => {
    setBusy(testButton, true);
    // Said while it waits for the server (audit 4 G-6).
    render('Sending a test notification…');
    sendTestPush(app, 'Notifications are working.')
      .then(
        () => {
          render('Test sent. It should appear in a few seconds.');
        },
        (error: unknown) => {
          render(problemOf(error));
        },
      )
      .finally(() => {
        setBusy(testButton, false);
      });
  });

  const support = pushSupport();
  if (support === 'supported') {
    render();
    refresh();
    window.addEventListener('online', refresh);
    // Back on screen, maybe in another time zone after a trip: the server's copy
    // follows (an unchanged schedule isn't sent again).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
      else leaving();
    });
    // Closed or left, also where that doesn't make the page hidden first.
    window.addEventListener('pagehide', leaving);
  } else {
    toggle.disabled = true;
    status.textContent =
      support === 'needs-home-screen'
        ? `On iPhone and iPad, add ${app} to your Home Screen and open it from there to get reminders while it’s closed. ${STARTS_EMPTY_THERE}`
        : PROBLEMS.unsupported;
  }

  return { sync };
}
