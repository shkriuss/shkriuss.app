/**
 * "Sync between your devices" (components/SyncControls.astro): connects the
 * buttons and the status line to an app's sync client (@shkriuss/sync).
 */
import type { SyncClient, SyncEvent, SyncProblem, SyncStatus } from '@shkriuss/sync';
import { DATE_LOCALE } from '../lib/locale.ts';
import { setBusy } from './busy.ts';

/** How often "Last synced …" is brought up to date. */
const REFRESH_MS = 30 * 1000;

const timeFormat = new Intl.DateTimeFormat(DATE_LOCALE, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(DATE_LOCALE, { day: 'numeric', month: 'short' });

function find<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`SyncControls: missing element ${selector}`);
  return element;
}

function lastSynced(last: number | null): string {
  if (last === null) return 'Not synced yet.';
  if (Date.now() - last < 60 * 1000) return 'Synced just now.';
  const sameDay = new Date(last).toDateString() === new Date().toDateString();
  return `Last synced ${sameDay ? `at ${timeFormat.format(last)}` : `on ${dateFormat.format(last)}`}.`;
}

export function mountSyncControls(section: HTMLElement, sync: SyncClient): void {
  const app = section.dataset['appName'] ?? 'This app';
  const off = find<HTMLElement>(section, '[data-sync-off]');
  const on = find<HTMLElement>(section, '[data-sync-on]');
  const code = find<HTMLElement>(section, '[data-sync-code]');
  const statusLine = find<HTMLElement>(section, '[data-sync-status]');
  const announcer = find<HTMLElement>(section, '[data-sync-announcer]');
  const deleteDialog = find<HTMLDialogElement>(section, '[data-sync-delete-dialog]');
  const button = (action: string) => find<HTMLButtonElement>(section, `[data-action="${action}"]`);

  const PROBLEMS: Record<SyncProblem, string> = {
    offline: 'Couldn’t sync: no connection. It will try again.',
    server: 'Couldn’t sync just now. It will try again later.',
    'update-needed': `Another device has a newer version of ${app}. Close ${app} and open it again to update, and it will sync.`,
    unreadable: `This version of ${app} can’t read some of the data saved here, so it isn’t syncing, to keep that data safe. Close ${app} and open it again to update.`,
    'too-big': `${app} has too much data to sync.`,
    deleted: `The online copy was deleted on another device, so sync is off here. ${app}'s data on this device is kept.`,
    moved: `Your account key was replaced on another device, so sync is off here. ${app}'s data on this device is kept. Turn on sync again to keep syncing.`,
    storage: 'This browser won’t save. Is it in private mode, or is storage blocked?',
    'files-full': `There’s no room left online for more of ${app}’s photos and files. New ones stay on this device.`,
    'connect-failed': 'Turning on sync didn’t finish. Please try again.',
  };
  const EVENTS: Partial<Record<SyncEvent, string>> = {
    connected: `Sync is on. ${app} is now the same on every device where you turn it on.`,
    cancelled: 'Sync wasn’t turned on.',
    'turned-off': `Sync is off on this device. ${app}'s data here is kept, and so is the online copy for your other devices.`,
    'kept-on':
      'Sync is still on. That link to turn it off came from a different shkriuss account. To turn sync off here, tap “Turn off on this device”.',
    'deleted-online': 'The online copy is deleted, and sync is off on this device.',
    'kept-both':
      'Synced. Something was changed on two devices at once, so both versions are kept: check for a second copy.',
  };

  const CONNECT_FAILED = `Couldn’t reach ${app}'s server. Check your connection and try again.`;
  const DELETE_FAILED = 'Couldn’t delete the online copy. Check your connection and try again.';

  /** What's being done that the person asked for, like "Opening your shkriuss account…": shown until it's done. */
  let working: string | null = null;
  /** A message from the last thing that happened, shown until the next sync. */
  let note: string | null = null;
  /** These stay until the person does something here: later syncs don't hide them. */
  const lasting = [
    EVENTS.connected,
    EVENTS['kept-both'],
    EVENTS['kept-on'],
    CONNECT_FAILED,
    DELETE_FAILED,
  ];
  /** What comes back from the hub's Account page, so it's scrolled into sight. */
  const FROM_HUB: ReadonlySet<SyncEvent> = new Set([
    'connected',
    'cancelled',
    'turned-off',
    'kept-on',
  ]);

  function render(status: SyncStatus): void {
    // Turned on or off while focus is on a button that's hidden now: it moves
    // to the button that takes its place, not back to the top of the page.
    const hadFocus = (status.on ? off : on).contains(document.activeElement);
    off.hidden = status.on;
    on.hidden = !status.on;
    if (hadFocus) button(status.on ? 'sync-now' : 'sync-on').focus();
    code.textContent = status.code ?? '';
    // Busy, not disabled, so focus stays on it during every sync (audit G-7).
    setBusy(button('sync-now'), status.busy);
    const text = working
      ? working
      : status.problem
        ? PROBLEMS[status.problem]
        : (note ?? (!status.on ? '' : status.busy ? 'Syncing…' : lastSynced(status.last)));
    // Only when it changes (it's brought up to date every 30 seconds).
    if (statusLine.textContent !== text) statusLine.textContent = text;
  }

  /**
   * Reads something out. The status line itself isn't a live region: a sync
   * runs every minute, and every change would be read out (audit G-9). Only
   * what the person asked for, or needs to know, is.
   */
  function announce(message: string): void {
    // The same words again (after another "Sync now") are still news: change
    // something that can't be heard, a no-break space at the end.
    announcer.textContent =
      announcer.textContent === message ? message + String.fromCharCode(0xa0) : message;
  }

  /** "Sync now" was pressed: the result of that sync is read out. */
  let asked = false;
  /** The problem read out last: one that stays isn't read out again at every sync. */
  let told: SyncProblem | null = null;

  /** After a sync, or turning it on or off: reads out what's worth hearing. */
  function tell(status: SyncStatus, message: string | undefined, event?: SyncEvent): void {
    if (status.busy) return;
    const { problem } = status;
    if (problem && (problem !== told || asked)) announce(PROBLEMS[problem]);
    else if (message) announce(message);
    else if (asked && event === 'synced') announce(lastSynced(status.last));
    told = problem;
    asked = false;
  }

  /** Starts something the person asked for: says so until it's done. */
  function start(message: string): void {
    working = message;
    note = null;
    render(sync.status());
    announce(message);
  }

  /** It's done (or failed, with what to say). */
  function done(problem?: string): void {
    working = null;
    if (problem) note = problem;
    render(sync.status());
    if (problem) announce(problem);
  }

  sync.subscribe((status, event) => {
    const message = event ? EVENTS[event] : undefined;
    if (message) note = message;
    else if (event === 'synced' && !lasting.includes(note ?? undefined)) note = null;
    render(status);
    tell(status, message, event);
    if (event && FROM_HUB.has(event)) reveal();
  });

  function reveal(): void {
    const { top, bottom } = statusLine.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) statusLine.scrollIntoView({ block: 'center' });
  }

  button('sync-on').addEventListener('click', () => {
    start('Opening your shkriuss account…');
    setBusy(button('sync-on'), true);
    sync.connect().catch(() => {
      setBusy(button('sync-on'), false);
      done(CONNECT_FAILED);
    });
  });

  // Back from the Account page with the browser's Back button: this page
  // comes back as it was left, still opening it.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !working) return;
    setBusy(button('sync-on'), false);
    done();
  });

  button('sync-now').addEventListener('click', () => {
    note = null;
    asked = true;
    void sync.syncNow();
  });

  button('sync-off').addEventListener('click', () => {
    sync.turnOff();
    button('sync-on').focus();
  });

  button('sync-delete').addEventListener('click', () => {
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue !== 'confirm') return;
    start('Deleting the online copy…');
    sync.deleteOnline().then(
      () => {
        done();
        button('sync-on').focus();
      },
      () => {
        done(DELETE_FAILED);
      },
    );
  });

  window.setInterval(() => render(sync.status()), REFRESH_MS);
  render(sync.status());
}
