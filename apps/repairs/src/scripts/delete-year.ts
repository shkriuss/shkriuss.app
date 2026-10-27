/**
 * Repairs: "Delete a year…", which deletes every repair of one year and
 * their photos, to make room. Split from repairs.ts (audit 3 J-9).
 */
import { required } from '@shkriuss/ui/dom';
import { showProblem } from '@shkriuss/ui/problem';
import {
  countLabel,
  photoFiles,
  photosOf,
  removeYear,
  repairsIn,
  repairYears,
  type RepairsState,
} from '../lib/repairs.ts';
import { deletePhotos } from './photos.ts';

/** What "Delete a year…" needs from the page. */
export interface DeleteYearPage {
  /** The repairs as they are now. */
  repairs(): RepairsState;
  /** Saves, shows the change, and tells other devices. False if it couldn't be saved. */
  save(next: { repairs: RepairsState }, message: string): boolean;
  /** Tells sync about photo files removed. */
  filesRemoved(files: readonly string[]): void;
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

  const repairsCount = (count: number) => countLabel(count, 'repair', 'repairs');

  /** How many repairs the year chosen has (0 if it has none now). */
  const yearCount = (year: string) =>
    repairYears(page.repairs()).find((entry) => entry.year === year)?.count ?? 0;

  /** The year the dialog shows, and how many repairs it says go. */
  let shownYear = { year: '', count: 0 };

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    shownYear = { year, count: yearCount(year) };
    const count = repairsCount(shownYear.count);
    yearText.textContent = `The ${count} from ${year} will be deleted, with their photos. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years with repairs to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = repairYears(page.repairs());
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${repairsCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest repairs are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  function openYears(): void {
    if (page.repairs().repairs.length === 0) {
      // Read out again when it's the same message as last time: a screen
      // reader reads a status line only when it changes, so then a no-break
      // space, which can't be heard, goes on the end (audit 5 G-8).
      const message = 'There are no repairs to delete.';
      csvStatus.textContent = csvStatus.textContent === message ? `${message} ` : message;
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
    const repairs = page.repairs();
    const gone = repairsIn(repairs, year);
    yearDialog.close();
    deleteYearButton.focus();
    if (gone.length === 0) return;
    // Like deleting repairs one by one: other devices delete them too, and
    // their photos go, once the repairs are deleted for good (audit 4 F2-8).
    const saved = page.save(
      { repairs: removeYear(repairs, year) },
      `Deleted ${repairsCount(gone.length)} from ${year}.`,
    );
    if (!saved) return;
    void deletePhotos(photosOf(gone));
    page.filesRemoved(photoFiles(photosOf(gone)));
  });

  return {
    open: openYears,
    refresh() {
      if (!yearDialog.open) return;
      // The year chosen changed: the dialog closes, and says why, so its
      // button doesn't delete another year, or more than it said (audit 4 F2-1).
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
          ? `The repairs from ${year} were deleted on another device.`
          : `${year} has ${repairsCount(now)} now, after changes on another device. Nothing was deleted.`,
      );
    },
  };
}
