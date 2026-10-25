/**
 * Says so when text doesn't all fit in a box with a maxlength (audit F3-3).
 * A browser keeps only the start of a paste that's too long, and ignores
 * typing past the limit, without a word: someone who pastes an essay into
 * Grammar, then copies it back, would lose its end.
 *
 *   import { watchTextLimit } from '@shkriuss/ui/text-limit';
 *   const limit = watchTextLimit(textarea);
 *   limit.clear(); // after the page puts other text in the box
 *
 * The message shows under the box (a `.field__error` added to its `.field`,
 * and linked to the box with aria-describedby), and is read out while the
 * box has focus. It goes once the text is changed and all of it fits. Say
 * the limit in the box's hint too, where it matters.
 */
import { boxLength, cutMessage, wasCut } from '../lib/text-limit.ts';
import { focusProblem } from './problem.ts';

export interface TextLimit {
  /** Takes the message away, after the page put other text in the box. */
  clear(): void;
}

/**
 * Edits that add text where the selection is. Others (like a word the
 * keyboard corrects, or text still being composed) can replace text that
 * isn't selected, so how long the result would be isn't known.
 */
const ADDING = new Set([
  'insertText',
  'insertFromPaste',
  'insertFromDrop',
  'insertFromYank',
  'insertLineBreak',
  'insertParagraph',
]);

/** Watches a box with a maxlength, and says so when something doesn't all fit. */
export function watchTextLimit(box: HTMLInputElement | HTMLTextAreaElement): TextLimit {
  const max = box.maxLength;
  if (max < 0) return { clear: () => undefined };
  const message = document.createElement('p');
  message.className = 'field__error';
  message.id = `${box.id || box.name}-limit`;
  (box.closest('.field') ?? box.parentElement)?.append(message);
  const described = box.getAttribute('aria-describedby');
  box.setAttribute('aria-describedby', described ? `${described} ${message.id}` : message.id);

  /** While text is being added that won't all fit: the text before, and how long it would be. */
  let adding: { before: string; wanted: number } | null = null;

  const clear = (): void => {
    message.textContent = '';
  };

  /** Once the browser has added what fits (or nothing, if nothing does). */
  function added(): void {
    if (!adding) return;
    const { before, wanted } = adding;
    adding = null;
    // Not cut after all: the page put in all of it itself.
    if (!wasCut(wanted, boxLength(box.value), max)) {
      clear();
      return;
    }
    const text = cutMessage(max, box.value !== before);
    const shown = message.textContent === text;
    message.textContent = text;
    // Read out once, not again at each key pressed at the limit.
    if (!shown && document.activeElement === box) focusProblem(box, text);
  }

  // As an element of either kind, so its events have their own types.
  const element: HTMLElement = box;
  element.addEventListener('beforeinput', (event) => {
    if (!ADDING.has(event.inputType) || event.isComposing) return;
    const text =
      event.data ??
      event.dataTransfer?.getData('text/plain') ??
      (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph'
        ? '\n'
        : null);
    if (text === null) return;
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    const wanted = boxLength(box.value) - boxLength(box.value.slice(start, end)) + boxLength(text);
    if (wanted <= max) return;
    adding = { before: box.value, wanted };
    window.setTimeout(added, 0);
  });

  element.addEventListener('input', () => {
    // Changed, and all of it fit.
    if (!adding) clear();
  });

  return { clear };
}
