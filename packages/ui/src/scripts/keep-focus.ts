/**
 * Keeping keyboard focus where it was when a list is drawn again (audit G-3).
 *
 * Apps draw their lists with replaceChildren(), which removes the control
 * that has focus, and focus falls back to the page itself: a keyboard or
 * screen reader user is sent back to the top. After their own changes, apps
 * say where focus goes next; a list drawn again in the background (a change
 * in another tab or from another device, or a new day) uses keepFocus():
 *
 *   import { keepFocus } from '@shkriuss/ui/keep-focus';
 *   window.addEventListener('storage', () => keepFocus(reload, addButton));
 *
 * It draws, then puts focus on the new copy of the control that had it.
 * That control is found again by its data attributes (data-action="edit",
 * data-date="…") and those of the item it's in: the nearest element around
 * it with a data attribute that names it, like <li data-id="…">. So it
 * needs no id of its own. If that item is gone (deleted on another device),
 * focus goes to the control like it just after it, or else just before it;
 * with neither, to `fallback`.
 *
 * Dialogs: when one closes, the browser puts focus back on what opened it,
 * unless a list drawn again meanwhile replaced that. Then
 * returnFocusAfterDialogs(), which AppShell starts on every page, puts focus
 * on the new copy.
 */

type Data = (readonly [name: string, value: string])[];

/** An element as it can be found again: its tag and its data attributes. */
interface Mark {
  tag: string;
  data: Data;
}

/** A control, and the item it's in (none if the control names itself, like a day's button). */
interface Place {
  item: Mark | null;
  control: Mark;
}

/** Where focus was, to put it back after drawing (focusSpot, returnFocus). */
export interface FocusSpot {
  /** The control that had focus. */
  element: HTMLElement;
  /** The elements around it, nearest first. The nearest still on the page holds its new copy. */
  around: Element[];
  /** Where it was, then the controls like it just after it and just before it. */
  places: Place[];
}

/** An element's data attributes (but not data-astro-cid-…, which Astro adds for its styles). */
const dataOf = (element: Element): Data =>
  element
    .getAttributeNames()
    .filter((name) => name.startsWith('data-') && !name.startsWith('data-astro-'))
    .map((name) => [name, element.getAttribute(name) ?? ''] as const);

const markOf = (element: Element): Mark => ({ tag: element.localName, data: dataOf(element) });

/** Whether a data attribute names this element (data-id="…"; data-action says what it does). */
const isNamed = (element: Element): boolean =>
  dataOf(element).some(([name, value]) => name !== 'data-action' && value !== '');

function placeOf(control: Element): Place {
  let item = isNamed(control) ? null : control.parentElement;
  while (item && !isNamed(item)) item = item.parentElement;
  return { item: item ? markOf(item) : null, control: markOf(control) };
}

/** What kind of control it is: its tag, its action, and which data attributes it has. */
const kindOf = (element: Element): string =>
  [
    element.localName,
    element.getAttribute('data-action') ?? '',
    ...dataOf(element).map(([name]) => name),
  ].join(' ');

const matches = (element: Element, mark: Mark): boolean =>
  element.localName === mark.tag &&
  mark.data.every(([name, value]) => element.getAttribute(name) === value);

/** Elements in `root` (or `root` itself) that match `mark`, in the page's order. */
const find = (root: Element, mark: Mark): Element[] =>
  [root, ...root.querySelectorAll(mark.tag)].filter((element) => matches(element, mark));

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** Focuses `element` if it can take focus (it may be hidden); true if it did. */
function focusOn(element: Element, options: FocusOptions): boolean {
  if (!(element instanceof HTMLElement)) return false;
  element.focus(options);
  return document.activeElement === element;
}

/** Focuses the control at `place` in `within`, or else another control in its item. */
function focusPlace(place: Place, within: Element, options: FocusOptions): boolean {
  const focusControl = (root: Element): boolean =>
    find(root, place.control).some((control) => focusOn(control, options));
  const { item } = place;
  if (!item) return focusControl(within);
  // The list drawn again can be inside the item (its steps, say), not the other way round.
  for (let around = within.parentElement; around; around = around.parentElement) {
    if (matches(around, item)) return focusControl(within);
  }
  return find(within, item).some(
    (found) =>
      focusControl(found) ||
      [...found.querySelectorAll(FOCUSABLE)].some((control) => focusOn(control, options)),
  );
}

/** Describes where focus is now (or `element`), to put it back later with returnFocus(). */
export function focusSpot(element: Element | null = document.activeElement): FocusSpot | null {
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  const around: Element[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    around.push(parent);
  }
  const kind = kindOf(element);
  const like = [...document.querySelectorAll(element.localName)].filter(
    (other) => kindOf(other) === kind,
  );
  const index = like.indexOf(element);
  return {
    element,
    around,
    places: [element, like[index + 1], index > 0 ? like[index - 1] : undefined].flatMap(
      (control) => (control ? [placeOf(control)] : []),
    ),
  };
}

/**
 * Puts focus back where `spot` says it was: on that control (or its new
 * copy), the one like it just after it or just before it, or `fallback`.
 * Does nothing if focus is somewhere already.
 */
export function returnFocus(
  spot: FocusSpot | null,
  fallback?: HTMLElement | null,
  options: FocusOptions = {},
): void {
  const active = document.activeElement;
  if (!spot || (active && active !== document.body)) return;
  // Still on the page: moved, not drawn again (or hidden, and then it stays where it is).
  if (spot.element.isConnected) {
    focusOn(spot.element, options);
    return;
  }
  const within = spot.around.find((element) => element.isConnected);
  if (within && spot.places.some((place) => focusPlace(place, within, options))) return;
  fallback?.focus(options);
}

/** Runs `draw`, keeping keyboard focus on the same control (or the nearest one, or `fallback`). */
export function keepFocus(draw: () => void, fallback?: HTMLElement | null): void {
  const spot = focusSpot();
  draw();
  // The page stays where it is: the control is where it was, or near it.
  returnFocus(spot, fallback, { preventScroll: true });
}

let watching = false;

/**
 * When a dialog closes after a list drawn again replaced the control that
 * opened it, puts focus on that control's new copy (the browser would leave
 * it on the page). Once per page: AppShell does it.
 */
export function returnFocusAfterDialogs(): void {
  if (watching) return;
  watching = true;
  const openers = new WeakMap<HTMLDialogElement, FocusSpot>();
  const listening = new WeakSet<HTMLDialogElement>();
  document.addEventListener('focusin', (event) => {
    const dialog = event.target instanceof Element ? event.target.closest('dialog') : null;
    const from = event.relatedTarget;
    // Focus coming into a dialog from the page: from what opened it.
    if (!dialog || !(from instanceof Element) || from.closest('dialog')) return;
    const opener = focusSpot(from);
    if (!opener) return;
    openers.set(dialog, opener);
    if (listening.has(dialog)) return;
    listening.add(dialog);
    // Added when it first opens, so after the app's own listeners, which may move focus themselves.
    dialog.addEventListener('close', () => {
      const spot = openers.get(dialog) ?? null;
      openers.delete(dialog);
      // Focus still in the closed dialog is lost: the browser takes it away a moment later.
      const active = document.activeElement;
      if (active instanceof HTMLElement && dialog.contains(active)) active.blur();
      returnFocus(spot);
    });
  });
}
