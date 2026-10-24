/**
 * Small page helpers every app uses, in one place so a fix reaches them all
 * (audit J-8).
 *
 *   const list = required<HTMLUListElement>(document, '[data-items]');
 *   showFieldProblems(form, ['name', 'kind'], problems, { focusFirst: true });
 */
import { focusProblem } from './problem.ts';

/** The element `selector` finds in `root`; a page without it is a bug, so it throws. */
export function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

export interface FieldProblemsOptions {
  /** Only take away problems that were fixed (while the person types). */
  onlyClear?: boolean;
  /** Put focus on the first field with a problem (focusProblem). */
  focusFirst?: boolean;
}

/** A form's control by name: every radio button of a group, or the one control. */
function controls(form: HTMLFormElement, name: string): HTMLElement[] {
  const control = form.elements.namedItem(name);
  if (control instanceof RadioNodeList) return [...control] as HTMLElement[];
  return control instanceof HTMLElement ? [control] : [];
}

/**
 * Shows each named field's problem in its `[data-error-for="<name>"]` and
 * marks the field with aria-invalid (each radio button of a group, too), or
 * takes both away when there's none. A name can be a problem about the form
 * as a whole, with an error element and no field. Returns true if any field
 * has a problem.
 */
export function showFieldProblems(
  form: HTMLFormElement,
  names: readonly string[],
  problems: Partial<Record<string, string>>,
  { onlyClear = false, focusFirst = false }: FieldProblemsOptions = {},
): boolean {
  for (const name of names) {
    const problem = problems[name] ?? '';
    if (onlyClear && problem) continue;
    const error = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (error) error.textContent = problem;
    for (const control of controls(form, name)) {
      if (problem) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }
  const first = names.find((name) => problems[name]);
  if (first !== undefined && focusFirst) focusProblem(controls(form, first)[0], problems[first]);
  return first !== undefined;
}
