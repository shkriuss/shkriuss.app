/**
 * Telling people about a problem the same way in every app: on screen, and
 * to screen readers.
 *
 * - showProblem(text): shows `text` in the page's problem notice (in
 *   AppShell: at the top of the page, and still in sight after scrolling
 *   down) and reads it out straight away.
 * - clearProblem(text?): takes the notice away (only while it shows `text`,
 *   if that's given). The person can also hide it with its button.
 * - reportSave(saved): give it what store.save() gave. When saving didn't
 *   work, it says so, and why; once everything is saved again, it takes
 *   that away. It gives `saved` back, so the app says "Saved" only when it
 *   was:
 *
 *     if (reportSave(store.save(state))) announce('Added Cups.');
 *
 * - focusProblem(field, message?): after showing a form's errors under its
 *   fields, puts focus on the first wrong field, which reads it with its
 *   error. When focus is in that field already (the person pressed Enter or
 *   Done in it), focusing it reads nothing, so the error is read out instead,
 *   with the field's name: "New counter: Enter a name for the counter."
 */
import { allSaved, lastSaveProblem } from '@shkriuss/storage';
import { SAVE_PROBLEM_TEXTS, saveProblemText, spokenFieldProblem } from '../lib/problems.ts';

const noticeArea = (): HTMLElement | null => document.querySelector('[data-problem]');

/** The problem the notice shows now, if any. */
export function shownProblem(): string | null {
  return noticeArea()?.querySelector('[data-problem-text]')?.textContent ?? null;
}

/** Takes the notice away; focus on its button goes to the page's content. */
function hide(area: HTMLElement): void {
  if (area.contains(document.activeElement)) {
    document.getElementById('main')?.focus({ preventScroll: true });
  }
  area.replaceChildren();
}

/** Above this share of the screen's height, the notice scrolls with the page instead of staying in sight. */
const TALL = 0.3;

/** Lets the notice stay in sight only while it leaves most of the screen free (not with large text). */
function fit(area: HTMLElement): void {
  const height = area.firstElementChild?.getBoundingClientRect().height ?? 0;
  area.classList.toggle('problem--tall', height > window.innerHeight * TALL);
}

let listening = false;

function listen(area: HTMLElement): void {
  if (listening) return;
  listening = true;
  area.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-problem-hide]')) hide(area);
  });
  new ResizeObserver(() => fit(area)).observe(area);
  window.addEventListener('resize', () => fit(area));
}

/** Shows `text` in the page's problem notice and reads it out (again, if it's shown already). */
export function showProblem(text: string): void {
  const area = noticeArea();
  const template = document.querySelector<HTMLTemplateElement>('[data-problem-template]');
  const notice = template?.content.firstElementChild?.cloneNode(true);
  if (!area || !(notice instanceof HTMLElement)) return;
  const words = notice.querySelector('[data-problem-text]');
  if (words) words.textContent = text;
  const hadFocus = area.contains(document.activeElement);
  // A new notice each time, so it's read out each time.
  area.replaceChildren(notice);
  fit(area);
  if (hadFocus) notice.querySelector<HTMLElement>('[data-problem-hide]')?.focus();
  listen(area);
}

/** Takes the problem notice away: any problem, or only `text`. */
export function clearProblem(text?: string): void {
  const area = noticeArea();
  if (!area || (text !== undefined && shownProblem() !== text)) return;
  hide(area);
}

export interface ReportSaveOptions {
  /**
   * Whether to read out the problem again when it's shown already. True by
   * default: each tap that doesn't save is told. Say false where saving
   * follows typing, so it isn't read out at every pause.
   */
  repeat?: boolean;
}

/** Tells the person when saving didn't work (and why), or takes that away once all is saved. */
export function reportSave(saved: boolean, { repeat = true }: ReportSaveOptions = {}): boolean {
  const shown = shownProblem();
  if (saved) {
    // Not while another store still holds something unsaved.
    if (shown !== null && SAVE_PROBLEM_TEXTS.includes(shown) && allSaved()) clearProblem();
    return true;
  }
  const text = saveProblemText(lastSaveProblem());
  if (repeat || shown !== text) showProblem(text);
  return false;
}

/**
 * What reportSave says about the last save that didn't work: for a form
 * that stays open after it, to say it there too. The page's notice is
 * behind a dialog, where a screen reader doesn't hear it.
 */
export const saveProblem = (): string => saveProblemText(lastSaveProblem());

// ---------- Errors in forms ----------

const textOf = (element: Element | null | undefined): string => element?.textContent ?? '';

const isChoice = (field: HTMLElement): field is HTMLInputElement =>
  field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox');

/** The field's name, as a screen reader says it. */
function labelOf(field: HTMLElement): string {
  const own = field.getAttribute('aria-label');
  if (own) return own;
  const ids = field.getAttribute('aria-labelledby');
  if (ids)
    return ids
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .join(' ');
  // A box in a group ("Days"): the group's name, not the box's ("Monday").
  const legend = isChoice(field) ? field.closest('fieldset')?.querySelector('legend') : null;
  if (legend) return textOf(legend);
  const labels = (field as Partial<HTMLInputElement>).labels;
  return textOf(labels?.[0]);
}

/** The error shown under the field (linked to it with aria-describedby). */
function errorOf(field: HTMLElement): string {
  const owners = [field, field.closest('fieldset')];
  for (const owner of owners) {
    for (const id of owner?.getAttribute('aria-describedby')?.split(/\s+/) ?? []) {
      const element = document.getElementById(id);
      if (element?.matches('.field__error, [data-error-for]') && textOf(element).trim()) {
        return textOf(element);
      }
    }
  }
  return '';
}

/** Whether focus is in the field (or, for a choice, in its group). */
function hasFocus(field: HTMLElement): boolean {
  const active = document.activeElement;
  if (active === field) return true;
  return (
    isChoice(field) &&
    active instanceof HTMLInputElement &&
    active.type === field.type &&
    active.name !== '' &&
    active.name === field.name &&
    active.form === field.form
  );
}

/** Reads `text` out once, from inside the field's form (so also inside an open dialog). */
function sayInForm(field: HTMLElement, text: string): void {
  const host = field.closest('form') ?? field.closest('dialog') ?? document.body;
  host.querySelector('[data-said-problem]')?.remove();
  const line = document.createElement('p');
  line.className = 'visually-hidden';
  line.setAttribute('role', 'alert');
  line.dataset['saidProblem'] = '';
  line.textContent = text;
  host.append(line);
  // Gone once the person changes something, so it isn't found again later.
  const remove = (): void => line.remove();
  host.addEventListener('input', remove, { once: true });
  field.closest('dialog')?.addEventListener('close', remove, { once: true });
}

/**
 * Puts focus on the first wrong field of a form, after its errors are
 * shown; or, if focus is there already, reads that field's error out.
 * `message` is the field's error; without it, it's the text of the
 * `.field__error` the field's aria-describedby names.
 */
export function focusProblem(field: HTMLElement | null | undefined, message?: string): void {
  if (!field) return;
  if (!hasFocus(field)) {
    field.focus();
    return;
  }
  const text = message ?? errorOf(field);
  if (text.trim()) sayInForm(field, spokenFieldProblem(labelOf(field), text));
}
