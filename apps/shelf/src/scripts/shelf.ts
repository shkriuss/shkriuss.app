/**
 * Shelf's page behaviour: connects pages/index.astro to the rules in
 * lib/items.ts and saves everything on the device.
 *
 * The list shows the items that match the search and filters; tapping an
 * item's name opens it in the form. Tapping a brand shows only its items;
 * tapping a category opens it to rename or delete it.
 *
 * Items and categories are saved apart (lib/categories.ts says why). When
 * sync is on and an item was changed on two devices at once, both versions
 * are kept (the second as its own item); for a category, the newest change
 * wins.
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { withEdits } from '@shkriuss/sync/edits';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { PAGE_SIZE, shownCount, waitForTyping } from '@shkriuss/ui/long-lists';
import { clearProblem, focusProblem, reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { site } from 'virtual:shkriuss/site';
import {
  addCategory,
  categoriesOf,
  CATEGORIES_VERSION,
  categoryName,
  categoryProblem,
  isCategoriesState,
  MAX_CATEGORIES,
  noChanges,
  removeCategory,
  renameCategory,
  type CategoriesState,
  type Category,
} from '../lib/categories.ts';
import {
  addItem,
  brandsOf,
  draftOf,
  draftProblems,
  emptyState,
  formatDate,
  formatPrice,
  isShelfState,
  itemFromDraft,
  itemsCount,
  itemsPerCategory,
  lastCurrency,
  linkHost,
  MAX_ITEMS,
  moveItems,
  NO_CATEGORY,
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
import { required, showFieldProblems } from '@shkriuss/ui/dom';

const store = createStore<ShelfState>({
  key: 'shelf',
  version: SHELF_VERSION,
  fallback: emptyState,
  validate: isShelfState,
});

const categoriesStore = createStore<CategoriesState>({
  key: 'shelf-categories',
  version: CATEGORIES_VERSION,
  fallback: noChanges,
  validate: isCategoriesState,
});

/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;
/** Form fields with a place for a problem, in the order they appear. */
const FIELD_ORDER: DraftField[] = ['name', 'price', 'link', 'bought'];

const oneOf = <T extends string>(value: string, options: readonly T[]): value is T =>
  (options as readonly string[]).includes(value);

type Choice = [value: string, label: string];
const choicesOf = (categories: readonly Category[]): Choice[] =>
  categories.map((category) => [category.id, category.name]);

/**
 * Gives a select these options (only rebuilt when they changed, so an open
 * list isn't disturbed), keeping its choice if it's still one of them.
 */
function setOptions(select: HTMLSelectElement, choices: Choice[], fallback: string): void {
  const chosen = select.value;
  const same =
    select.options.length === choices.length &&
    choices.every(([value, label], index) => {
      const option = select.options[index];
      return option?.value === value && option.text === label;
    });
  if (!same) select.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
  select.value = choices.some(([value]) => value === chosen) ? chosen : fallback;
}

