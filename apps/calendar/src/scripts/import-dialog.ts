/**
 * Importing a .ics file: read it on the device, show what will be added (and
 * what can't be, and why), then add the events when the person confirms.
 * The file never leaves the device.
 */
import { importEvents, MAX_EVENTS } from '../lib/events.ts';
import { parseIcs, type ParseResult } from '../lib/ics-import.ts';
import { plural, required, type CalendarPage } from './shared.ts';

/** Bigger files are turned down (years of a busy calendar fit in well under 1 MB). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Events that can't be imported are listed by name up to this many. */
const MAX_LISTED = 20;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] => {
  const created = document.createElement(tag);
  created.textContent = text;
  return created;
};

export function mountImportDialog(root: Document, page: CalendarPage): void {
  const fileInput = required<HTMLInputElement>(root, '[data-import-file]');
  const dialog = required<HTMLDialogElement>(root, '[data-import-dialog]');
  const details = required<HTMLElement>(dialog, '[data-import-details]');
  const skippedBlock = required<HTMLElement>(dialog, '[data-import-skipped-block]');
  const skippedList = required<HTMLUListElement>(dialog, '[data-import-skipped]');
  const cancel = required<HTMLButtonElement>(dialog, '[data-import-cancel]');
  const confirm = required<HTMLButtonElement>(dialog, '[data-import-confirm]');
  /** The file being looked at in the dialog. */
  let pending: ParseResult | null = null;

  function show(result: ParseResult, fileName: string): void {
    pending = result;
    const preview = importEvents(page.state(), result.events);
    const lines: string[] = [];
    if (result.error) {
      lines.push(result.error);
    } else {
      lines.push(
        `Found ${plural(result.events.length + result.skipped.length, 'event')} in “${fileName}”.`,
      );
      if (preview.duplicates) {
        lines.push(
          `${plural(preview.duplicates, 'event')} ${preview.duplicates === 1 ? 'is' : 'are'} already in your calendar.`,
        );
      }
      if (preview.overLimit) {
        lines.push(
          `${plural(preview.overLimit, 'event')} won’t fit: Calendar holds up to ${MAX_EVENTS} events.`,
        );
      }
      lines.push(...result.notes);
      if (preview.added === 0) lines.push('There’s nothing new to add.');
    }
    details.replaceChildren(...lines.map((line) => element('p', line)));

    const listed = result.skipped
      .slice(0, MAX_LISTED)
      .map(({ title, reason }) => element('li', `${title}: ${reason}`));
    if (result.skipped.length > MAX_LISTED) {
      listed.push(element('li', `…and ${result.skipped.length - MAX_LISTED} more.`));
    }
    skippedList.replaceChildren(...listed);
    skippedBlock.hidden = listed.length === 0;

    confirm.hidden = preview.added === 0;
    confirm.textContent = `Add ${plural(preview.added, 'event')}`;
    cancel.textContent = preview.added === 0 ? 'Close' : 'Cancel';
    dialog.returnValue = '';
    dialog.showModal();
  }

  required<HTMLButtonElement>(root, '[data-action="import-ics"]').addEventListener('click', () => {
    // Choosing the same file again should still work.
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const fail = (error: string): void => {
      show({ events: [], skipped: [], notes: [], error }, file.name);
    };
    if (file.size > MAX_FILE_BYTES) {
      fail('This file is too big to import (over 5 MB).');
      return;
    }
    file.text().then(
      (text) => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        show(parseIcs(text, { timeZone, makeId: () => crypto.randomUUID() }), file.name);
      },
      () => {
        fail('Calendar couldn’t read this file.');
      },
    );
  });

  dialog.addEventListener('close', () => {
    const result = pending;
    pending = null;
    if (dialog.returnValue !== 'confirm' || !result) return;
    // Checked again, in case events changed in another tab meanwhile.
    const { state, added } = importEvents(page.state(), result.events);
    if (added > 0 && page.save(state)) {
      page.announce(`Added ${plural(added, 'event')} from the file.`);
    }
  });
}
