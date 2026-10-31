/**
 * Budget's forms: the entry form (an expense, income or a refund, new or
 * changed), the category form, and "Delete this?" for either. Split from
 * budget.ts and loaded after the page, once it has nothing else to do, so
 * opening Budget loads less and stays within its size budget (audit 5 J-2).
 */
import { monthOf, today } from '@shkriuss/dates';
import { withEdits } from '@shkriuss/sync/edits';
import { required, showFieldProblems } from '@shkriuss/ui/dom';
import { showProblem } from '@shkriuss/ui/problem';
import { watchTextLimits } from '@shkriuss/ui/text-limit';
import {
  currencyOf,
  dayLabel,
  formatMoney,
  hasCategory,
  KINDS,
  monthLabel,
  readCategory,
  readEntry,
  removeCategory,
  removeEntry,
  saveCategory,
  saveEntry,
  suggestedDay,
  toCategoryForm,
  toEntryForm,
  type CategoriesState,
  type Category,
  type CategoryForm,
  type EntriesState,
  type Entry,
  type EntryForm,
  type Kind,
  type SettingsState,
} from '../lib/budget.ts';

/** What the forms need from the page. */
export interface FormsPage {
  /** The lists and settings as they are now. */
  data(): { categories: CategoriesState; entries: EntriesState; settings: SettingsState };
  /** The month shown ("2026-10"). */
  month(): string;
  /** Shows a month: the one an entry was just saved in (drawn at the save). */
  showMonth(month: string): void;
  /** Saves, shows the change, and tells other devices. */
  save(next: { categories?: CategoriesState; entries?: EntriesState }, message: string): void;
  /** After saving an entry: focus on it in the list, or on "Add expense". */
  focusEntry(id: string): void;
  /** After saving a category: focus on it in the list, or on "New category". */
  focusCategory(id: string): void;
}

export interface Forms {
  /** Opens the entry form: for an entry, or for a new one of `kind`. */
  openEntry(entry: Entry | undefined, kind?: Kind): void;
  /** Opens the category form: for a category, or for a new one. */
  openCategory(category: Category | undefined): void;
  /** "Delete" in the open form: asks first. */
  askToDelete(type: 'entry' | 'category'): void;
  /**
   * After changes from another device or tab: a form whose entry or
   * category was deleted there closes, and says why.
   */
  refresh(): void;
}

/** Shows a form's problems; focuses the first. Returns true if there are any. */
const showProblems = (
  form: HTMLFormElement,
  names: readonly string[],
  problems: Partial<Record<string, string>>,
): boolean => showFieldProblems(form, names, problems, { focusFirst: true });

