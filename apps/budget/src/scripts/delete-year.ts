/**
 * Budget: "Delete a year…", which deletes every entry of one year, to make
 * room. Split from budget.ts and loaded after the page, once it has nothing
 * else to do, so opening Budget loads less (audit 5 J-2).
 */
import { required } from '@shkriuss/ui/dom';
import { showProblem } from '@shkriuss/ui/problem';
import { entriesCount, entryYears, removeYear, type EntriesState } from '../lib/budget.ts';

/** What "Delete a year…" needs from the page. */
export interface DeleteYearPage {
  /** The entries as they are now. */
  entries(): EntriesState;
  /** Saves, shows the change, and tells other devices. */
  save(next: { entries: EntriesState }, message: string): void;
  /** Puts a message in a status line, read out again if it's the same as last time (budget.ts). */
  say(line: HTMLElement, message: string): void;
}

export interface DeleteYear {
  /** "Delete a year…": opens its dialog, or says there's nothing to delete. */
  open(): void;
  /**
   * After changes from another device or tab: the dialog shows the years
   * there are now, or closes, and says why, when the year chosen changed.
   */
  refresh(): void;
}

export function mountDeleteYear(root: ParentNode, page: DeleteYearPage): DeleteYear {
  const csvStatus = required<HTMLElement>(root, '[data-csv-status]');
  const deleteYearButton = required<HTMLButtonElement>(root, '[data-action="delete-year"]');
  const yearDialog = required<HTMLDialogElement>(root, '[data-year-dialog]');
  const yearForm = required<HTMLFormElement>(yearDialog, '[data-year-form]');
  const yearSelect = required<HTMLSelectElement>(yearForm, '[data-year-select]');
  const yearText = required<HTMLElement>(yearForm, '[data-year-text]');
  const yearConfirm = required<HTMLElement>(yearForm, '[data-year-confirm]');

  /** How many entries the year chosen has (0 if it has none now). */
  const yearCount = (year: string) =>
    entryYears(page.entries()).find((entry) => entry.year === year)?.count ?? 0;

  /** The year the dialog shows, and how many entries it says go. */
  let shownYear = { year: '', count: 0 };

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    shownYear = { year, count: yearCount(year) };
    const count = entriesCount(shownYear.count);
    yearText.textContent = `The ${count} from ${year} will be deleted: expenses, income and refunds. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years with entries to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = entryYears(page.entries());
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${entriesCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest entries are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  function openYears(): void {
    if (page.entries().entries.length === 0) {
      page.say(csvStatus, 'There are no entries to delete.');
      return;
    }
    yearSelect.replaceChildren();
    fillYears();
    required<HTMLElement>(yearForm, '[data-csv-status]').textContent = '';
    yearDialog.showModal();
    yearSelect.focus();
  }

  yearSelect.addEventListener('change', showYear);

  yearForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const year = yearSelect.value;
    const count = yearCount(year);
    yearDialog.close();
    deleteYearButton.focus();
    if (count === 0) return;
    // Like deleting entries one by one, so other devices delete them too.
    page.save(
      { entries: removeYear(page.entries(), year) },
      `Deleted ${entriesCount(count)} from ${year}.`,
    );
  });

  return {
    open: openYears,
    refresh() {
      if (!yearDialog.open) return;
      // The year chosen changed on another device or tab: the dialog closes,
      // and says why, so its button doesn't delete another year, or more
      // than it said (audit 4 F2-1).
      const { year, count } = shownYear;
      const now = yearCount(year);
      if (now === count) {
        fillYears();
        return;
      }
      yearDialog.close();
      deleteYearButton.focus();
      showProblem(
        now === 0
          ? `The entries from ${year} were deleted on another device.`
          : `${year} has ${entriesCount(now)} now, after changes on another device. Nothing was deleted.`,
      );
    },
  };
}
