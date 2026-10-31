/**
 * Tasks: the steps in the task form, as they're being changed (saved with
 * the task's "Save"). Split from tasks.ts (audit J-7).
 */
import { required } from '@shkriuss/ui/dom';
import { focusProblem } from '@shkriuss/ui/problem';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { MAX_STEPS, type Step } from '../lib/tasks.ts';

export interface StepEdits {
  /** Opening the form: shows these steps, and an empty "New step". */
  fill(steps: readonly Step[]): void;
  /** The steps as they are in the form now. */
  steps(): Step[];
}

export function mountStepEdits(
  root: ParentNode,
  form: HTMLFormElement,
  announce: (text: string) => void,
): StepEdits {
  const stepEditTemplate = required<HTMLTemplateElement>(root, '[data-step-edit-template]');
  const stepEditList = required<HTMLUListElement>(form, '[data-step-edit-list]');
  const newStep = required<HTMLInputElement>(form, '[data-new-step]');
  const stepError = required<HTMLElement>(form, '[data-step-error]');
  // A paste longer than a box takes is cut by the browser: say so (audit 5 F1-4).
  const newStepLimit = watchTextLimit(newStep);

  let draftSteps: Step[] = [];

  function renderStepEdits(): void {
    stepEditList.replaceChildren(
      ...draftSteps.map((step, index) => {
        const fragment = stepEditTemplate.content.cloneNode(true) as DocumentFragment;
        const item = required<HTMLLIElement>(fragment, 'li');
        item.dataset['stepId'] = step.id;
        const number = index + 1;
        required<HTMLInputElement>(item, '[data-step-done]').checked = step.done;
        required<HTMLElement>(item, '[data-step-done-label]').textContent = `Step ${number} done`;
        const title = required<HTMLInputElement>(item, '[data-step-title]');
        // An id of its own: what doesn't fit its box is said under it (text-limit).
        title.id = `step-${step.id}`;
        title.value = step.title;
        title.setAttribute('aria-label', `Step ${number}`);
        watchTextLimit(title);
        required<HTMLElement>(item, '[data-action="remove-step"]').setAttribute(
          'aria-label',
          `Remove step ${number}`,
        );
        return item;
      }),
    );
  }

  const stepOf = (element: Element): Step | undefined => {
    const id = element.closest<HTMLElement>('[data-step-id]')?.dataset['stepId'];
    return draftSteps.find((step) => step.id === id);
  };

  function addStep(): void {
    const title = newStep.value.trim();
    let problem: string | null = null;
    if (title === '') problem = 'Write the step first.';
    else if (draftSteps.length >= MAX_STEPS) problem = `A task can have up to ${MAX_STEPS} steps.`;
    stepError.textContent = problem ?? '';
    if (problem) {
      newStep.setAttribute('aria-invalid', 'true');
      focusProblem(newStep, problem);
      return;
    }
    newStep.removeAttribute('aria-invalid');
    draftSteps.push({ id: crypto.randomUUID(), title, done: false });
    renderStepEdits();
    newStep.value = '';
    newStepLimit.clear();
    newStep.focus();
    announce(`Added step ${title}.`);
  }

  required<HTMLButtonElement>(form, '[data-action="add-step"]').addEventListener('click', addStep);

  // Enter in a step adds it, or moves on to the next one, instead of saving the whole task.
  form.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key !== 'Enter' || event.isComposing) return;
    if (target === newStep) {
      event.preventDefault();
      addStep();
    } else if (target.matches('[data-step-title]')) {
      event.preventDefault();
      newStep.focus();
    }
  });

  stepEditList.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const step = stepOf(target);
    if (step && target.matches('[data-step-title]')) step.title = target.value;
  });

  stepEditList.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const step = stepOf(target);
    if (step && target.matches('[data-step-done]')) step.done = target.checked;
  });

  stepEditList.addEventListener('click', (event) => {
    const remove = (event.target as Element).closest('[data-action="remove-step"]');
    const step = remove ? stepOf(remove) : undefined;
    if (!step) return;
    const index = draftSteps.indexOf(step);
    draftSteps.splice(index, 1);
    renderStepEdits();
    // Focus moves to the step that took its place, or the one before, or "New step".
    const titles = stepEditList.querySelectorAll<HTMLElement>('[data-step-title]');
    (titles[index] ?? titles[index - 1] ?? newStep).focus();
    announce(`Removed step ${step.title || index + 1}.`);
  });

  newStep.addEventListener('input', () => {
    if (newStep.value.trim() === '') return;
    stepError.textContent = '';
    newStep.removeAttribute('aria-invalid');
  });

  return {
    fill(steps) {
      draftSteps = steps.map((step) => ({ ...step }));
      newStep.value = '';
      newStepLimit.clear();
      stepError.textContent = '';
      renderStepEdits();
    },
    steps: () => draftSteps.map((step) => ({ ...step })),
  };
}
