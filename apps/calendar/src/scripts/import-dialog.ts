/**
 * Importing a .ics file: read it on the device, show what will be added (and
 * what can't be, and why), then add the events when the person confirms.
 * The file never leaves the device. Only choosing the file is here: the rest
 * (./import-results.ts, with the reader, lib/ics-import.ts) loads once a
 * file is chosen, as most visits never import one.
 */
import { required, type CalendarPage } from './shared.ts';

export function mountImportDialog(root: Document, page: CalendarPage): void {
  const fileInput = required<HTMLInputElement>(root, '[data-import-file]');
  const status = required<HTMLElement>(root, '[data-export-status]');

  required<HTMLButtonElement>(root, '[data-action="import-ics"]').addEventListener('click', () => {
    // Choosing the same file again should still work.
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    import('./import-results.ts').then(
      ({ showImport }) => showImport(root, page, file),
      () => {
        status.textContent = 'Calendar couldn’t read this file. Please try again.';
      },
    );
  });
}
