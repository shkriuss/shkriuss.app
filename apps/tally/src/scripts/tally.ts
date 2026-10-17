/**
 * Tally's page behaviour: connects the HTML in pages/index.astro to the rules
 * in lib/counters.ts and saves everything on the device.
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addCounter,
  changeCount,
  emptyState,
  isTallyState,
  nameError,
  removeCounter,
  resetCounter,
  type Counter,
  type TallyState,
} from '../lib/counters.ts';

const store = createStore<TallyState>({
  key: 'tally',
  version: 1,
  fallback: emptyState,
  validate: isTallyState,
});

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Tally: missing element ${selector}`);
  return element;
}

const numberFormat = new Intl.NumberFormat();

export function mountTally(root: Document): void {
  const form = required<HTMLFormElement>(root, '[data-add-form]');
  const input = required<HTMLInputElement>(form, 'input[name="name"]');
  const error = required<HTMLElement>(form, '[data-name-error]');
  const list = required<HTMLUListElement>(root, '[data-counters]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const template = required<HTMLTemplateElement>(root, '[data-counter-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const dialog = required<HTMLDialogElement>(root, '[data-counter-dialog]');
  const dialogName = required<HTMLElement>(dialog, '[data-counter-dialog-name]');

  let state = store.load();
  let pendingDeleteId: string | undefined;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };

  const save = (next: TallyState): void => {
    state = next;
    if (!store.save(state)) {
      announce('Could not save. Your browser may be blocking storage.');
    }
    render();
    sync.changed();
  };

  function renderCounter(counter: Counter): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = counter.id;
    required<HTMLElement>(item, '[data-name]').textContent = counter.name;
    required<HTMLElement>(item, '[data-value]').textContent = numberFormat.format(counter.count);

    const label = (action: string, text: string): void => {
      required<HTMLButtonElement>(item, `[data-action="${action}"]`).setAttribute(
        'aria-label',
        text,
      );
    };
    label('increment', `Add 1 to ${counter.name}`);
    label('decrement', `Subtract 1 from ${counter.name}`);
    label('reset', `Reset ${counter.name} to zero`);
    label('delete', `Delete ${counter.name}`);
    required<HTMLButtonElement>(item, '[data-action="decrement"]').disabled = counter.count === 0;
    return item;
  }

  function render(): void {
    // Keep keyboard focus on the same button after re-rendering.
    const active = root.activeElement;
    const focusId = active?.closest<HTMLElement>('[data-id]')?.dataset['id'];
    const focusAction = active?.getAttribute('data-action');

    list.replaceChildren(...state.counters.map(renderCounter));
    empty.hidden = state.counters.length > 0;

    if (focusId && focusAction) {
      const target =
        list.querySelector<HTMLButtonElement>(
          `[data-id="${CSS.escape(focusId)}"] [data-action="${focusAction}"]:not(:disabled)`,
        ) ??
        list.querySelector<HTMLButtonElement>(
          `[data-id="${CSS.escape(focusId)}"] [data-action="increment"]`,
        );
      target?.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = nameError(input.value, state);
    if (message) {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const name = input.value.trim();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    input.value = '';
    save(addCounter(state, name, crypto.randomUUID()));
    announce(`Added counter ${name}.`);
  });

  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true' && !nameError(input.value, state)) {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    }
  });

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const id = button?.closest<HTMLElement>('[data-id]')?.dataset['id'];
    const counter = state.counters.find((entry) => entry.id === id);
    if (!button || !id || !counter) return;

    switch (button.dataset['action']) {
      case 'increment':
        save(changeCount(state, id, 1));
        break;
      case 'decrement':
        save(changeCount(state, id, -1));
        break;
      case 'reset':
        save(resetCounter(state, id));
        break;
      case 'delete':
        pendingDeleteId = id;
        dialogName.textContent = counter.name;
        dialog.showModal();
        return;
      default:
        return;
    }
    const updated = state.counters.find((entry) => entry.id === id);
    if (updated) announce(`${updated.name}: ${numberFormat.format(updated.count)}`);
  });

  dialog.addEventListener('close', () => {
    const id = pendingDeleteId;
    pendingDeleteId = undefined;
    if (dialog.returnValue !== 'confirm' || !id) return;
    const counter = state.counters.find((entry) => entry.id === id);
    save(removeCounter(state, id));
    if (counter) announce(`Deleted ${counter.name}.`);
    input.focus();
  });

  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store,
        items: (value) => value.counters,
        withItems: (value, counters) => ({ ...value, counters }),
      }),
    ],
    onChange: () => {
      state = store.load();
      render();
    },
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  // If Tally is open in two tabs, keep them in sync.
  window.addEventListener('storage', (event) => {
    if (event.key === store.key) {
      state = store.load();
      render();
    }
  });

  render();
}