export function mountShelf(root: Document): void {
  const addButton = required<HTMLButtonElement>(root, '[data-action="add"]');
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
  const more = required<HTMLElement>(root, '[data-more]');
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

  const addCategoryButton = required<HTMLButtonElement>(root, '[data-action="add-category"]');
  const categoryList = required<HTMLUListElement>(root, '[data-categories]');
  const categoriesHint = required<HTMLElement>(root, '[data-categories-hint]');
  const categoriesEmpty = required<HTMLElement>(root, '[data-categories-empty]');
  const categoryTemplate = required<HTMLTemplateElement>(root, '[data-category-template]');
  const categoryEditor = required<HTMLDialogElement>(root, '[data-category-dialog]');
  const categoryForm = required<HTMLFormElement>(categoryEditor, '[data-category-form]');
  const categoryTitle = required<HTMLElement>(categoryEditor, '[data-category-title]');
  const categoryInput = required<HTMLInputElement>(categoryForm, '[data-category-name]');
  const categoryError = required<HTMLElement>(categoryForm, '[data-category-error]');
  const deleteCategoryButton = required<HTMLButtonElement>(
    categoryEditor,
    '[data-action="delete-category"]',
  );
  const categoryDeleteDialog = required<HTMLDialogElement>(root, '[data-category-delete-dialog]');
  const categoryDeleteName = required<HTMLElement>(
    categoryDeleteDialog,
    '[data-category-delete-name]',
  );
  const moveField = required<HTMLElement>(categoryDeleteDialog, '[data-move-field]');
  const moveCount = required<HTMLElement>(categoryDeleteDialog, '[data-move-count]');
  const moveTo = required<HTMLSelectElement>(categoryDeleteDialog, '[data-move-to]');

  let state = store.load();
  let categoriesState = categoriesStore.load();
  let filters: Filters = { ...NO_FILTERS };
  /** The item open in the form (null for a new one). */
  let editingId: string | null = null;
  /** The form as it opened, to tell what the person changed (see withEdits). */
  let openedDraft: ItemDraft | null = null;
  /** Where keyboard focus goes back to when the form closes. */
  let opener: HTMLElement | null = null;
  /** The item just saved, so focus can go to it in the list. */
  let savedId: string | null = null;
  /** The same for the category form. */
  let editingCategoryId: string | null = null;
  let categoryOpener: HTMLElement | null = null;
  let savedCategoryId: string | null = null;
  let announceTimer: number | undefined;
  /** Items shown so far ("Show more" adds a page: audit J-1). */
  let shown = PAGE_SIZE;
  /** An item just saved: shown, however far down it is. */
  let reveal: string | null = null;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  /** A message say() showed in the page's notice (read out too), taken away by the next save. */
  let said: string | null = null;
  const say = (text: string): void => {
    showProblem(text);
    said = text;
  };
  /** Tells the person if saving didn't work; once it does, takes say()'s message away. */
  const report = (saved: boolean): boolean => {
    if (reportSave(saved) && said !== null) {
      clearProblem(said);
      said = null;
    }
    return saved;
  };
  const find = (id: string | null): Item | undefined => state.items.find((item) => item.id === id);

  function save(next: ShelfState): boolean {
    state = next;
    const saved = report(store.save(state));
    sync.changed();
    render();
    return saved;
  }

  function saveCategories(next: CategoriesState): boolean {
    categoriesState = next;
    const saved = report(categoriesStore.save(categoriesState));
    sync.changed();
    render();
    return saved;
  }

  // ---------- The list ----------

  function renderItem(item: Item, categories: readonly Category[]): HTMLLIElement {
    const fragment = itemTemplate.content.cloneNode(true) as DocumentFragment;
    const card = required<HTMLLIElement>(fragment, 'li');
    card.dataset['id'] = item.id;
    const text = (selector: string, value: string): void => {
      required<HTMLElement>(card, selector).textContent = value;
    };
    const category = categoryName(categories, item.category);
    text('[data-category]', category);
    required<HTMLElement>(card, '[data-category]').hidden = category === '';
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

  function renderCategory(category: Category, items: number): HTMLLIElement {
    const fragment = categoryTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = required<HTMLLIElement>(fragment, 'li');
    required<HTMLElement>(entry, '[data-category-id]').dataset['categoryId'] = category.id;
    required<HTMLElement>(entry, '[data-category-label]').textContent = category.name;
    required<HTMLElement>(entry, '[data-category-count]').textContent = itemsCount(items);
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
    const categories = categoriesOf(categoriesState);
    const perCategory = itemsPerCategory(state, categories);
    // A category that's gone can't stay chosen in the filter.
    const filterChoices: Choice[] = [['all', 'All categories'], ...choicesOf(categories)];
    if (perCategory.has(NO_CATEGORY)) filterChoices.push([NO_CATEGORY, 'No category']);
    setOptions(categoryFilter, filterChoices, 'all');
    filters = { ...filters, category: categoryFilter.value };

    const items = visibleItems(state, filters, categories);
    // Never hidden by paging: the item with focus, or one just saved.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]');
    shown = shownCount(
      items.map((item) => item.id),
      shown,
      [reveal, focused?.dataset['id']],
    );
    reveal = null;
    list.replaceChildren(...items.slice(0, shown).map((item) => renderItem(item, categories)));
    more.hidden = items.length <= shown;
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

    categoryList.replaceChildren(
      ...categories.map((category) => renderCategory(category, perCategory.get(category.id) ?? 0)),
    );
    categoriesHint.hidden = categories.length === 0;
    categoriesEmpty.hidden = categories.length > 0;
  }

  /** What the filters show, for screen readers. */
  function announceCount(): void {
    const matches = visibleItems(state, filters, categoriesOf(categoriesState)).length;
    announce(`${itemsCount(matches)} shown.`);
  }

  function readFilters(): void {
    shown = PAGE_SIZE;
    filters = {
      ...filters,
      search: search.value,
      category: categoryFilter.value,
      opinion: oneOf(opinionFilter.value, OPINIONS) ? opinionFilter.value : 'all',
      sort: oneOf(sortFilter.value, SORTS) ? sortFilter.value : 'recent',
    };
    render();
  }

  // ---------- The form ----------

  const field = <T extends HTMLElement>(name: string): T => required<T>(form, `[name="${name}"]`);
  const textFields = ['name', 'brand', 'price', 'shop', 'link', 'variant', 'bought'] as const;
  // A paste longer than a box takes is cut by the browser: say so (audit F3-3).
  const limits = ['name', 'brand', 'shop', 'variant', 'link', 'notes'].map((name) =>
    watchTextLimit(field<HTMLInputElement | HTMLTextAreaElement>(name)),
  );

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
    for (const limit of limits) limit.clear();
    const category = field<HTMLSelectElement>('category');
    setOptions(
      category,
      [[NO_CATEGORY, 'No category'], ...choicesOf(categoriesOf(categoriesState))],
      NO_CATEGORY,
    );
    category.value = draft.category;
    // In a category that's gone (deleted on another device): none.
    if (category.value !== draft.category) category.value = NO_CATEGORY;
    field<HTMLSelectElement>('currency').value = draft.currency;
    field<HTMLTextAreaElement>('notes').value = draft.notes;
    for (const radio of form.querySelectorAll<HTMLInputElement>('[name="opinion"]')) {
      radio.checked = radio.value === draft.opinion;
    }
  }

  /** Shows each problem next to its field; focuses the first. Returns true if there are any. */
  const showProblems = (problems: Partial<Record<DraftField, string>>, onlyClear = false) =>
    showFieldProblems(form, [...FIELD_ORDER, 'form'], problems, {
      onlyClear,
      focusFirst: !onlyClear,
    });

  function openEditor(item: Item | null): void {
    editingId = item?.id ?? null;
    openedDraft = item ? draftOf(item) : null;
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
            category: filters.category === 'all' ? NO_CATEGORY : filters.category,
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
    if (showProblems(problems)) return;

    const now = Date.now();
    const existing = find(editingId);
    // A sync while the form was open may have changed the item on another
    // device: keep those changes, and put on only what was changed here.
    const edited =
      existing && openedDraft ? withEdits(openedDraft, draft, draftOf(existing)) : draft;
    const item = itemFromDraft(edited, editingId ?? crypto.randomUUID(), now, existing);
    typedSearch.flush();
    reveal = item.id;
    // A saved item that the filters would hide is still shown: clear them.
    const hidden = !visibleItems({ items: [item] }, filters, categoriesOf(categoriesState)).length;
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
    if (save(removeItem(state, item.id))) announce(`Deleted ${item.name}.`);
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
    shown = PAGE_SIZE;
    if (filters.brand === null) {
      // The brands are drawn again: focus stays on this one (audit G-5).
      keepFocus(render);
      announceCount();
      return;
    }
    render();
    // Over to the list, which now shows only this brand.
    itemsHeading.focus();
    itemsHeading.scrollIntoView({ block: 'start' });
    const matches = visibleItems(state, filters, categoriesOf(categoriesState)).length;
    announce(`${itemsCount(matches)} by ${brand}.`);
  });

  required<HTMLButtonElement>(root, '[data-action="all-brands"]').addEventListener('click', () => {
    filters = { ...filters, brand: null };
    shown = PAGE_SIZE;
    render();
    announceCount();
    itemsHeading.focus();
  });

  // The list is drawn again once typing pauses, not at every key (audit J-1).
  const typedSearch = waitForTyping(() => {
    if (filters.search === search.value) return;
    readFilters();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(announceCount, ANNOUNCE_DELAY_MS);
  });
  search.addEventListener('input', typedSearch);

  required<HTMLButtonElement>(more, '[data-action="more"]').addEventListener('click', () => {
    const first = shown;
    shown += PAGE_SIZE;
    render();
    list.querySelectorAll<HTMLElement>('[data-action="edit"]')[first]?.focus();
  });
  for (const select of [categoryFilter, opinionFilter, sortFilter]) {
    select.addEventListener('change', () => {
      readFilters();
      if (select !== sortFilter) announceCount();
    });
  }

  // ---------- Categories ----------

  const findCategory = (id: string | null): Category | undefined =>
    categoriesOf(categoriesState).find((category) => category.id === id);

  function showCategoryProblem(text: string | null): void {
    categoryError.textContent = text ?? '';
    if (text) categoryInput.setAttribute('aria-invalid', 'true');
    else categoryInput.removeAttribute('aria-invalid');
  }

  function openCategoryEditor(category: Category | null): void {
    editingCategoryId = category?.id ?? null;
    categoryOpener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    showCategoryProblem(null);
    categoryTitle.textContent = category ? 'Edit category' : 'New category';
    deleteCategoryButton.hidden = category === null;
    categoryInput.value = category?.name ?? '';
    categoryEditor.showModal();
    categoryInput.focus();
  }

  categoryEditor.addEventListener('close', () => {
    const saved = savedCategoryId
      ? categoryList.querySelector<HTMLElement>(
          `[data-category-id="${CSS.escape(savedCategoryId)}"]`,
        )
      : null;
    (saved ?? (categoryOpener?.isConnected ? categoryOpener : addCategoryButton)).focus();
    savedCategoryId = null;
    categoryOpener = null;
  });

  categoryInput.addEventListener('input', () => {
    if (categoryInput.hasAttribute('aria-invalid')) {
      showCategoryProblem(categoryProblem(categoriesState, categoryInput.value, editingCategoryId));
    }
  });

  categoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = categoryProblem(categoriesState, categoryInput.value, editingCategoryId);
    showCategoryProblem(problem);
    if (problem) {
      focusProblem(categoryInput, problem);
      return;
    }
    const id = editingCategoryId ?? crypto.randomUUID();
    const next =
      editingCategoryId === null
        ? addCategory(categoriesState, id, categoryInput.value)
        : renameCategory(categoriesState, id, categoryInput.value);
    if (saveCategories(next)) announce(`Saved category ${categoryName(categoriesOf(next), id)}.`);
    savedCategoryId = id;
    categoryEditor.close();
  });

  required<HTMLButtonElement>(categoryEditor, '[data-action="cancel-category"]').addEventListener(
    'click',
    () => {
      categoryEditor.close();
    },
  );

  deleteCategoryButton.addEventListener('click', () => {
    const category = findCategory(editingCategoryId);
    if (!category) return;
    const categories = categoriesOf(categoriesState);
    const items = itemsPerCategory(state, categories).get(category.id) ?? 0;
    categoryDeleteName.textContent = category.name;
    // Its items can go to another category, or stay without one.
    moveField.hidden = items === 0;
    moveCount.textContent = itemsCount(items);
    const others = categories.filter((entry) => entry.id !== category.id);
    setOptions(moveTo, [[NO_CATEGORY, 'No category'], ...choicesOf(others)], NO_CATEGORY);
    moveTo.value = NO_CATEGORY;
    categoryDeleteDialog.returnValue = '';
    // Opens on top of the form; "Cancel" goes back to it.
    categoryDeleteDialog.showModal();
  });

  categoryDeleteDialog.addEventListener('close', () => {
    const category = findCategory(editingCategoryId);
    if (categoryDeleteDialog.returnValue !== 'confirm' || !category) return;
    const to = findCategory(moveTo.value);
    let saved = true;
    if (state.items.some((item) => item.category === category.id)) {
      saved = save(moveItems(state, category.id, to?.id ?? NO_CATEGORY));
    }
    saved = saveCategories(removeCategory(categoriesState, category.id)) && saved;
    if (saved) {
      announce(
        to
          ? `Deleted category ${category.name}. Its items are in ${to.name} now.`
          : `Deleted category ${category.name}.`,
      );
    }
    editingCategoryId = null;
    categoryOpener = addCategoryButton;
    categoryEditor.close();
  });

  addCategoryButton.addEventListener('click', () => {
    if (categoriesOf(categoriesState).length >= MAX_CATEGORIES) {
      say(
        `You have ${MAX_CATEGORIES} categories, the most Shelf can keep. Delete one to add another.`,
      );
      return;
    }
    openCategoryEditor(null);
  });

  categoryList.addEventListener('click', (event) => {
    const id = (event.target as Element).closest<HTMLElement>('[data-category-id]')?.dataset[
      'categoryId'
    ];
    const category = findCategory(id ?? null);
    if (category) openCategoryEditor(category);
  });

  /** After changes from another device or tab: keyboard focus stays where it was (audit G-3). */
  function refresh(): void {
    state = store.load();
    categoriesState = categoriesStore.load();
    // The item open in the form was deleted elsewhere: saving adds it back.
    keepFocus(render, addButton);
  }

  // If Shelf is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === store.key || event.key === categoriesStore.key) refresh();
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
      // A category renamed on two devices: the newest name wins.
      syncedStore({
        store: categoriesStore,
        items: (value) => value.changes,
        withItems: (value, changes) => ({ ...value, changes }),
      }),
    ],
    onChange: refresh,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  render();
}
