/**
 * Repairs' page behaviour: connects pages/index.astro to the rules in
 * lib/repairs.ts, saves on the device, and syncs the vehicles, repairs,
 * settings and photos when sync is on. Here: the lists, search, settings,
 * deleting, and keeping up with other devices and tabs. The forms are in
 * repair-form.ts (its photos in form-photos.ts) and vehicle-form.ts.
 * "Delete a year…", which deletes a year's repairs and their photos to make
 * room, is in delete-year.ts. Photos: photos.ts; looking at them,
 * photo-viewer.ts. The forms, "Delete a year…" and the photo viewer load
 * the first time they open (later()), so opening the page loads less.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { PAGE_SIZE, shownCount, waitForTyping } from '@shkriuss/ui/long-lists';
import { reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { typedText } from '@shkriuss/ui/typed-text';
import { site } from 'virtual:shkriuss/site';
import {
  byDay,
  countLabel,
  CURRENCIES,
  currencyOf,
  dateLabel,
  dayLabel,
  emptyRepairs,
  emptySettings,
  emptyVehicles,
  findRepairs,
  formatHours,
  formatMileage,
  formatMoney,
  isRepairsState,
  isSettingsState,
  isVehiclesState,
  migrateRepairs,
  modelNames,
  partCost,
  partLabel,
  partNames,
  photoFiles,
  photosOf,
  removeRepair,
  removeVehicle,
  repairCost,
  roomNote,
  setCurrency,
  setUnit,
  sortedVehicles,
  systemNames,
  toCsv,
  totals,
  unitOf,
  UNITS,
  vehicleName,
  vehicleSummaries,
  withSettings,
  type Repair,
  type RepairsState,
  type SettingsState,
  type Totals,
  type VehiclesState,
  type VehicleSummary,
  REPAIRS_VERSION,
  VEHICLES_VERSION,
} from '../lib/repairs.ts';
import {
  deletePhotos,
  deleteUnusedPhotos,
  downloadPhotosWith,
  readPhotoFile,
  thumbUrl,
} from './photos.ts';
import { required } from '@shkriuss/ui/dom';
import type { DeleteYear } from './delete-year.ts';
import type { PhotoViewer } from './photo-viewer.ts';
import type { RepairFormControls } from './repair-form.ts';
import type { VehicleFormControls } from './vehicle-form.ts';

const vehiclesStore = createStore<VehiclesState>({
  key: 'repairs-vehicles',
  version: VEHICLES_VERSION,
  fallback: emptyVehicles,
  validate: isVehiclesState,
});

// Version 2 added hours worked, labour cost and part prices; version 3, photos.
const repairsStore = createStore<RepairsState>({
  key: 'repairs',
  version: REPAIRS_VERSION,
  fallback: emptyRepairs,
  validate: isRepairsState,
  migrate: migrateRepairs,
});

const settingsStore = createStore<SettingsState>({
  key: 'repairs-settings',
  version: 1,
  fallback: emptySettings,
  validate: isSettingsState,
});

/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;

/** A part of the page that loads the first time it's used (later()). */
interface Later<T> {
  /** The part, once loaded. Before, it was never opened: nothing in it needs keeping up. */
  readonly now: T | null;
  /** Loads the part if need be, then does `act` with it (while loading, only the last asked). */
  use(act: (part: T) => void): void;
}

/**
 * A part of the page loaded with import() the first time it's used: the
 * forms, "Delete a year…" and the photo viewer. Opening the page then loads
 * less, and stays within its size budget (audit 4 J-6).
 */
function later<T>(load: () => Promise<T>): Later<T> {
  let now: T | null = null;
  let loading: Promise<void> | null = null;
  let next: ((part: T) => void) | null = null;
  return {
    get now() {
      return now;
    },
    use(act) {
      if (now) {
        act(now);
        return;
      }
      next = act;
      loading ??= load().then(
        (part) => {
          now = part;
          next?.(part);
          next = null;
        },
        () => {
          // The next tap tries again.
          loading = null;
          next = null;
          showProblem('Repairs couldn’t open that. Please try again.');
        },
      );
    },
  };
}

