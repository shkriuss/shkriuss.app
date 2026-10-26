/**
 * Importing a .ics file: read it on the device, show what will be added (and
 * what can't be, and why), then add the events when the person confirms.
 * The file never leaves the device. Only choosing the file is here: the rest
 * (./import-results.ts, with the reader, lib/ics-import.ts) loads once a
 * file is chosen, as most visits never import one.
 */
import { setBusy } from '@shkriuss/ui/busy';
import { required, type CalendarPage } from './shared.ts';

export function mountImportDialog(root: Document, page: CalendarPage): void {
  const fileInput = required<HTMLInputElement>(root, '[data-import-file]');
  const status = required<HTMLElement>(root, '[data-export-status]');
  const button = required<HTMLButtonElement>(root, '[data-action="import-ics"]');

  button.addEventListener('click', () => {
    // Choosing the same file again should still work.
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    // A big file takes a moment to read (in a worker, so the page doesn't
    // freeze): say so, and one file at a time (audit 4 C-3).
    setBusy(button, true);
    status.textContent = `Reading “${file.name}”…`;
    import('./import-results.ts')
      .then(({ showImport }) => showImport(root, page, file))
      .then(
        () => {
          status.textContent = '';
        },
        () => {
          status.textContent = 'Calendar couldn’t read this file. Please try again.';
        },
      )
      .finally(() => {
        setBusy(button, false);
      });
  });
}