export function mountForms(root: ParentNode, page: FormsPage): Forms {
  const addExpense = required<HTMLButtonElement>(root, '[data-action="add-expense"]');
  const newCategoryButton = required<HTMLButtonElement>(root, '[data-action="new-category"]');
  const entryDialog = required<HTMLDialogElement>(root, '[data-entry-dialog]');
  const entryForm = required<HTMLFormElement>(entryDialog, '[data-entry-form]');
  const entryTitle = required<HTMLElement>(entryDialog, '[data-entry-title]');
  const categoryField = required<HTMLElement>(entryForm, '[data-category-field]');
  const categorySelect = required<HTMLSelectElement>(entryForm, '[data-category-select]');
  const categoryDialog = required<HTMLDialogElement>(root, '[data-category-dialog]');
  const categoryForm = required<HTMLFormElement>(categoryDialog, '[data-category-form]');
  const categoryTitle = required<HTMLElement>(categoryDialog, '[data-category-title]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');

  /** What's in the forms: the entry or category being changed (null: a new one). */
  let editingEntry: string | null = null;
  let editingCategory: string | null = null;
  /** The forms as they opened, to tell what the person changed (see withEdits). */
  let openedEntry: EntryForm | null = null;
  let openedCategory: CategoryForm | null = null;
  let deleting: { type: 'entry' | 'category'; id: string } | null = null;

  const money = (amount: number) => formatMoney(amount, currencyOf(page.data().settings));
  const findEntry = (id: string | null | undefined) =>
    page.data().entries.entries.find((entry) => entry.id === id);
  const findCategory = (id: string | null | undefined) =>
    page.data().categories.categories.find((category) => category.id === id);
  /** "Income", or an expense's or a refund's category. */
  const categoryName = (entry: Entry) =>
    entry.kind === 'income' ? 'Income' : (findCategory(entry.category)?.name ?? 'No category');

  // ---------- Entries ----------

  const kindOf = (): Kind =>
    KINDS.find((kind) => kind === (entryForm.elements.namedItem('kind') as RadioNodeList).value) ??
    'expense';

  /** The form's title: what it adds (it follows the type chosen), or "Change entry". */
  function showTitle(): void {
    const adding = { expense: 'Add expense', income: 'Add income', refund: 'Add refund' };
    entryTitle.textContent = editingEntry ? 'Change entry' : adding[kindOf()];
  }

  function showCategoryField(): void {
    categoryField.hidden = !hasCategory(kindOf());
  }

  // A paste longer than a box takes is cut by the browser: say so (audit 4 F2-7).
  const entryLimits = watchTextLimits(entryForm);
  const categoryLimits = watchTextLimits(categoryForm);

  function openEntry(entry: Entry | undefined, kind: Kind = 'expense'): void {
    editingEntry = entry?.id ?? null;
    entryLimits.clear();
    openedEntry = entry ? toEntryForm(entry) : null;
    const values = openedEntry ?? {
      kind,
      amount: '',
      date: suggestedDay(page.month(), today()),
      category: '',
      note: '',
    };
    categorySelect.replaceChildren(
      new Option('No category', ''),
      ...page
        .data()
        .categories.categories.map((category) => new Option(category.name, category.id)),
    );
    for (const [name, value] of Object.entries(values)) {
      (entryForm.elements.namedItem(name) as { value: string }).value = value;
    }
    required<HTMLElement>(entryForm, '[data-action="delete-entry"]').hidden = !entry;
    showProblems(entryForm, ['kind', 'amount', 'date', 'note'], {});
    showTitle();
    showCategoryField();
    entryDialog.showModal();
    // The amount first: the type is already chosen by the button tapped.
    (entryForm.elements.namedItem('amount') as HTMLInputElement).focus();
  }

  entryForm.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name !== 'kind') return;
    showTitle();
    showCategoryField();
  });

  entryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name: string) => (entryForm.elements.namedItem(name) as { value: string }).value;
    const edited: EntryForm = {
      kind: kindOf(),
      amount: value('amount'),
      date: value('date'),
      category: value('category'),
      note: value('note'),
    };
    // A sync or another tab may have changed the entry while the form was
    // open: keep that, and put on only what was changed here (audit 3 F2-1).
    const { categories, entries, settings } = page.data();
    const current = findEntry(editingEntry);
    const read = readEntry(
      current && openedEntry ? withEdits(openedEntry, edited, toEntryForm(current)) : edited,
      editingEntry ?? crypto.randomUUID(),
      current ? null : entries.entries.length,
      categories,
      { currency: currencyOf(settings), saved: current },
    );
    if (!read.entry) {
      showProblems(entryForm, ['kind', 'amount', 'date', 'note'], read.problems);
      return;
    }
    const { entry } = read;
    entryDialog.close();
    // Show the month it's in.
    const month = monthOf(entry.date);
    const moved = month !== page.month();
    page.showMonth(month);
    const what =
      entry.kind === 'income'
        ? `Saved ${money(entry.amount)} income`
        : entry.kind === 'refund'
          ? `Saved a ${money(entry.amount)} refund on ${categoryName(entry)}`
          : `Saved ${money(entry.amount)} on ${categoryName(entry)}`;
    page.save(
      { entries: saveEntry(entries, entry) },
      moved ? `${what}, in ${monthLabel(month)}.` : `${what}.`,
    );
    page.focusEntry(entry.id);
  });

  // ---------- Categories ----------

  function openCategory(category: Category | undefined): void {
    editingCategory = category?.id ?? null;
    categoryLimits.clear();
    openedCategory = category ? toCategoryForm(category) : null;
    categoryTitle.textContent = category ? 'Change category' : 'New category';
    const values = openedCategory ?? { name: '', limit: '' };
    (categoryForm.elements.namedItem('name') as HTMLInputElement).value = values.name;
    (categoryForm.elements.namedItem('limit') as HTMLInputElement).value = values.limit;
    required<HTMLElement>(categoryForm, '[data-action="delete-category"]').hidden = !category;
    showProblems(categoryForm, ['name', 'limit'], {});
    categoryDialog.showModal();
  }

  categoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const edited: CategoryForm = {
      name: (categoryForm.elements.namedItem('name') as HTMLInputElement).value,
      limit: (categoryForm.elements.namedItem('limit') as HTMLInputElement).value,
    };
    // Changed meanwhile on another device or tab: only what was changed here goes on it.
    const { categories, settings } = page.data();
    const current = findCategory(editingCategory);
    const read = readCategory(
      current && openedCategory
        ? withEdits(openedCategory, edited, toCategoryForm(current))
        : edited,
      editingCategory ?? crypto.randomUUID(),
      categories,
      { currency: currencyOf(settings) },
    );
    if (!read.category) {
      showProblems(categoryForm, ['name', 'limit'], read.problems);
      return;
    }
    const { category } = read;
    categoryDialog.close();
    page.save({ categories: saveCategory(categories, category) }, `Saved ${category.name}.`);
    page.focusCategory(category.id);
  });

  // ---------- Deleting ----------

  function askToDelete(type: 'entry' | 'category'): void {
    if (type === 'entry') {
      const entry = findEntry(editingEntry);
      if (!entry) return;
      deleting = { type, id: entry.id };
      deleteTitle.textContent = 'Delete this entry?';
      const refund = entry.kind === 'refund' ? ' refund' : '';
      deleteText.textContent = `${money(entry.amount)}${refund} (${categoryName(entry)}, ${dayLabel(entry.date)}) will be removed. This can’t be undone.`;
    } else {
      const category = findCategory(editingCategory);
      if (!category) return;
      deleting = { type, id: category.id };
      deleteTitle.textContent = 'Delete this category?';
      deleteText.textContent = `“${category.name}” will be removed. Its expenses stay, under “No category”. This can’t be undone.`;
    }
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  }

  deleteDialog.addEventListener('close', () => {
    const target = deleting;
    deleting = null;
    if (deleteDialog.returnValue !== 'confirm' || !target) return;
    if (target.type === 'entry') {
      const entry = findEntry(target.id);
      entryDialog.close();
      if (!entry) return;
      page.save({ entries: removeEntry(page.data().entries, entry.id) }, 'Deleted the entry.');
      addExpense.focus();
    } else {
      const category = findCategory(target.id);
      categoryDialog.close();
      if (!category) return;
      page.save(
        { categories: removeCategory(page.data().categories, category.id) },
        `Deleted ${category.name}.`,
      );
      newCategoryButton.focus();
    }
  });

  entryDialog.addEventListener('close', () => {
    editingEntry = null;
  });
  categoryDialog.addEventListener('close', () => {
    editingCategory = null;
  });

  return {
    openEntry,
    openCategory,
    askToDelete,
    refresh() {
      // What's being changed was deleted on another device or tab: what was
      // typed is gone with the form, so it says why (audit 3 G-6).
      if (editingEntry !== null && !findEntry(editingEntry)) {
        entryDialog.close();
        showProblem('That entry was deleted on another device.');
      }
      if (editingCategory !== null && !findCategory(editingCategory)) {
        categoryDialog.close();
        showProblem('That category was deleted on another device.');
      }
    },
  };
}
