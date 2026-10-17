/**
 * "Sync between your devices" (components/SyncControls.astro): connects the
 * buttons and the status line to an app's sync client (@shkriuss/sync).
 */
import type { SyncClient, SyncEvent, SyncProblem, SyncStatus } from '@shkriuss/sync';

/** How often "Last synced …" is brought up to date. */
const REFRESH_MS = 30 * 1000;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

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
  const deleteDialog = find<HTMLDialogElement>(section, '[data-sync-delete-dialog]');
  const button = (action: string) => find<HTMLButtonElement>(section, `[data-action="${action}"]`);

  const PROBLEMS: Record<SyncProblem, string> = {
    offline: 'Couldn’t sync: no connection. It will try again.',
    server: 'Couldn’t sync just now. It will try again later.',
    'update-needed': `Another device has a newer version of ${app}. Close ${app} and open it again to update, and it will sync.`,
    'too-big': `${app} has too much data to sync.`,
    deleted: `The online copy was deleted on another device, so sync is off here. ${app}'s data on this device is kept.`,
    moved: `Your account key was replaced on another device, so sync is off here. ${app}'s data on this device is kept. Turn on sync again to keep syncing.`,
    storage: 'This browser won’t save. Is it in private mode, or is storage blocked?',
    'connect-failed': 'Turning on sync didn’t finish. Please try again.',
  };
  const EVENTS: Partial<Record<SyncEvent, string>> = {
    connected: `Sync is on. ${app} is now the same on every device where you turn it on.`,
    cancelled: 'Sync wasn’t turned on.',
    'turned-off': `Sync is off on this device. ${app}'s data here is kept, and so is the online copy for your other devices.`,
    'deleted-online': 'The online copy is deleted, and sync is off on this device.',
  };

  /** A message from the last thing that happened, shown until the next sync. */
  let note: string | null = null;

  function render(status: SyncStatus): void {
    off.hidden = status.on;
    on.hidden = !status.on;
    code.textContent = status.code ?? '';
    button('sync-now').disabled = status.busy;
    if (status.problem) statusLine.textContent = PROBLEMS[status.problem];
    else if (note) statusLine.textContent = note;
    else if (!status.on) statusLine.textContent = '';
    else statusLine.textContent = status.busy ? 'Syncing…' : lastSynced(status.last);
  }

  sync.subscribe((status, event) => {
    const message = event ? EVENTS[event] : undefined;
    if (message) note = message;
    else if (event === 'synced' && note !== EVENTS.connected) note = null;
    render(status);
  });

  button('sync-on').addEventListener('click', () => {
    note = null;
    statusLine.textContent = 'Opening your shkriuss account…';
    button('sync-on').disabled = true;
    sync.connect().catch(() => {
      button('sync-on').disabled = false;
      statusLine.textContent = `Couldn’t reach ${app}'s server. Check your connection and try again.`;
    });
  });

  button('sync-now').addEventListener('click', () => {
    note = null;
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
    statusLine.textContent = 'Deleting the online copy…';
    sync.deleteOnline().then(
      () => button('sync-on').focus(),
      () => {
        statusLine.textContent =
          'Couldn’t delete the online copy. Check your connection and try again.';
      },
    );
  });

  window.setInterval(() => render(sync.status()), REFRESH_MS);
  render(sync.status());
}
