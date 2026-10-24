/**
 * Changes the text in a text box from code (a fix, or Deep check's changes)
 * as an edit, like typing or pasting, so the browser's Undo (Ctrl+Z, ⌘Z, or
 * shaking an iPhone) can take it back. Setting the box's value instead
 * clears its undo history in Chrome and Safari (audit G-14).
 */
import { editBetween } from '../lib/edit.ts';

/**
 * Edits the focused box's selection like typing does. `document.execCommand`
 * is deprecated (so it's typed here without TypeScript's note about that),
 * but it's the only way that keeps the undo history, and current Chrome,
 * Safari and Firefox support it in text boxes.
 */
function runEditCommand(command: 'insertText' | 'delete', value?: string): void {
  const editing: { execCommand(command: string, showUI: boolean, value?: string): boolean } =
    document;
  editing.execCommand(command, false, value);
}

/**
 * Puts `text` in the box: the part that changes is replaced in one edit, so
 * one Undo takes it all back. Like any edit, it fires an `input` event.
 * Focus stays where it was, and the caret goes after the new text.
 */
export function editText(box: HTMLTextAreaElement, text: string): void {
  if (box.value === text) return;
  const edit = editBetween(box.value, text);
  const focused = document.activeElement;
  // Focusing the box after a tap on a fix would open a phone's keyboard for a
  // moment: "none" keeps it closed while the box has focus for the edit.
  const inputMode = box.getAttribute('inputmode');
  if (focused !== box) box.setAttribute('inputmode', 'none');
  try {
    // An edit happens in the focused box, where its selection is.
    box.focus({ preventScroll: true });
    if (document.activeElement === box) {
      box.setSelectionRange(edit.start, edit.end);
      if (edit.text === '') runEditCommand('delete');
      else runEditCommand('insertText', edit.text);
    }
  } catch {
    // Like an edit that didn't happen: see below.
  }
  // Not supported (the command returned false or threw), or it came out
  // different (like text cut short by the box's maxlength): set the text the
  // old way, without undo.
  if (box.value !== text) {
    box.value = text;
    const caret = edit.start + edit.text.length;
    box.setSelectionRange(caret, caret);
  }
  if (focused !== box) {
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (document.activeElement === box) box.blur();
  }
  if (inputMode === null) box.removeAttribute('inputmode');
  else box.setAttribute('inputmode', inputMode);
}
