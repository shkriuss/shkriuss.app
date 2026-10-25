/**
 * Repairs' page behaviour: connects pages/index.astro to the rules in
 * lib/repairs.ts, saves on the device, and syncs the vehicles, repairs,
 * settings and photos when sync is on. "Delete a year…" deletes a year's
 * repairs and their photos, to make room. Photos: photos.ts; in the repair
 * form, form-photos.ts; looking at them, photo-viewer.ts.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { waitForTyping } from '@shkriuss/ui/long-lists';
import { decimalText } from '@shkriuss/ui/numbers';
import { focusProblem, reportSave } from '@shkriuss/ui/problem';
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
  findVehicleByName,
  formatHours,
  formatMileage,
  formatMoney,
  isRepairsState,
  isSettingsState,
  isVehiclesState,
  knownPart,
  lastMileage,
  migrateRepairs,
  modelNames,
  partCost,
  partLabel,
  partNames,
  photoFiles,
  photosOf,
  readRepair,
  readVehicle,
  removeRepair,
  removeVehicle,
  removeYear,
  repairCost,
  repairsIn,
  repairYears,
  roomNote,
  saveRepair,
  saveVehicle,
  setCurrency,
  setUnit,
  systemNames,
  toCsv,
  toRepairForm,
  totals,
  unitOf,
  UNITS,
  vehicleName,
  vehicleSummaries,
  withSettings,
  type PartForm,
  type Repair,
  type RepairsState,
  type SettingsState,
  type Totals,
  type Vehicle,
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
import { mountFormPhotos } from './form-photos.ts';
import { mountPhotoViewer } from './photo-viewer.ts';

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

/** Repairs shown at first, and added by "Show more". */
const PAGE_SIZE = 50;
/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;
const EMPTY_PART: PartForm = { name: '', number: '', quantity: '1', price: '' };
const PART_FIELDS = ['name', 'number', 'quantity', 'price'] as const;

