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
} from '@shkriuss/push';

/** Waits this long after a change before uploading, so quick edits go up together. */
const SYNC_DELAY_MS = 800;

export interface PushControlsOptions {
  /** The app's notifications as they are now. */
  notices: () => Notice[];
  /** Tells screen reader users (the app's live region). */
  announce: (message: string) => void;
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
  const OFF_NOT_DELETED = `Off, but your reminders couldn’t be removed from ${app}'s server yet. ${app} will try again when it’s open and online.`;
  const PROBLEMS: Record<PushErrorCode, string> = {
    unsupported: `This browser can’t get notifications while ${app} is closed.`,
    denied: `Notifications are blocked for ${app}. To allow them, change this site’s settings in your browser.`,
    unavailable:
      'This browser couldn’t connect to a push service. On phones without Google services, like GrapheneOS, use a browser with UnifiedPush, such as IronFox.',
    server: `Couldn’t reach ${app}'s notification service. Check your connection and try again.`,
    refused: `${app}'s notification service had a problem. Please try again later.`,
  };
  const problemOf = (error: unknown): string =>
    error instanceof PushError ? PROBLEMS[error.code] : 'Something went wrong. Please try again.';

  function render(message?: string): void {
    const on = isPushEnabled();
    toggle.checked = on;
    testRow.hidden = !on;
    status.textContent = message ?? (on ? ON : isPushDeletePending() ? OFF_NOT_DELETED : OFF);
  }

  function upload(force = false): void {
    queue = queue.then(
      () =>
        syncPush(options.notices(), { force }).then(
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
    timer = window.setTimeout(() => {
      upload();
    }, SYNC_DELAY_MS);
  }

  toggle.addEventListener('change', () => {
    toggle.disabled = true;
    if (toggle.checked) {
      status.textContent = 'Turning on…';
      enablePush()
        .then(() => syncPush(options.notices(), { force: true }))
        .then(
          () => {
            render(ON);
            options.announce(`Reminders will arrive even when ${app} is closed.`);
          },
          (error: unknown) => {
            render(problemOf(error));
          },
        )
        .finally(() => {
          toggle.disabled = false;
          options.onChange?.();
        });
    } else {
      status.textContent = 'Turning off…';
      void disablePush().finally(() => {
        // Says so if the reminders couldn't be removed from the server yet.
        render();
        toggle.disabled = false;
        options.onChange?.();
      });
    }
  });

  testButton.addEventListener('click', () => {
    testButton.disabled = true;
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
        testButton.disabled = false;
      });
  });

  const support = pushSupport();
  if (support === 'supported') {
    render();
    refresh();
    window.addEventListener('online', refresh);
  } else {
    toggle.disabled = true;
    status.textContent =
      support === 'needs-home-screen'
        ? `On iPhone and iPad, add ${app} to your Home Screen and open it from there to get reminders while it’s closed.`
        : PROBLEMS.unsupported;
  }

  return { sync };
}
