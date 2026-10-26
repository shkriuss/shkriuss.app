/**
 * Messages said while a dialog is open. A modal dialog hides the page behind
 * it from screen readers, its live regions too: a message written there,
 * like a reminder that comes due or a sync message, was never read, and when
 * the dialog closed its text hadn't changed, so it wasn't read then either
 * (audit 4 G-2). Photos did this for its viewer only (audit 3 G-8).
 *
 * Once per page (AppShell does it): each dialog gets a hidden live region of
 * its own, from the start (one added just before a message isn't read), and
 * what the page's live regions and its problem notice (showProblem in
 * ./problem.ts) say while a dialog is open is said in the dialog's too: in
 * the one with focus, when one is open over another (a "Delete?" over a
 * form). It's emptied when its dialog closes, so a screen reader doesn't
 * find an old message there later. It's a polite live region, as
 * `role="status"` is, without that role: a dialog's own status line stays
 * the only one there is.
 */

/**
 * Live regions, and the page's problem notice (./problem.ts), where each
 * problem is a new notice: what's written in them is read out.
 */
const LIVE = '[role="status"], [role="alert"], [aria-live]:not([aria-live="off"]), [data-problem]';

let watching = false;

export function sayInOpenDialogs(root: Document = document): void {
  if (watching) return;
  watching = true;
  const said = new Map<HTMLDialogElement, HTMLElement>();
  for (const dialog of root.querySelectorAll('dialog')) {
    const region = root.createElement('p');
    region.className = 'visually-hidden';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.dataset['dialogMessages'] = '';
    dialog.append(region);
    said.set(dialog, region);
    dialog.addEventListener('close', () => {
      region.textContent = '';
    });
  }
  const observer = new MutationObserver((records) => {
    // The open one with focus, when one is open over another; else the last.
    const open = [...said.keys()].filter((dialog) => dialog.matches(':modal'));
    const focused = root.activeElement?.closest('dialog');
    const dialog = focused && open.includes(focused) ? focused : open.at(-1);
    const region = dialog && said.get(dialog);
    if (!region) return;
    const changed = new Set<Element>();
    for (const { target } of records) {
      const live = (target instanceof Element ? target : target.parentElement)?.closest(LIVE);
      if (live && !live.closest('dialog')) changed.add(live);
    }
    const text = [...changed]
      .map((live) => live.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) region.textContent = text;
  });
  for (const live of root.querySelectorAll(LIVE)) {
    if (live.closest('dialog')) continue;
    observer.observe(live, { childList: true, characterData: true, subtree: true });
  }
}