export function mountRepairs(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const newRepairButton = required<HTMLButtonElement>(root, '[data-action="new-repair"]');
  const repairsHeading = required<HTMLElement>(root, '[data-repairs-heading]');
  const searchInput = required<HTMLInputElement>(root, '[data-search]');
  const vehicleFilter = required<HTMLSelectElement>(root, '[data-vehicle-filter]');
  const resultCount = required<HTMLElement>(root, '[data-result-count]');
  const noRepairs = required<HTMLElement>(root, '[data-no-repairs]');
  const noMatches = required<HTMLElement>(root, '[data-no-matches]');
  const daysList = required<HTMLElement>(root, '[data-days]');
  const more = required<HTMLElement>(root, '[data-more]');
  const noVehicles = required<HTMLElement>(root, '[data-no-vehicles]');
  const vehicleList = required<HTMLUListElement>(root, '[data-vehicles]');
  const newVehicleButton = required<HTMLButtonElement>(root, '[data-action="new-vehicle"]');
  const unitSelect = required<HTMLSelectElement>(root, '[data-unit]');
  const currencySelect = required<HTMLSelectElement>(root, '[data-currency]');
  const dayTemplate = required<HTMLTemplateElement>(root, '[data-day-template]');
  const repairTemplate = required<HTMLTemplateElement>(root, '[data-repair-template]');
  const vehicleTemplate = required<HTMLTemplateElement>(root, '[data-vehicle-template]');
  const thumbTemplate = required<HTMLTemplateElement>(root, '[data-thumb-template]');
  const suggestions = {
    vehicles: required<HTMLDataListElement>(root, '[data-vehicle-names]'),
    systems: required<HTMLDataListElement>(root, '[data-system-names]'),
    parts: required<HTMLDataListElement>(root, '[data-part-names]'),
    models: required<HTMLDataListElement>(root, '[data-model-names]'),
  };

  const repairDialog = required<HTMLDialogElement>(root, '[data-repair-dialog]');
  const mileageLabel = required<HTMLElement>(repairDialog, '[data-mileage-label]');
  const labourHint = required<HTMLElement>(repairDialog, '[data-labour-hint]');
  const csvStatus = required<HTMLElement>(root, '[data-csv-status]');
  const vehicleDialog = required<HTMLDialogElement>(root, '[data-vehicle-dialog]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');
  const roomText = required<HTMLElement>(root, '[data-room-note]');

  let vehicles = vehiclesStore.load();
  let repairs = repairsStore.load();
  let settings = settingsStore.load();
  let shown = PAGE_SIZE;
  /** A repair just saved: never hidden behind "Show more" (shownCount). */
  let reveal: string | null = null;
  /** What the delete dialog would delete (for a vehicle, with how many repairs it said go too). */
  let deleting: { type: 'repair' | 'vehicle'; id: string; count?: number } | null = null;
  let syncWasOn = false;
  let announceTimer: number | undefined;
  const photoViewer = later<PhotoViewer>(() =>
    import('./photo-viewer.ts').then(({ mountPhotoViewer }) =>
      mountPhotoViewer(root, () => vehicles),
    ),
  );

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const mileage = (value: number) => formatMileage(value, unitOf(settings));
  const money = (amount: number) => formatMoney(amount, currencyOf(settings));
  /** "6.5 hours · $250.00", or "" if neither was noted. */
  const totalsText = ({ hours, cost }: Totals): string =>
    [hours === null ? '' : formatHours(hours), cost === null ? '' : money(cost)]
      .filter(Boolean)
      .join(' · ');
  const findVehicle = (id: string | null | undefined) =>
    vehicles.vehicles.find((vehicle) => vehicle.id === id);
  const findRepair = (id: string | null | undefined) =>
    repairs.repairs.find((repair) => repair.id === id);
  const filterVehicle = (): string | null => vehicleFilter.value || null;

  /** Saves, shows the change, and tells other devices. */
  function save(
    next: { vehicles?: VehiclesState; repairs?: RepairsState; settings?: SettingsState },
    message: string,
  ): void {
    let ok = true;
    if (next.vehicles) {
      vehicles = next.vehicles;
      ok = vehiclesStore.save(vehicles) && ok;
    }
    if (next.repairs) {
      repairs = next.repairs;
      ok = repairsStore.save(repairs) && ok;
    }
    if (next.settings) {
      settings = next.settings;
      ok = settingsStore.save(settings) && ok;
    }
    if (reportSave(ok)) announce(message);
    render();
    sync.changed();
  }

  // ---------- Showing it ----------

  function fillList(list: HTMLDataListElement, values: readonly string[]): void {
    list.replaceChildren(...values.map((value) => new Option('', value)));
  }

  function renderRepair(repair: Repair): HTMLLIElement {
    const fragment = repairTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = repair.id;
    required<HTMLElement>(item, '[data-title]').textContent = vehicleName(vehicles, repair.vehicle);
    const meta = required<HTMLElement>(item, '[data-meta]');
    meta.textContent = repair.mileage === null ? '' : mileage(repair.mileage);
    if (repair.system) {
      meta.append(repair.mileage === null ? '' : ' · ', typedText(repair.system));
    }
    const rows = {
      problem: required<HTMLElement>(item, '[data-row="problem"]'),
      work: required<HTMLElement>(item, '[data-row="work"]'),
      parts: required<HTMLElement>(item, '[data-row="parts"]'),
      hours: required<HTMLElement>(item, '[data-row="hours"]'),
      cost: required<HTMLElement>(item, '[data-row="cost"]'),
    };
    if (repair.problem) required<HTMLElement>(rows.problem, 'dd').textContent = repair.problem;
    else rows.problem.remove();
    if (repair.work) required<HTMLElement>(rows.work, 'dd').textContent = repair.work;
    else rows.work.remove();
    if (repair.parts.length > 0) {
      required<HTMLUListElement>(rows.parts, '[data-parts]').replaceChildren(
        ...repair.parts.map((part) => {
          const line = document.createElement('li');
          line.dir = 'auto';
          const price = partCost(part, currencyOf(settings));
          line.textContent =
            price === null ? partLabel(part) : `${partLabel(part)} · ${money(price)}`;
          return line;
        }),
      );
    } else rows.parts.remove();
    if (repair.hours !== null) {
      required<HTMLElement>(rows.hours, 'dd').textContent = formatHours(repair.hours);
    } else rows.hours.remove();
    const cost = repairCost(repair, currencyOf(settings));
    if (cost) {
      // "$140.00 · parts $90.00, labour $50.00" when it's both.
      required<HTMLElement>(rows.cost, 'dd').textContent =
        cost.parts > 0 && cost.labour > 0
          ? `${money(cost.total)} · parts ${money(cost.parts)}, labour ${money(cost.labour)}`
          : money(cost.total);
    } else rows.cost.remove();
    const photosRow = required<HTMLElement>(item, '[data-row="photos"]');
    if (repair.photos.length > 0) void fillThumbs(photosRow, repair);
    else photosRow.remove();
    return item;
  }

  /** Shows a repair's thumbnails (once they're loaded), and says how many are elsewhere. */
  async function fillThumbs(row: HTMLElement, repair: Repair): Promise<void> {
    const list = required<HTMLUListElement>(row, '[data-photos]');
    const urls = await Promise.all(repair.photos.map(thumbUrl));
    const shown = repair.photos.flatMap((id, index) => {
      const url = urls[index];
      return url ? [{ id, url }] : [];
    });
    // Named with their repair: "Photo 1" in every repair said nothing of which (audit 3 G-8).
    const which = `${vehicleName(vehicles, repair.vehicle)}, ${dateLabel(repair.date)}`;
    list.replaceChildren(
      ...shown.map(({ id, url }, index) => {
        const fragment = thumbTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        required<HTMLElement>(entry, '[data-action="view-photo"]').dataset['photo'] = id;
        const image = required<HTMLImageElement>(entry, '[data-thumb]');
        image.src = url;
        image.alt = `Photo ${index + 1} of ${shown.length}, ${which}`;
        return entry;
      }),
    );
    const elsewhere = repair.photos.length - shown.length;
    // With sync on, they come later (refreshMissingThumbs).
    row.toggleAttribute('data-missing', elsewhere > 0);
    required<HTMLElement>(row, '[data-photos-elsewhere]').textContent =
      elsewhere === 0
        ? ''
        : sync.status().on
          ? `${countLabel(elsewhere, 'photo hasn’t', 'photos haven’t')} arrived yet`
          : `${countLabel(elsewhere, 'photo', 'photos')} on another device`;
  }

  /** After a sync: tries again to show photos that hadn't arrived (where focus isn't). */
  function refreshMissingThumbs(): void {
    for (const row of daysList.querySelectorAll<HTMLElement>('[data-row="photos"][data-missing]')) {
      if (row.contains(document.activeElement)) continue;
      const repair = findRepair(row.closest<HTMLElement>('li[data-id]')?.dataset['id']);
      if (repair) void fillThumbs(row, repair);
    }
  }

  function renderRepairs(): void {
    const query = searchInput.value;
    const only = filterVehicle();
    const found = findRepairs(repairs, vehicles, { vehicle: only, query });
    const filtered = query.trim() !== '' || only !== null;
    noRepairs.hidden = repairs.repairs.length > 0;
    noMatches.hidden = repairs.repairs.length === 0 || found.length > 0;
    resultCount.hidden = found.length === 0;
    const count = countLabel(found.length, 'repair', 'repairs');
    const on = only ? ` on ${vehicleName(vehicles, only)}` : '';
    const matching = query.trim() ? ` ${found.length === 1 ? 'matches' : 'match'} your search` : '';
    const currency = currencyOf(settings);
    const sums = totalsText(totals(found, currency));
    resultCount.textContent =
      (filtered ? `${count}${on}${matching}` : `${count} in all`) + (sums ? ` · ${sums}.` : '.');

    // Each day's total counts all its repairs, also those after "Show more".
    const dayTotals = new Map(byDay(found).map((day) => [day.date, totals(day.repairs, currency)]));
    // Never hidden by paging: the repair with focus, or one just saved.
    const focused = root.activeElement?.closest<HTMLElement>('[data-id]');
    shown = shownCount(
      found.map((repair) => repair.id),
      shown,
      [reveal, focused?.dataset['id']],
    );
    reveal = null;
    daysList.replaceChildren(
      ...byDay(found.slice(0, shown)).map((day) => {
        const fragment = dayTemplate.content.cloneNode(true) as DocumentFragment;
        const block = required<HTMLElement>(fragment, 'div');
        required<HTMLElement>(block, '[data-day-heading]').textContent = dayLabel(day.date);
        required<HTMLElement>(block, '[data-day-total]').textContent = totalsText(
          dayTotals.get(day.date) ?? totals(day.repairs, currency),
        );
        required<HTMLUListElement>(block, '[data-day-list]').replaceChildren(
          ...day.repairs.map(renderRepair),
        );
        return block;
      }),
    );
    more.hidden = found.length <= shown;
  }

  function summaryText(summary: VehicleSummary): string {
    if (summary.repairs === 0) return 'No repairs yet';
    return [
      countLabel(summary.repairs, 'repair', 'repairs'),
      summary.lastDate ? `last on ${dateLabel(summary.lastDate)}` : '',
      summary.lastMileage === null ? '' : mileage(summary.lastMileage),
      summary.cost === null ? '' : `${money(summary.cost)} in all`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function renderVehicle(summary: VehicleSummary): HTMLLIElement {
    const fragment = vehicleTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    const { vehicle } = summary;
    item.dataset['id'] = vehicle.id;
    required<HTMLElement>(item, '[data-name]').textContent = vehicle.name;
    required<HTMLElement>(item, '[data-details]').textContent = [vehicle.model, vehicle.plate]
      .filter(Boolean)
      .join(' · ');
    required<HTMLElement>(item, '[data-summary]').textContent = summaryText(summary);
    const showButton = required<HTMLButtonElement>(item, '[data-action="show-vehicle"]');
    const editButton = required<HTMLButtonElement>(item, '[data-action="edit-vehicle"]');
    // "Show repairs on Bus 105", "Edit Bus 105" for screen readers.
    required<HTMLElement>(showButton, '[data-hidden-name]').textContent = ` on ${vehicle.name}`;
    required<HTMLElement>(editButton, '[data-hidden-name]').textContent = ` ${vehicle.name}`;
    showButton.hidden = summary.repairs === 0;
    return item;
  }

  function renderVehicles(): void {
    const summaries = vehicleSummaries(vehicles, repairs, currencyOf(settings));
    noVehicles.hidden = summaries.length > 0;
    vehicleList.replaceChildren(...summaries.map(renderVehicle));

    // The filter: all vehicles, then each by name. Keep the choice if it's still there.
    const chosen = vehicleFilter.value;
    vehicleFilter.replaceChildren(
      new Option('All vehicles', ''),
      ...summaries.map((summary) => new Option(summary.vehicle.name, summary.vehicle.id)),
    );
    vehicleFilter.value = findVehicle(chosen) ? chosen : '';
  }

  function render(): void {
    const room = roomNote(repairs.repairs.length);
    roomText.hidden = room === null;
    roomText.textContent = room ?? '';
    renderVehicles();
    renderRepairs();
    unitSelect.value = unitOf(settings);
    currencySelect.value = currencyOf(settings);
    mileageLabel.textContent = `Mileage (${unitOf(settings)})`;
    labourHint.textContent = `In ${currencyOf(settings)}. Each part’s price goes with the part.`;
    // Only the names: no summaries to work out again (audit 4 F2-2).
    fillList(
      suggestions.vehicles,
      sortedVehicles(vehicles).map((vehicle) => vehicle.name),
    );
    fillList(suggestions.systems, systemNames(repairs));
    fillList(
      suggestions.parts,
      partNames(repairs).map((part) => part.name),
    );
    fillList(suggestions.models, modelNames(vehicles));
  }

  /** After saving: focus a button in a list, or `fallback` if it isn't shown. */
  function focusItem(list: HTMLElement, id: string, action: string, fallback: HTMLElement): void {
    const button = list.querySelector<HTMLElement>(
      `li[data-id="${CSS.escape(id)}"] [data-action="${action}"]`,
    );
    (button ?? fallback).focus();
  }

  // ---------- The forms: repair-form.ts, vehicle-form.ts ----------

  const repairEditor = later<RepairFormControls>(() =>
    import('./repair-form.ts').then(({ mountRepairForm }) =>
      mountRepairForm(root, {
        data: () => ({ vehicles, repairs, settings }),
        shownVehicle: () => findVehicle(filterVehicle()),
        save,
        keepShown(id) {
          reveal = id;
        },
        focusRepair: (id) => focusItem(daysList, id, 'edit-repair', newRepairButton),
        syncOn: () => sync.status().on,
        filesAdded: (files) => sync.filesAdded(files),
        filesRemoved: (files) => sync.filesRemoved(files),
      }),
    ),
  );

  const vehicleEditor = later<VehicleFormControls>(() =>
    import('./vehicle-form.ts').then(({ mountVehicleForm }) =>
      mountVehicleForm(root, {
        vehicles: () => vehicles,
        save,
        focusVehicle: (id) => focusItem(vehicleList, id, 'edit-vehicle', newVehicleButton),
      }),
    ),
  );

  // ---------- Deleting ----------

  const repairsOf = (vehicle: string) =>
    repairs.repairs.filter((repair) => repair.vehicle === vehicle);

  function askToDelete(type: 'repair' | 'vehicle'): void {
    if (type === 'repair') {
      const repair = findRepair(repairEditor.now?.editing());
      if (!repair) return;
      deleting = { type, id: repair.id };
      deleteTitle.textContent = 'Delete this repair?';
      deleteText.textContent = `The repair on ${vehicleName(vehicles, repair.vehicle)} on ${dateLabel(repair.date)} will be removed.`;
    } else {
      const vehicle = findVehicle(vehicleEditor.now?.editing());
      if (!vehicle) return;
      const count = repairsOf(vehicle.id).length;
      deleting = { type, id: vehicle.id, count };
      deleteTitle.textContent = `Delete ${vehicle.name}?`;
      deleteText.textContent =
        count === 0
          ? `${vehicle.name} will be removed. It has no repairs.`
          : `${vehicle.name} and its ${countLabel(count, 'repair', 'repairs')} will be removed.`;
    }
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  }

  deleteDialog.addEventListener('close', () => {
    const target = deleting;
    deleting = null;
    if (deleteDialog.returnValue !== 'confirm' || !target) return;
    if (target.type === 'repair') {
      repairDialog.close();
      const repair = findRepair(target.id);
      if (!repair) return;
      save({ repairs: removeRepair(repairs, repair.id) }, 'Deleted the repair.');
      void deletePhotos(repair.photos);
      sync.filesRemoved(photoFiles(repair.photos));
      newRepairButton.focus();
    } else {
      const vehicle = findVehicle(target.id);
      vehicleDialog.close();
      if (!vehicle) return;
      const own = repairsOf(vehicle.id);
      const count = own.length;
      void deletePhotos(photosOf(own));
      sync.filesRemoved(photoFiles(photosOf(own)));
      save(
        removeVehicle(vehicles, repairs, vehicle.id),
        count === 0
          ? `Deleted ${vehicle.name}.`
          : `Deleted ${vehicle.name} and its ${countLabel(count, 'repair', 'repairs')}.`,
      );
      newVehicleButton.focus();
    }
  });

  // ---------- Deleting a year: delete-year.ts ----------

  const yearDeleter = later<DeleteYear>(() =>
    import('./delete-year.ts').then(({ mountDeleteYear }) =>
      mountDeleteYear(root, {
        repairs: () => repairs,
        save,
        filesRemoved: (files) => sync.filesRemoved(files),
      }),
    ),
  );

  // ---------- Everything else ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    const id = button?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    switch (action) {
      case 'new-repair':
        repairEditor.use((form) => form.open(undefined));
        break;
      case 'edit-repair':
        // As it is once the form has loaded.
        repairEditor.use((form) => {
          const repair = findRepair(id);
          if (repair) form.open(repair);
        });
        break;
      case 'add-part':
        repairEditor.now?.addPart();
        break;
      case 'remove-part':
        repairEditor.now?.removePart(button?.closest('li'));
        break;
      case 'new-vehicle':
        vehicleEditor.use((form) => form.open(undefined));
        break;
      case 'edit-vehicle':
        vehicleEditor.use((form) => {
          const vehicle = findVehicle(id);
          if (vehicle) form.open(vehicle);
        });
        break;
      case 'show-vehicle': {
        const vehicle = findVehicle(id);
        if (!vehicle) break;
        vehicleFilter.value = vehicle.id;
        searchInput.value = '';
        shown = PAGE_SIZE;
        renderRepairs();
        repairsHeading.focus();
        announce(`Showing the repairs on ${vehicle.name}.`);
        break;
      }
      case 'more': {
        // Focus carries on from the first repair just shown (audit G-5).
        const first = shown;
        shown += PAGE_SIZE;
        renderRepairs();
        daysList.querySelectorAll<HTMLElement>('[data-action="edit-repair"]')[first]?.focus();
        break;
      }
      case 'add-photos':
        repairEditor.now?.pickPhotos();
        break;
      case 'remove-photo': {
        const photo = button?.closest<HTMLElement>('li[data-photo]')?.dataset['photo'];
        if (photo) repairEditor.now?.removePhoto(photo);
        break;
      }
      case 'view-photo': {
        const repair = findRepair(id);
        const photo = button?.dataset['photo'];
        if (repair && photo) photoViewer.use((viewer) => void viewer.open(repair, photo));
        break;
      }
      case 'previous-photo':
        photoViewer.now?.step(-1);
        break;
      case 'next-photo':
        photoViewer.now?.step(1);
        break;
      case 'save-photo':
        void photoViewer.now?.saveCopy();
        break;
      case 'cancel':
        button?.closest('dialog')?.close();
        break;
      case 'delete-repair':
        askToDelete('repair');
        break;
      case 'delete-vehicle':
        askToDelete('vehicle');
        break;
      case 'delete-year':
        yearDeleter.use((deleter) => deleter.open());
        break;
      case 'csv': {
        // The answer shows under the button tapped (and is read out).
        const status =
          button?.closest('dialog, section')?.querySelector<HTMLElement>('[data-csv-status]') ??
          csvStatus;
        if (repairs.repairs.length === 0) {
          status.textContent = 'There’s nothing to download yet.';
          break;
        }
        downloadFile(`repairs-${today()}.csv`, toCsv(repairs, vehicles, settings), 'text/csv');
        status.textContent = 'Downloaded your repairs as a spreadsheet.';
        break;
      }
    }
  });

  /** How many repairs the search and the vehicle chosen find, for screen readers (audit G-6). */
  function announceFound(): void {
    const found = findRepairs(repairs, vehicles, {
      vehicle: filterVehicle(),
      query: searchInput.value,
    });
    announce(`${countLabel(found.length, 'repair', 'repairs')} found.`);
  }

  // The list is drawn again once typing pauses, not at every key (audit J-1).
  const typedSearch = waitForTyping(() => {
    shown = PAGE_SIZE;
    renderRepairs();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (searchInput.value.trim()) announceFound();
    }, ANNOUNCE_DELAY_MS);
  });
  searchInput.addEventListener('input', typedSearch);

  vehicleFilter.addEventListener('change', () => {
    // Drawn now, with what's typed too: read out once.
    typedSearch.cancel();
    window.clearTimeout(announceTimer);
    shown = PAGE_SIZE;
    renderRepairs();
    announceFound();
  });

  unitSelect.addEventListener('change', () => {
    const chosen = UNITS.find((unit) => unit === unitSelect.value);
    if (!chosen || chosen === unitOf(settings)) return;
    save(
      { settings: setUnit(settings, chosen) },
      `Mileage is shown in ${chosen === 'km' ? 'kilometres' : 'miles'} now.`,
    );
  });

  currencySelect.addEventListener('change', () => {
    const chosen = CURRENCIES.find((currency) => currency === currencySelect.value);
    if (!chosen || chosen === currencyOf(settings)) return;
    save({ settings: setCurrency(settings, chosen) }, `Costs are shown in ${chosen} now.`);
  });

  // ---------- Keeping up ----------

  /** After changes from another device or tab: keyboard focus stays where it was (audit G-3). */
  function reload(): void {
    vehicles = vehiclesStore.load();
    repairs = repairsStore.load();
    settings = settingsStore.load();
    // "Delete Bus 105?" says how many repairs go with the bus. When that
    // changed on another device or tab, it closes, and says why, so it
    // doesn't delete more than it said (audit 4 F2-1). When what it would
    // delete is gone, it closes, and the form under it says why.
    const target = deleteDialog.open ? deleting : null;
    if (target?.type === 'repair' && !findRepair(target.id)) deleteDialog.close();
    if (target?.type === 'vehicle') {
      const vehicle = findVehicle(target.id);
      const now = repairsOf(target.id).length;
      if (!vehicle) deleteDialog.close();
      else if (now !== target.count) {
        deleteDialog.close();
        vehicleDialog.close();
        showProblem(
          `${vehicle.name} has ${countLabel(now, 'repair', 'repairs')} now, after changes on another device. Nothing was deleted.`,
        );
      }
    }
    // What's being changed was deleted on another device or tab: the form
    // closes, and says why (audit 3 G-6). Changed there, the form's photos
    // follow (audit 3 F2-1).
    const editingRepair = repairEditor.now?.editing() ?? null;
    const current = findRepair(editingRepair);
    if (editingRepair !== null && !current) {
      repairDialog.close();
      showProblem('That repair was deleted on another device.');
    } else if (current) repairEditor.now?.follow(current);
    const editingVehicle = vehicleEditor.now?.editing() ?? null;
    if (editingVehicle !== null && !findVehicle(editingVehicle)) {
      vehicleDialog.close();
      showProblem('That vehicle was deleted on another device.');
    }
    yearDeleter.now?.refresh();
    keepFocus(render, newRepairButton);
  }

  // If Repairs is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    const keys = [vehiclesStore.key, repairsStore.key, settingsStore.key];
    if (event.key !== null && keys.includes(event.key)) reload();
  });

  /**
   * Deletes the photos no repair uses, and no repair form open here
   * (deleteUnusedPhotos). Not while the repairs saved can't be read (saved
   * by a newer Repairs, say): every photo would look unused then.
   */
  function deleteUnused(): void {
    if (repairsStore.status() !== 'ok') return;
    const inForm = repairEditor.now?.inUse() ?? [];
    void deleteUnusedPhotos(new Set([...photosOf(repairsStore.load().repairs), ...inForm]));
  }

  // Sync between devices through the shkriuss account (if turned on). The
  // newest change to each vehicle, repair and setting wins. Vehicles and
  // repairs are passed on as they come: repairs from an older version of
  // Repairs are upgraded (migrateRepairs) and checked after. Photos sync as
  // files of their own (docs/adr/0014-syncing-photos.md).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: vehiclesStore,
        items: (value) => value.vehicles,
        withItems: (value, list) => ({ ...value, vehicles: list }),
      }),
      syncedStore({
        store: repairsStore,
        items: (value) => value.repairs,
        withItems: (value, list) => ({ ...value, repairs: list }),
      }),
      syncedStore({
        store: settingsStore,
        items: (value) => value.settings,
        withItems: (_value, items) => withSettings(items),
      }),
    ],
    onChange() {
      const before = photosOf(repairs.repairs);
      reload();
      // Photos taken off repairs on another device (or with them) aren't needed
      // here now, unless the repair form being filled in has them.
      const inForm = repairEditor.now?.inUse() ?? [];
      const used = new Set([...photosOf(repairs.repairs), ...inForm]);
      const unused = before.filter((id) => !used.has(id));
      if (unused.length > 0) void deletePhotos(unused);
    },
    files: {
      wanted: () => new Set(photoFiles(photosOf(repairsStore.load().repairs))),
      read: readPhotoFile,
    },
  });
  downloadPhotosWith(sync);
  syncWasOn = sync.status().on;
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);
  sync.subscribe((status, event) => {
    if (event === 'synced' || event === 'kept-both') {
      refreshMissingThumbs();
      deleteUnused();
    }
    // Turned on or off: photos say where they are.
    if (status.on !== syncWasOn) {
      syncWasOn = status.on;
      keepFocus(render, newRepairButton);
    }
  });

  render();
  // Photos left behind (by an older backup restored, say) go.
  deleteUnused();
}
