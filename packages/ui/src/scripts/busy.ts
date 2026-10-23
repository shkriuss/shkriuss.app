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
 * aria-disabled="true", and once setBusy() has been used on a page, every
 * press on such a control is ignored, also Enter in a form whose submit
 * button it is. `.btn[aria-disabled='true']` looks like a disabled button.
 * Keep `disabled` for things that stay unavailable until the person does
 * something else (like "Continue" until a box is ticked).
 */

let listening = false;

/** Marks a button or switch as waiting (or not any more), keeping focus where it is. */
export function setBusy(control: HTMLButtonElement | HTMLInputElement, busy: boolean): void {
  if (!listening) {
    listening = true;
    // One listener for the whole page, before any other: presses on a busy control stop here.
    window.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) {
          // Also stops a checkbox from changing, and a form from being sent.
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }
  control.ariaDisabled = busy ? 'true' : null;
}