/** Shows or clears a field's problem. */
function markField(input: HTMLElement, error: HTMLElement | null, problem: string | undefined) {
  if (error) error.textContent = problem ?? '';
  if (problem) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
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
  const partTemplate = required<HTMLTemplateElement>(root, '[data-part-template]');
  const thumbTemplate = required<HTMLTemplateElement>(root, '[data-thumb-template]');
  const suggestions = {
    vehicles: required<HTMLDataListElement>(root, '[data-vehicle-names]'),
    systems: required<HTMLDataListElement>(root, '[data-system-names]'),
    parts: required<HTMLDataListElement>(root, '[data-part-names]'),
    models: required<HTMLDataListElement>(root, '[data-model-names]'),
  };

  const repairDialog = required<HTMLDialogElement>(root, '[data-repair-dialog]');
  const repairForm = required<HTMLFormElement>(repairDialog, '[data-repair-form]');
  const repairTitle = required<HTMLElement>(repairDialog, '[data-repair-title]');
  const mileageLabel = required<HTMLElement>(repairForm, '[data-mileage-label]');
  const mileageHint = required<HTMLElement>(repairForm, '[data-mileage-hint]');
  const labourHint = required<HTMLElement>(repairForm, '[data-labour-hint]');
  const partRows = required<HTMLOListElement>(repairForm, '[data-part-rows]');
  const addPartButton = required<HTMLButtonElement>(repairForm, '[data-action="add-part"]');
  const csvStatus = required<HTMLElement>(root, '[data-csv-status]');
  const vehicleDialog = required<HTMLDialogElement>(root, '[data-vehicle-dialog]');
  const vehicleForm = required<HTMLFormElement>(vehicleDialog, '[data-vehicle-form]');
  const vehicleTitle = required<HTMLElement>(vehicleDialog, '[data-vehicle-title]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');
  const roomText = required<HTMLElement>(root, '[data-room-note]');
  const deleteYearButton = required<HTMLButtonElement>(root, '[data-action="delete-year"]');
  const yearDialog = required<HTMLDialogElement>(root, '[data-year-dialog]');
  const yearForm = required<HTMLFormElement>(yearDialog, '[data-year-form]');
  const yearSelect = required<HTMLSelectElement>(yearForm, '[data-year-select]');
  const yearText = required<HTMLElement>(yearForm, '[data-year-text]');
  const yearConfirm = required<HTMLElement>(yearForm, '[data-year-confirm]');

  let vehicles = vehiclesStore.load();
  let repairs = repairsStore.load();
  let settings = settingsStore.load();
  let shown = PAGE_SIZE;
  /** What's in the forms: the repair or vehicle being changed (null: a new one). */
  let editingRepair: string | null = null;
  let editingVehicle: string | null = null;
  let deleting: { type: 'repair' | 'vehicle'; id: string } | null = null;
  let saving = false;
  let syncWasOn = false;
  let announceTimer: number | undefined;
  const formPhotos = mountFormPhotos(root, repairForm, { syncOn: () => sync.status().on });
  const photoViewer = mountPhotoViewer(root, () => vehicles);

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
    list.replaceChildren(
      ...shown.map(({ id, url }, index) => {
        const fragment = thumbTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        required<HTMLElement>(entry, '[data-action="view-photo"]').dataset['photo'] = id;
        const image = required<HTMLImageElement>(entry, '[data-thumb]');
        image.src = url;
        image.alt = `Photo ${index + 1}`;
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
    fillList(
      suggestions.vehicles,
      vehicleSummaries(vehicles, repairs).map((summary) => summary.vehicle.name),
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

  // ---------- The repair form ----------

  const field = <T extends HTMLElement>(name: string) =>
    repairForm.elements.namedItem(name) as T & { value: string };

  /** The parts as they're typed in the form. */
  function partValues(): PartForm[] {
    return [...partRows.children].map((row) => ({
      name: required<HTMLInputElement>(row, '[data-part="name"]').value,
      number: required<HTMLInputElement>(row, '[data-part="number"]').value,
      quantity: required<HTMLInputElement>(row, '[data-part="quantity"]').value,
      price: required<HTMLInputElement>(row, '[data-part="price"]').value,
    }));
  }

  /** Shows these parts in the form, numbered from 1. */
  function renderParts(parts: readonly PartForm[]): void {
    partRows.replaceChildren(
      ...parts.map((part, index) => {
        const fragment = partTemplate.content.cloneNode(true) as DocumentFragment;
        const row = required<HTMLLIElement>(fragment, 'li');
        required<HTMLElement>(row, '[data-legend]').textContent = `Part ${index + 1}`;
        required<HTMLElement>(row, '[data-hidden-part]').textContent = ` part ${index + 1}`;
        for (const key of PART_FIELDS) {
          const id = `part-${key}-${index}`;
          const input = required<HTMLInputElement>(row, `[data-part="${key}"]`);
          const error = required<HTMLElement>(row, `[data-error="${key}"]`);
          input.id = id;
          input.name = id;
          input.value = part[key];
          error.id = `${id}-error`;
          error.dataset['errorFor'] = id;
          input.setAttribute('aria-describedby', error.id);
        }
        return row;
      }),
    );
  }

  const partInput = (index: number, key: keyof PartForm) =>
    partRows.querySelector<HTMLInputElement>(`#part-${key}-${index}`);

  /** "Last noted for Bus 105: 121,000 km on Oct 20, 2026." under the mileage. */
  function renderMileageHint(): void {
    const vehicle = findVehicleByName(vehicles, field<HTMLInputElement>('vehicle').value);
    const last = vehicle ? lastMileage(repairs, vehicle.id, editingRepair) : null;
    mileageHint.textContent =
      vehicle && last
        ? `Last noted for ${vehicle.name}: ${mileage(last.mileage)} on ${dateLabel(last.date)}.`
        : '';
  }

  /** Shows the form's problems; focuses the first. Returns true if there are any. */
  function showRepairProblems(problems: Partial<Record<string, string>>): boolean {
    // In the form's order.
    const names = [
      ...['vehicle', 'date', 'mileage', 'system', 'problem', 'work'],
      ...partValues().flatMap((_, index) => PART_FIELDS.map((key) => `part-${key}-${index}`)),
      ...['parts', 'hours', 'labour'],
    ];
    for (const name of names) {
      const error = repairForm.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
      const input = repairForm.elements.namedItem(name);
      if (input instanceof HTMLElement) markField(input, error, problems[name]);
      else if (error) error.textContent = problems[name] ?? '';
    }
    const first = names.find((name) => problems[name]);
    if (!first) return false;
    const input = repairForm.elements.namedItem(first);
    focusProblem(input instanceof HTMLElement ? input : addPartButton, problems[first]);
    return true;
  }

  function openRepair(repair: Repair | undefined): void {
    editingRepair = repair?.id ?? null;
    repairTitle.textContent = repair ? 'Change repair' : 'New repair';
    const only = findVehicle(filterVehicle());
    const values = repair
      ? toRepairForm(repair, vehicles)
      : {
          vehicle: only?.name ?? '',
          date: today(),
          mileage: '',
          system: '',
          problem: '',
          work: '',
          parts: [EMPTY_PART],
          hours: '',
          labour: '',
          photos: [],
        };
    for (const name of [
      'vehicle',
      'date',
      'mileage',
      'system',
      'problem',
      'work',
      'hours',
      'labour',
    ] as const) {
      field<HTMLInputElement>(name).value = values[name];
    }
    renderParts(values.parts.length > 0 ? values.parts : [EMPTY_PART]);
    formPhotos.reset(values.photos);
    required<HTMLElement>(repairForm, '[data-action="delete-repair"]').hidden = !repair;
    showRepairProblems({});
    renderMileageHint();
    repairDialog.showModal();
    // Straight to what's needed: the vehicle, or the mileage once it's known.
    field<HTMLInputElement>(values.vehicle ? 'mileage' : 'vehicle').focus();
  }

  repairForm.addEventListener('input', (event) => {
    if ((event.target as HTMLInputElement).name === 'vehicle') renderMileageHint();
  });

  // A part used before: fill in its part number and price, if they're empty.
  repairForm.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const match = /^part-name-(\d+)$/.exec(input.name);
    if (!match) return;
    const known = knownPart(repairs, input.value);
    if (!known) return;
    const number = partInput(Number(match[1]), 'number');
    if (number && number.value.trim() === '') number.value = known.number;
    const price = partInput(Number(match[1]), 'price');
    if (price && price.value.trim() === '' && known.price !== null) {
      price.value = decimalText(known.price);
    }
  });

  repairForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    // Photos still being made smaller are waited for.
    void formPhotos
      .ready()
      .then(submitRepair)
      .finally(() => {
        saving = false;
      });
  });

  async function submitRepair(): Promise<void> {
    const id = editingRepair ?? crypto.randomUUID();
    const read = readRepair(
      {
        vehicle: field<HTMLInputElement>('vehicle').value,
        date: field<HTMLInputElement>('date').value,
        mileage: field<HTMLInputElement>('mileage').value,
        system: field<HTMLInputElement>('system').value,
        problem: field<HTMLTextAreaElement>('problem').value,
        work: field<HTMLTextAreaElement>('work').value,
        parts: partValues(),
        hours: field<HTMLInputElement>('hours').value,
        labour: field<HTMLInputElement>('labour').value,
        photos: formPhotos.ids(),
      },
      id,
      repairs,
      vehicles,
      () => crypto.randomUUID(),
    );
    if (!read.repair) {
      showRepairProblems(read.problems);
      return;
    }
    const { repair, newVehicle } = read;
    const photos = await formPhotos.save();
    if (!photos) return;
    sync.filesAdded(photoFiles(photos.added));
    sync.filesRemoved(photoFiles(photos.removed));
    repairDialog.close();
    const name = newVehicle?.name ?? vehicleName(vehicles, repair.vehicle);
    save(
      {
        repairs: saveRepair(repairs, repair),
        ...(newVehicle ? { vehicles: saveVehicle(vehicles, newVehicle) } : {}),
      },
      newVehicle
        ? `Saved the repair on ${name}, and added ${name} to your vehicles.`
        : `Saved the repair on ${name}.`,
    );
    focusItem(daysList, repair.id, 'edit-repair', newRepairButton);
  }

  // ---------- The vehicle form ----------

  const VEHICLE_FIELDS = ['name', 'model', 'plate', 'notes'] as const;

  function showVehicleProblems(problems: Partial<Record<string, string>>): void {
    for (const name of VEHICLE_FIELDS) {
      markField(
        vehicleForm.elements.namedItem(name) as HTMLElement,
        vehicleForm.querySelector<HTMLElement>(`[data-error-for="${name}"]`),
        problems[name],
      );
    }
    const first = VEHICLE_FIELDS.find((name) => problems[name]);
    if (first) focusProblem(vehicleForm.elements.namedItem(first) as HTMLElement, problems[first]);
  }

  function openVehicle(vehicle: Vehicle | undefined): void {
    editingVehicle = vehicle?.id ?? null;
    vehicleTitle.textContent = vehicle ? 'Change vehicle' : 'Add vehicle';
    for (const name of VEHICLE_FIELDS) {
      (vehicleForm.elements.namedItem(name) as HTMLInputElement).value = vehicle?.[name] ?? '';
    }
    required<HTMLElement>(vehicleForm, '[data-action="delete-vehicle"]').hidden = !vehicle;
    showVehicleProblems({});
    vehicleDialog.showModal();
  }

  vehicleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name: string) =>
      (vehicleForm.elements.namedItem(name) as HTMLInputElement).value;
    const read = readVehicle(
      { name: value('name'), model: value('model'), plate: value('plate'), notes: value('notes') },
      editingVehicle ?? crypto.randomUUID(),
      vehicles,
    );
    if (!read.vehicle) {
      showVehicleProblems(read.problems);
      return;
    }
    const { vehicle } = read;
    vehicleDialog.close();
    save({ vehicles: saveVehicle(vehicles, vehicle) }, `Saved ${vehicle.name}.`);
    focusItem(vehicleList, vehicle.id, 'edit-vehicle', newVehicleButton);
  });

  // ---------- Deleting ----------

  function askToDelete(type: 'repair' | 'vehicle'): void {
    if (type === 'repair') {
      const repair = findRepair(editingRepair);
      if (!repair) return;
      deleting = { type, id: repair.id };
      deleteTitle.textContent = 'Delete this repair?';
      deleteText.textContent = `The repair on ${vehicleName(vehicles, repair.vehicle)} on ${dateLabel(repair.date)} will be removed.`;
    } else {
      const vehicle = findVehicle(editingVehicle);
      if (!vehicle) return;
      deleting = { type, id: vehicle.id };
      const count = repairs.repairs.filter((repair) => repair.vehicle === vehicle.id).length;
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
      const own = repairs.repairs.filter((repair) => repair.vehicle === vehicle.id);
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

  // ---------- Deleting a year ----------

  const repairsCount = (count: number) => countLabel(count, 'repair', 'repairs');

  /** How many repairs the year chosen has (0 if it has none now). */
  const yearCount = (year: string) =>
    repairYears(repairs).find((entry) => entry.year === year)?.count ?? 0;

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    const count = repairsCount(yearCount(year));
    yearText.textContent = `The ${count} from ${year} will be deleted, with their photos. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years with repairs to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = repairYears(repairs);
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${repairsCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest repairs are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  function openYears(): void {
    if (repairs.repairs.length === 0) {
      csvStatus.textContent = 'There are no repairs to delete.';
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
    const gone = repairsIn(repairs, year);
    yearDialog.close();
    deleteYearButton.focus();
    if (gone.length === 0) return;
    // Like deleting repairs one by one: other devices delete them too, and their photos go.
    save(
      { repairs: removeYear(repairs, year) },
      `Deleted ${repairsCount(gone.length)} from ${year}.`,
    );
    void deletePhotos(photosOf(gone));
    sync.filesRemoved(photoFiles(photosOf(gone)));
  });

  // ---------- Everything else ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    const id = button?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    switch (action) {
      case 'new-repair':
        openRepair(undefined);
        break;
      case 'edit-repair':
        openRepair(findRepair(id));
        break;
      case 'add-part': {
        const parts = partValues();
        renderParts([...parts, EMPTY_PART]);
        partInput(parts.length, 'name')?.focus();
        break;
      }
      case 'remove-part': {
        const row = button?.closest('li');
        const index = [...partRows.children].indexOf(row as Element);
        const parts = partValues().filter((_, at) => at !== index);
        renderParts(parts);
        (partInput(Math.min(index, parts.length - 1), 'name') ?? addPartButton).focus();
        break;
      }
      case 'new-vehicle':
        openVehicle(undefined);
        break;
      case 'edit-vehicle':
        openVehicle(findVehicle(id));
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
        formPhotos.pick();
        break;
      case 'remove-photo': {
        const photo = button?.closest<HTMLElement>('li[data-photo]')?.dataset['photo'];
        if (photo) formPhotos.remove(photo);
        break;
      }
      case 'view-photo': {
        const repair = findRepair(id);
        const photo = button?.dataset['photo'];
        if (repair && photo) void photoViewer.open(repair, photo);
        break;
      }
      case 'previous-photo':
        photoViewer.step(-1);
        break;
      case 'next-photo':
        photoViewer.step(1);
        break;
      case 'save-photo':
        void photoViewer.saveCopy();
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
        openYears();
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

  repairDialog.addEventListener('close', () => {
    editingRepair = null;
    formPhotos.close(saving);
  });
  vehicleDialog.addEventListener('close', () => {
    editingVehicle = null;
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
    // What's being changed was deleted on another device or tab.
    if (editingRepair !== null && !findRepair(editingRepair)) repairDialog.close();
    if (editingVehicle !== null && !findVehicle(editingVehicle)) vehicleDialog.close();
    if (yearDialog.open) {
      if (repairs.repairs.length === 0) yearDialog.close();
      else fillYears();
    }
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
    const inForm = repairDialog.open ? formPhotos.inUse() : [];
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
      const inForm = repairDialog.open ? formPhotos.inUse() : [];
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
