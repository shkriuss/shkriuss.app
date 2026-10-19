/**
 * Shelf's page behaviour: connects pages/index.astro to the rules in
 * lib/items.ts and saves everything on the device.
 *
 * The list shows the items that match the search and filters; tapping an
 * item's name opens it in the form. Tapping a brand shows only its items.
 * When sync is on and an item was changed on two devices at once, both
 * versions are kept (the second as its own item).
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addItem,
  brandsOf,
  CATEGORIES,
  CATEGORY_LABELS,
  draftOf,
  draftProblems,
  emptyState,
  formatDate,
  formatPrice,
  isShelfState,
  itemFromDraft,
  itemsCount,
  lastCurrency,
  linkHost,
  MAX_ITEMS,
  NO_FILTERS,
  OPINIONS,
  OPINION_LABELS,
  removeItem,
  secondVersion,
  SHELF_VERSION,
  SORTS,
  updateItem,
  visibleItems,
  type Brand,
  type DraftField,
  type Filters,
  type Item,
  type ItemDraft,
  type ShelfState,
} from '../lib/items.ts';

const store = createStore<ShelfState>({
  key: 'shelf',
  version: SHELF_VERSION,
  fallback: emptyState,
  validate: isShelfState,
});

/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;
/** Form fields with a place for a problem, in the order they appear. */
const FIELD_ORDER: DraftField[] = ['name', 'price', 'link', 'bought'];

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Shelf: missing element ${selector}`);
  return element;
}

const oneOf = <T extends string>(value: string, options: readonly T[]): value is T =>
  (options as readonly string[]).includes(value);

export function mountShelf(root: Document): void {
  const addButton = required<HTMLButtonElement>(root, '[data-action="add"]');
  const message = required<HTMLElement>(root, '[data-message]');
  const itemsHeading = required<HTMLElement>(root, '[data-items-heading]');
  const filtersBox = required<HTMLElement>(root, '[data-filters]');
  const search = required<HTMLInputElement>(root, '[data-filter="search"]');
  const categoryFilter = required<HTMLSelectElement>(root, '[data-filter="category"]');
  const opinionFilter = required<HTMLSelectElement>(root, '[data-filter="opinion"]');
  const sortFilter = required<HTMLSelectElement>(root, '[data-filter="sort"]');
  const brandFilter = required<HTMLElement>(root, '[data-brand-filter]');
  const brandName = required<HTMLElement>(root, '[data-brand-name]');
  const count = required<HTMLElement>(root, '[data-count]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const list = required<HTMLUListElement>(root, '[data-items]');
  const brandsSection = required<HTMLElement>(root, '[data-brands-section]');
  const brandList = required<HTMLUListElement>(root, '[data-brands]');
  const brandNames = required<HTMLDataListElement>(root, '[data-brand-names]');
  const shopNames = required<HTMLDataListElement>(root, '[data-shop-names]');
  const itemTemplate = required<HTMLTemplateElement>(root, '[data-item-template]');
  const brandTemplate = required<HTMLTemplateElement>(root, '[data-brand-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');

  const editor = required<HTMLDialogElement>(root, '[data-item-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-item-form]');
  const editorTitle = required<HTMLElement>(editor, '[data-dialog-title]');
  const deleteButton = required<HTMLButtonElement>(editor, '[data-action="delete"]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

  let state = store.load();
  let filters: Filters = { ...NO_FILTERS };
  /** The item open in the form (null for a new one). */
  let editingId: string | null = null;
  /** Where keyboard focus goes back to when the form closes. */
  let opener: HTMLElement | null = null;
  /** The item just saved, so focus can go to it in the list. */
  let savedId: string | null = null;
  let announceTimer: number | undefined;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  const say = (text: string | null): void => {
    message.hidden = text === null;
    message.textContent = text ?? '';
  };
  const find = (id: string | null): Item | undefined => state.items.find((item) => item.id === id);

  function save(next: ShelfState): boolean {
    state = next;
    const saved = store.save(state);
    say(saved ? null : 'Couldn’t save. Is this browser in private mode, or is storage blocked?');
    sync.changed();
    render();
    return saved;
  }

  // ---------- The list ----------

  function renderItem(item: Item): HTMLLIElement {
    const fragment = itemTemplate.content.cloneNode(true) as DocumentFragment;
    const card = required<HTMLLIElement>(fragment, 'li');
    card.dataset['id'] = item.id;
    const text = (selector: string, value: string): void => {
      required<HTMLElement>(card, selector).textContent = value;
    };
    text('[data-category]', CATEGORY_LABELS[item.category]);
    text('[data-opinion-label]', OPINION_LABELS[item.opinion]);
    required<HTMLElement>(card, '[data-heart]').hidden = item.opinion !== 'love';
    const edit = required<HTMLButtonElement>(card, '[data-action="edit"]');
    edit.textContent = item.name;
    edit.setAttribute('aria-label', `Edit ${item.name}`);
    text('[data-brand]', item.brand);
    text('[data-price]', item.price === null ? '' : formatPrice(item.price, item.currency));
    text('[data-details]', [item.variant, item.shop].filter(Boolean).join(' · '));
    text('[data-bought]', item.bought ? `Last bought ${formatDate(item.bought)}` : '');
    text('[data-notes]', item.notes);
    const link = required<HTMLAnchorElement>(card, '[data-link]');
    const host = linkHost(item.link);
    required<HTMLElement>(card, '[data-link-row]').hidden = host === '';
    if (host !== '') {
      link.href = item.link;
      text('[data-link-host]', host);
      link.setAttribute('aria-label', `Open ${host} for ${item.name}, in a new tab`);
    }
    return card;
  }

  function renderBrand(brand: Brand): HTMLLIElement {
    const fragment = brandTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = required<HTMLLIElement>(fragment, 'li');
    const button = required<HTMLButtonElement>(entry, '[data-action="brand"]');
    button.dataset['brand'] = brand.name;
    required<HTMLElement>(entry, '[data-brand-label]').textContent = brand.name;
    const counts = [itemsCount(brand.items)];
    if (brand.loved > 0) counts.push(`${brand.loved} loved`);
    required<HTMLElement>(entry, '[data-brand-counts]').textContent = counts.join(', ');
    button.setAttribute('aria-pressed', String(filters.brand === brand.name));
    return entry;
  }

  /** Suggestions for the brand and shop boxes: what's been typed before. */
  function fillSuggestions(target: HTMLDataListElement, values: string[]): void {
    const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    target.replaceChildren(
      ...unique.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }),
    );
  }

  function render(): void {
    const items = visibleItems(state, filters);
    list.replaceChildren(...items.map(renderItem));
    const total = state.items.length;
    const none = total === 0;
    empty.hidden = !none;
    filtersBox.hidden = none;
    count.hidden = none;
    count.textContent =
      items.length === total ? itemsCount(total) : `${items.length} of ${itemsCount(total)}`;
    brandFilter.hidden = filters.brand === null;
    brandName.textContent = filters.brand ?? '';

    const brands = brandsOf(state);
    brandsSection.hidden = brands.length === 0;
    brandList.replaceChildren(...brands.map(renderBrand));
    fillSuggestions(
      brandNames,
      brands.map((brand) => brand.name),
    );
    fillSuggestions(
      shopNames,
      state.items.map((item) => item.shop),
    );
  }

  /** What the filters show, for screen readers. */
  function announceCount(): void {
    const shown = visibleItems(state, filters).length;
    announce(`${itemsCount(shown)} shown.`);
  }

  function readFilters(): void {
    filters = {
      ...filters,
      search: search.value,
      category: oneOf(categoryFilter.value, CATEGORIES) ? categoryFilter.value : 'all',
      opinion: oneOf(opinionFilter.value, OPINIONS) ? opinionFilter.value : 'all',
      sort: oneOf(sortFilter.value, SORTS) ? sortFilter.value : 'recent',
    };
    render();
  }

  // ---------- The form ----------

  const field = <T extends HTMLElement>(name: string): T => required<T>(form, `[name="${name}"]`);
  const textFields = ['name', 'brand', 'price', 'shop', 'link', 'variant', 'bought'] as const;

  function readDraft(): ItemDraft {
    const value = (name: string): string =>
      field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name).value;
    const opinion = form.querySelector<HTMLInputElement>('[name="opinion"]:checked');
    return {
      name: value('name'),
      brand: value('brand'),
      category: value('category'),
      opinion: opinion?.value ?? 'use',
      price: value('price'),
      currency: value('currency'),
      shop: value('shop'),
      link: value('link'),
      variant: value('variant'),
      bought: value('bought'),
      notes: value('notes'),
    };
  }

  function fillForm(draft: ItemDraft): void {
    for (const name of textFields) field<HTMLInputElement>(name).value = draft[name];
    field<HTMLSelectElement>('category').value = draft.category;
    field<HTMLSelectElement>('currency').value = draft.currency;
    field<HTMLTextAreaElement>('notes').value = draft.notes;
    for (const radio of form.querySelectorAll<HTMLInputElement>('[name="opinion"]')) {
      radio.checked = radio.value === draft.opinion;
    }
  }

  /** Shows each problem next to its field. With `onlyClear`, only removes fixed ones. */
  function showProblems(problems: Partial<Record<DraftField, string>>, onlyClear = false): void {
    for (const name of [...FIELD_ORDER, 'form'] as DraftField[]) {
      const text = problems[name] ?? '';
      if (onlyClear && text) continue;
      required<HTMLElement>(form, `[data-error-for="${name}"]`).textContent = text;
      const control = form.querySelector<HTMLElement>(`[name="${name}"]`);
      if (text) control?.setAttribute('aria-invalid', 'true');
      else control?.removeAttribute('aria-invalid');
    }
  }

  function openEditor(item: Item | null): void {
    editingId = item?.id ?? null;
    opener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    showProblems({});
    editorTitle.textContent = item ? 'Edit item' : 'New item';
    deleteButton.hidden = item === null;
    fillForm(
      item
        ? draftOf(item)
        : {
            name: '',
            brand: filters.brand ?? '',
            // Adding while looking at one category: the new item goes in it.
            category: filters.category === 'all' ? 'food' : filters.category,
            opinion: 'use',
            price: '',
            currency: lastCurrency(state),
            shop: '',
            link: '',
            variant: '',
            bought: '',
            notes: '',
          },
    );
    editor.showModal();
    field<HTMLInputElement>('name').focus();
  }

  // However the form closes (Save, Cancel, Escape), put focus somewhere useful.
  editor.addEventListener('close', () => {
    const saved = savedId
      ? list.querySelector<HTMLElement>(`[data-id="${CSS.escape(savedId)}"] [data-action="edit"]`)
      : null;
    (saved ?? (opener?.isConnected ? opener : addButton)).focus();
    savedId = null;
    opener = null;
  });

  // Clear a field's problem as soon as it's fixed.
  form.addEventListener('input', () => {
    if (form.querySelector('[aria-invalid="true"]')) showProblems(draftProblems(readDraft()), true);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft = readDraft();
    const problems = draftProblems(draft);
    if (editingId === null && state.items.length >= MAX_ITEMS) {
      problems.form = `You can keep up to ${itemsCount(MAX_ITEMS)}. Delete some to add more.`;
    }
    showProblems(problems);
    const first = FIELD_ORDER.find((name) => problems[name]);
    if (first) {
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    if (problems.form) return;

    const now = Date.now();
    const existing = find(editingId);
    const item = itemFromDraft(draft, editingId ?? crypto.randomUUID(), now, existing);
    // A saved item that the filters would hide is still shown: clear them.
    const hidden = !visibleItems({ items: [item] }, filters).length;
    if (hidden) {
      filters = { ...NO_FILTERS, sort: filters.sort };
      search.value = '';
      categoryFilter.value = 'all';
      opinionFilter.value = 'all';
    }
    if (save(existing ? updateItem(state, item) : addItem(state, item))) {
      announce(`Saved ${item.name}.`);
    }
    savedId = item.id;
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="cancel"]').addEventListener('click', () => {
    editor.close();
  });

  deleteButton.addEventListener('click', () => {
    const item = find(editingId);
    if (!item) return;
    deleteName.textContent = item.name;
    deleteDialog.returnValue = '';
    // Opens on top of the form; "Cancel" goes back to it.
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    const item = find(editingId);
    if (deleteDialog.returnValue !== 'confirm' || !item) return;
    editingId = null;
    opener = addButton;
    save(removeItem(state, item.id));
    announce(`Deleted ${item.name}.`);
    editor.close();
  });

  // ---------- Buttons and filters ----------

  addButton.addEventListener('click', () => {
    if (state.items.length >= MAX_ITEMS) {
      say(`You have ${itemsCount(MAX_ITEMS)}, the most Shelf can keep. Delete some to add more.`);
      return;
    }
    openEditor(null);
  });

  list.addEventListener('click', (event) => {
    const id = (event.target as Element)
      .closest('[data-action="edit"]')
      ?.closest<HTMLElement>('[data-id]')?.dataset['id'];
    const item = find(id ?? null);
    if (item) openEditor(item);
  });

  brandList.addEventListener('click', (event) => {
    const brand = (event.target as Element).closest<HTMLElement>('[data-action="brand"]')?.dataset[
      'brand'
    ];
    if (brand === undefined) return;
    filters = { ...filters, brand: filters.brand === brand ? null : brand };
    render();
    if (filters.brand === null) {
      announceCount();
      return;
    }
    // Over to the list, which now shows only this brand.
    itemsHeading.focus();
    itemsHeading.scrollIntoView({ block: 'start' });
    announce(`${itemsCount(visibleItems(state, filters).length)} by ${brand}.`);
  });

  required<HTMLButtonElement>(root, '[data-action="all-brands"]').addEventListener('click', () => {
    filters = { ...filters, brand: null };
    render();
    announceCount();
    itemsHeading.focus();
  });

  search.addEventListener('input', () => {
    readFilters();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(announceCount, ANNOUNCE_DELAY_MS);
  });
  for (const select of [categoryFilter, opinionFilter, sortFilter]) {
    select.addEventListener('change', () => {
      readFilters();
      if (select !== sortFilter) announceCount();
    });
  }

  /** After changes from another device or tab. */
  function refresh(): void {
    state = store.load();
    // The item open in the form was deleted elsewhere: saving adds it back.
    render();
  }

  // If Shelf is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === store.key) refresh();
  });

  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store,
        items: (value) => value.items,
        withItems: (value, items) => ({ ...value, items }),
        // Changed on two devices at once: keep this device's version as its own item.
        conflictCopy: (mine) => secondVersion(mine, crypto.randomUUID()),
      }),
    ],
    onChange: refresh,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  render();
}
