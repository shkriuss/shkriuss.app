/**
 * "Your data" (components/DataControls.astro): back up, restore and delete.
 * Everything happens on the device; @shkriuss/storage/backup explains how
 * backup files are locked.
 */
import { today } from '@shkriuss/dates';
import { disablePush, isPushDeletePending, isPushEnabled } from '@shkriuss/push';
import { deleteAll, downloadFile, exportAll, type ExportFile } from '@shkriuss/storage';
import type { BackupFile } from '@shkriuss/storage/backup';
import { deleteAllFiles } from '@shkriuss/storage/files';
import { passphraseProblem } from '@shkriuss/storage/passphrase';
import { isSyncOn, stopSync } from '@shkriuss/sync';
import { DATE_LOCALE } from '../lib/locale.ts';
import { focusProblem, RELOAD_TO_UPDATE, reportLoad } from './problem.ts';
import { forgetReminderChecks } from './reminder-checks.ts';
import { setBusy } from './busy.ts';

/**
 * The backup code (locking, unlocking, checking and restoring files) is
 * loaded when first needed: it's the biggest part of "Your data", and most
 * visits never use it (the pages' JavaScript budget, audit 5). The passphrase
 * rule, checked as the person types, is in a small module of its own.
 */
const backupTools = () => import('@shkriuss/storage/backup');
/** When that code can't be loaded: mostly after an update while the page stayed open. */
const NO_TOOLS = `Couldn’t load the backup tools. ${RELOAD_TO_UPDATE}`;
/** A backup's own explanation of a problem (a BackupError), or a plain one. */
const explain = (error: unknown): string =>
  error instanceof Error && error.name === 'BackupError' ? error.message : 'Something went wrong.';

/** Backup files bigger than this are turned down (apps save far less). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/**
 * After "Delete all data", the page reloads once the notification server has
 * deleted this device's reminders, or after this long (it's tried again later).
 */
const PUSH_WAIT_MS = 5000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const longDate = new Intl.DateTimeFormat(DATE_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function find<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`DataControls: missing element ${selector}`);
  return element;
}

function dateOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'an unknown date' : longDate.format(date);
}

