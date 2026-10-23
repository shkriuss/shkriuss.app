/**
 * "Your data" (components/DataControls.astro): back up, restore and delete.
 * Everything happens on the device; @shkriuss/storage/backup explains how
 * backup files are locked.
 */
import { disablePush, isPushDeletePending, isPushEnabled } from '@shkriuss/push';
import { deleteAll, downloadFile, exportAll, type ExportFile } from '@shkriuss/storage';
import { deleteAllFiles } from '@shkriuss/storage/files';
import { isSyncOn, stopSync } from '@shkriuss/sync';
import {
  BackupError,
  decryptBackup,
  encryptBackup,
  passphraseProblem,
  readBackup,
  restoreAll,
  type BackupFile,
} from '@shkriuss/storage/backup';
import { DATE_LOCALE } from '../lib/locale.ts';
import { focusProblem } from './problem.ts';

/** Backup files bigger than this are turned down (apps save far less). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

/** Today's date on this device, "YYYY-MM-DD", for file names. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

  /** Shows (or clears) a problem under a field. */
  function setError(form: HTMLFormElement, field: string, message: string): void {
    find<HTMLElement>(form, `[data-error-for="${field}"]`).textContent = message;
    const input = find<HTMLInputElement>(form, `[name="${field}"]`);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /** While working, says what's happening and stops double taps. */
  function busy(dialog: HTMLDialogElement, message: string): void {
    find<HTMLElement>(dialog, '[data-dialog-status]').textContent = message;
    for (const button of dialog.querySelectorAll('button')) button.disabled = message !== '';
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
    encryptBackup(exportAll(app), passphrase.value).then(
      (backup) => {
        downloadFile(`${app}-backup-${today()}.json`, JSON.stringify(backup, null, 2));
        busy(backupDialog, '');
        backupDialog.close();
        status.textContent = 'Your backup was downloaded. Keep the passphrase safe.';
      },
      () => {
        busy(backupDialog, '');
        find<HTMLElement>(backupDialog, '[data-dialog-status]').textContent =
          'Something went wrong while locking the backup. Please try again.';
      },
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
    restoreSubmit.hidden = file === null;
    restoreCancel.textContent = file === null ? 'Close' : 'Cancel';
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
      (text) => {
        try {
          const backup = readBackup(text, app);
          showRestore(
            backup,
            backup.kind === 'encrypted'
              ? `This backup is from ${dateOf(backup.backup.createdAt)} and is locked with a passphrase.`
              : `This backup is from ${dateOf(backup.file.exportedAt)}.`,
          );
        } catch (error) {
          showRestore(null, error instanceof BackupError ? error.message : 'Something went wrong.');
        }
      },
      () => {
        showRestore(null, 'This file couldn’t be read.');
      },
    );
  });

  restorePassphrase.addEventListener('input', () => {
    setError(restoreForm, 'passphrase', '');
  });

  async function unlocked(file: BackupFile): Promise<ExportFile | null> {
    if (file.kind === 'plain') return file.file;
    if (!restorePassphrase.value) {
      setError(restoreForm, 'passphrase', 'Enter the passphrase for this backup.');
      restorePassphrase.focus();
      return null;
    }
    busy(restoreDialog, 'Unlocking…');
    try {
      return await decryptBackup(file.backup, restorePassphrase.value);
    } catch (error) {
      busy(restoreDialog, '');
      setError(
        restoreForm,
        'passphrase',
        error instanceof BackupError ? error.message : 'Something went wrong.',
      );
      restorePassphrase.focus();
      return null;
    }
  }

  restoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pending) return;
    void unlocked(pending).then((data) => {
      if (!data) return;
      try {
        // Sync is off: forget what was synced before, so turning it on again
        // doesn't treat the restored (older) data as new edits.
        if (!isSyncOn()) stopSync();
        restoreAll(data);
      } catch (error) {
        busy(restoreDialog, '');
        find<HTMLElement>(restoreDialog, '[data-dialog-status]').textContent =
          error instanceof BackupError ? error.message : 'Something went wrong.';
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
    // Notifications while the app is closed: delete them on the server too. If it
    // can't be reached, the app tries again (and says so) once it has reloaded.
    const push = isPushEnabled() || isPushDeletePending() ? disablePush() : Promise.resolve(true);
    void push.finally(() => {
      // Sync stops here first, so the deletion doesn't reach the other devices.
      stopSync();
      deleteAll();
      // Files like photos too, then reload so the app starts fresh from empty storage.
      void deleteAllFiles().then(() => window.location.reload());
    });
  });
}
