/**
 * Text someone typed, shown inside a line of the app's own text, like a
 * note after a date (audit Z-10). It may be in any language: Hebrew or
 * Arabic reads right to left, with its full stop at its own end.
 *
 *   import { typedText } from '@shkriuss/ui/typed-text';
 *   meta.append(' · ', typedText(entry.note));
 *
 * An element that holds only typed text needs no helper: give it dir="auto".
 */
export function typedText(text: string): HTMLElement {
  const element = document.createElement('bdi');
  element.textContent = text;
  return element;
}