export function mountDataControls(section: HTMLElement): void {
  const app = section.dataset['app'] ?? 'app';
  const status = find<HTMLElement>(section, '[data-data-status]');
  const fileInput = find<HTMLInputElement>(section, '[data-restore-file]');

  const backupDialog = find<HTMLDialogElement>(section, '[data-backup-dialog]');
  const backupForm = find<HTMLFormElement>(backupDialog, '[data-backup-form]');
  const passphrase = find<HTMLInputElement>(backupForm, '[name="passphrase"]');
  const repeat = find<HTMLInputElement>(backupForm, '[name="repeat"]');
  const showPassphrase = find<HTMLInputElement>(backupForm, '[data-show-passphrase]');
  const backupSubmit = find<HTMLButtonElement>(backupForm, 'button[type="submit"]');

  const restoreDialog = find<HTMLDialogElement>(section, '[data-restore-dialog]');
  const restoreForm = find<HTMLFormElement>(restoreDialog, '[data-restore-form]');
  const restoreSummary = find<HTMLElement>(restoreDialog, '[data-restore-summary]');
  const unlock = find<HTMLElement>(restoreDialog, '[data-restore-unlock]');
  const restorePassphrase = find<HTMLInputElement>(restoreForm, '[name="passphrase"]');
  const restoreWarning = find<HTMLElement>(restoreDialog, '[data-restore-warning]');
  const restoreSyncWarning = find<HTMLElement>(restoreDialog, '[data-restore-sync-warning]');
  const restoreSubmit = find<HTMLButtonElement>(restoreDialog, '[data-restore-submit]');
  const restoreCancel = find<HTMLButtonElement>(restoreDialog, '[data-action="cancel"]');

  const deleteDialog = find<HTMLDialogElement>(section, '[data-all-data-dialog]');

  /** The backup file being restored. */
  let pending: BackupFile | null = null;

  // What's saved may be from a newer version of the app, or unreadable by
  // this one: say so, or the app just looks empty (audit 5 E-3). Once every
  // script has made its stores: they all run before the page's load event.
  if (document.readyState === 'complete') reportLoad();
  else window.addEventListener('load', () => reportLoad(), { once: true });

  /** Shows (or clears) a problem under a field. */
  function setError(form: HTMLFormElement, field: string, message: string): void {
    find<HTMLElement>(form, `[data-error-for="${field}"]`).textContent = message;
    const input = find<HTMLInputElement>(form, `[name="${field}"]`);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /**
   * While working, says what's happening and stops double taps. The buttons
   * are busy, not disabled, so focus stays where it is (audit G-7).
   */
  function busy(dialog: HTMLDialogElement, message: string): void {
    find<HTMLElement>(dialog, '[data-dialog-status]').textContent = message;
    for (const button of dialog.querySelectorAll('button')) setBusy(button, message !== '');
  }

  for (const dialog of [backupDialog, restoreDialog]) {
    for (const button of dialog.querySelectorAll('[data-action="cancel"]')) {
      button.addEventListener('click', () => {
        dialog.close();
      });
    }
  }

  // ---------- Back up ----------

  find<HTMLButtonElement>(section, '[data-action="backup"]').addEventListener('click', () => {
    backupForm.reset();
    for (const input of [passphrase, repeat]) {
      input.type = 'password';
      setError(backupForm, input.name, '');
    }
    busy(backupDialog, '');
    backupDialog.showModal();
  });

  showPassphrase.addEventListener('change', () => {
    for (const input of [passphrase, repeat]) {
      input.type = showPassphrase.checked ? 'text' : 'password';
    }
  });

  const backupProblems = () => ({
    passphrase: passphraseProblem(passphrase.value) ?? '',
    repeat: repeat.value === passphrase.value ? '' : 'The two passphrases don’t match.',
  });

  // Clear a problem as soon as it's fixed.
  backupForm.addEventListener('input', () => {
    const problems = backupProblems();
    for (const input of [passphrase, repeat]) {
      const field = input.name as keyof typeof problems;
      if (input.getAttribute('aria-invalid') === 'true' && !problems[field]) {
        setError(backupForm, input.name, '');
      }
    }
  });

  backupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const problems = backupProblems();
    setError(backupForm, 'passphrase', problems.passphrase);
    setError(backupForm, 'repeat', problems.passphrase ? '' : problems.repeat);
    if (problems.passphrase) {
      focusProblem(passphrase, problems.passphrase);
      return;
    }
    if (problems.repeat) {
      focusProblem(repeat, problems.repeat);
      return;
    }
    busy(backupDialog, 'Locking your backup…');
    const failed = (message: string): void => {
      busy(backupDialog, '');
      find<HTMLElement>(backupDialog, '[data-dialog-status]').textContent = message;
      // Focus stays where it was; if it was nowhere, it's on the button to try again.
      if (!backupDialog.contains(document.activeElement)) backupSubmit.focus();
    };
    backupTools().then(
      ({ encryptBackup }) =>
        encryptBackup(exportAll(app), passphrase.value).then(
          (backup) => {
            downloadFile(`${app}-backup-${today()}.json`, JSON.stringify(backup, null, 2));
            busy(backupDialog, '');
            backupDialog.close();
            status.textContent = 'Your backup was downloaded. Keep the passphrase safe.';
          },
          () => failed('Something went wrong while locking the backup. Please try again.'),
        ),
      () => failed(NO_TOOLS),
    );
  });

  find<HTMLButtonElement>(backupDialog, '[data-action="backup-plain"]').addEventListener(
    'click',
    () => {
      downloadFile(`${app}-data-${today()}.json`, JSON.stringify(exportAll(app), null, 2));
      backupDialog.close();
      status.textContent = 'A copy without a passphrase was downloaded.';
    },
  );

  // ---------- Restore ----------

  function showRestore(file: BackupFile | null, message: string): void {
    pending = file;
    restoreSummary.textContent = message;
    restoreForm.reset();
    setError(restoreForm, 'passphrase', '');
    busy(restoreDialog, '');
    unlock.hidden = file?.kind !== 'encrypted';
    restoreWarning.hidden = file === null;
    restoreSyncWarning.hidden = file === null || !isSyncOn();
    // Read out as the dialog opens, before its buttons: what the file is (or
    // why it can't be used), and the warnings shown (audit G-9).
    restoreDialog.setAttribute(
      'aria-describedby',
      [restoreSummary, restoreWarning, restoreSyncWarning]
        .filter((part) => !part.hidden)
        .map((part) => part.id)
        .join(' '),
    );
    restoreSubmit.hidden = file === null;
    restoreCancel.textContent = file === null ? 'Close' : 'Cancel';
    // Focus starts on the passphrase, or "Cancel" (first in the dialog), never
    // on "Restore", which replaces everything (audit G-10).
    restoreDialog.showModal();
  }

  find<HTMLButtonElement>(section, '[data-action="restore"]').addEventListener('click', () => {
    // Choosing the same file again should still work.
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showRestore(null, 'This file is too big to be a backup.');
      return;
    }
    file.text().then(
      (text) =>
        backupTools().then(
          ({ readBackup }) => {
            try {
              const backup = readBackup(text, app);
              showRestore(
                backup,
                backup.kind === 'encrypted'
                  ? `This backup is from ${dateOf(backup.backup.createdAt)} and is locked with a passphrase.`
                  : `This backup is from ${dateOf(backup.file.exportedAt)}.`,
              );
            } catch (error) {
              showRestore(null, explain(error));
            }
          },
          () => showRestore(null, NO_TOOLS),
        ),
      () => {
        showRestore(null, 'This file couldn’t be read.');
      },
    );
  });

  restorePassphrase.addEventListener('input', () => {
    setError(restoreForm, 'passphrase', '');
  });

  /** Shows a problem with the backup's passphrase, and reads it out (after Enter too: audit 3 G-4). */
  function unlockProblem(message: string): null {
    setError(restoreForm, 'passphrase', message);
    focusProblem(restorePassphrase, message);
    return null;
  }

  async function unlocked(file: BackupFile): Promise<ExportFile | null> {
    if (file.kind === 'plain') return file.file;
    if (!restorePassphrase.value) return unlockProblem('Enter the passphrase for this backup.');
    busy(restoreDialog, 'Unlocking…');
    try {
      const { decryptBackup } = await backupTools();
      return await decryptBackup(file.backup, restorePassphrase.value);
    } catch (error) {
      busy(restoreDialog, '');
      return unlockProblem(explain(error));
    }
  }

  restoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pending) return;
    void unlocked(pending).then(async (data) => {
      if (!data) return;
      busy(restoreDialog, 'Restoring…');
      try {
        const { restoreAll } = await backupTools();
        // Sync is off: forget what was synced before, so turning it on again
        // doesn't treat the restored (older) data as new edits. Only once the
        // backup is in: one that's refused changes nothing (audit 4 E-2).
        const syncWasOff = !isSyncOn();
        restoreAll(data);
        if (syncWasOff) stopSync();
      } catch (error) {
        busy(restoreDialog, '');
        find<HTMLElement>(restoreDialog, '[data-dialog-status]').textContent = explain(error);
        return;
      }
      busy(restoreDialog, 'Restored. Reloading…');
      // Reload so the app starts again from the restored data.
      window.location.reload();
    });
  });

  // ---------- Delete ----------

  find<HTMLButtonElement>(section, '[data-action="delete"]').addEventListener('click', () => {
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue !== 'confirm') return;
    status.textContent = 'Deleting…';
    // Notifications while the app is closed: off here at once, and deleted on
    // the server too. That's noted before anything waits, so if the server
    // can't be reached, or the page reloads first, the app tries again (and
    // says so) once it has reloaded.
    const push = isPushEnabled() || isPushDeletePending() ? disablePush() : Promise.resolve(true);
    // Everything on this device goes now, without waiting for the network
    // (audit G-2). Sync stops first, so the deletion doesn't reach the other
    // devices. The apps' last reminder check goes too (audit 5 D-1).
    stopSync();
    forgetReminderChecks();
    deleteAll();
    // Files like photos too, then reload so the app starts fresh from empty storage.
    void deleteAllFiles()
      .then(() => Promise.race([push, wait(PUSH_WAIT_MS)]))
      .then(() => window.location.reload());
  });
}
