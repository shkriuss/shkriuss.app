/**
 * The note at the top of every page of a preview (AppShell's
 * [data-preview-note]): shown only at a preview's address. lib/preview.ts
 * says why (audit D-2).
 */
import { isPreviewHost } from '../lib/preview.ts';

/** Shows the page's preview note if this is a preview. */
export function showPreviewNote(): void {
  if (!isPreviewHost(location.hostname)) return;
  for (const note of document.querySelectorAll<HTMLElement>('[data-preview-note]')) {
    note.hidden = false;
  }
}
