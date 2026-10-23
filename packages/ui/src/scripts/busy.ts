/**
 * Buttons and switches that are waiting for something, like "Sync now"
 * while it syncs (audit G-7).
 *
 *   import { setBusy } from '@shkriuss/ui/busy';
 *   setBusy(button, true);   // looks and is read out as unavailable; presses do nothing
 *   setBusy(button, false);  // works again
 *
 * Use it instead of `disabled` for anything that's only unavailable for a
 * moment. A disabled control loses keyboard and screen reader focus (it
 * goes back to the page itself, and a screen reader may start again from
 * the top), and nothing puts it back. A busy one keeps focus: it's marked
 * aria-disabled="true" and every press on it is ignored, also Enter in a
 * form whose submit button is busy. `.btn[aria-disabled='true']` looks
 * like a disabled button. Keep `disabled` for things that stay unavailable
 * until the person does something else (like "Continue" until a box is ticked).
 */

const BUSY = 'data-busy';

let listening = false;

/** One listener for the whole page, before any other: presses on a busy control stop here. */
function ignorePresses(): void {
  if (listening) return;
  listening = true;
  window.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest(`[${BUSY}]`)) {
        // Also stops a checkbox from changing, and a form from being sent.
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}

/** Marks a button or switch as waiting (or not any more), keeping focus where it is. */
export function setBusy(control: HTMLButtonElement | HTMLInputElement, busy: boolean): void {
  ignorePresses();
  control.toggleAttribute(BUSY, busy);
  if (busy) control.setAttribute('aria-disabled', 'true');
  else control.removeAttribute('aria-disabled');
}

/** Whether setBusy() marked this control as waiting. */
export const isBusy = (control: Element): boolean => control.hasAttribute(BUSY);
