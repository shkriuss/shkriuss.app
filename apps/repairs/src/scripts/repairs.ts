/**
 * Repairs' page behaviour: connects pages/index.astro to the rules in
 * lib/repairs.ts, saves on the device, and syncs the vehicles, repairs and
 * settings when sync is on. Photos: photos.ts.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
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
  LIMITS,
  migrateRepairs,
  modelNames,
  partLabel,
  partNames,
  photosOf,
  readRepair,
  readVehicle,
  removeRepair,
  removeVehicle,
  repairCost,
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
} from '../lib/repairs.ts';
import {
  deletePhotos,
  getPhoto,
  makePhoto,
  NotAPhotoError,
  rememberThumb,
  savePhotos,
  thumbUrl,
  type PhotoFile,
} from './photos.ts';

const vehiclesStore = createStore<VehiclesState>({
  key: 'repairs-vehicles',
  version: 1,
  fallback: emptyVehicles,
  validate: isVehiclesState,
});

// Version 2 added hours worked, labour cost and part prices; version 3, photos.
const repairsStore = createStore<RepairsState>({
  key: 'repairs',
  version: 3,
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

const COULD_NOT_SAVE = 'Couldn’t save. Your browser may be blocking storage, or it may be full.';
/** Repairs shown at first, and added by "Show more". */
const PAGE_SIZE = 50;
const EMPTY_PART: PartForm = { name: '', number: '', quantity: '1', price: '' };
const PART_FIELDS = ['name', 'number', 'quantity', 'price'] as const;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Repairs: missing element ${selector}`);
  return element;
}

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
  const formPhotoTemplate = required<HTMLTemplateElement>(root, '[data-form-photo-template]');
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
  const formPhotoList = required<HTMLUListElement>(repairForm, '[data-form-photos]');
  const formPhotosElsewhere = required<HTMLElement>(repairForm, '[data-form-photos-elsewhere]');
  const photosBusy = required<HTMLElement>(repairForm, '[data-photos-busy]');
  const photoError = required<HTMLElement>(repairForm, '[data-error-for="photos"]');
  const photoInput = required<HTMLInputElement>(repairForm, '[data-photo-input]');
  const addPhotosButton = required<HTMLButtonElement>(repairForm, '[data-action="add-photos"]');
  const photoDialog = required<HTMLDialogElement>(root, '[data-photo-dialog]');
  const photoTitle = required<HTMLElement>(photoDialog, '[data-photo-title]');
  const photoImage = required<HTMLImageElement>(photoDialog, '[data-photo-image]');
  const vehicleDialog = required<HTMLDialogElement>(root, '[data-vehicle-dialog]');
  const vehicleForm = required<HTMLFormElement>(vehicleDialog, '[data-vehicle-form]');
  const vehicleTitle = required<HTMLElement>(vehicleDialog, '[data-vehicle-title]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');

  let vehicles = vehiclesStore.load();
  let repairs = repairsStore.load();
  let settings = settingsStore.load();
  let shown = PAGE_SIZE;
  /** What's in the forms: the repair or vehicle being changed (null: a new one). */
  let editingRepair: string | null = null;
  let editingVehicle: string | null = null;
  let deleting: { type: 'repair' | 'vehicle'; id: string } | null = null;
  /** The repair form's photos: every id (some may be on another device)… */
  let formPhotos: string[] = [];
  /** …the ones picked but not saved yet… */
  const pendingPhotos = new Map<string, PhotoFile>();
  /** …and saved ones removed in the form (deleted once it's saved). */
  let removedPhotos: string[] = [];
  /** Picked photos being made smaller; saving waits for them. */
  let addingPhotos: Promise<void> = Promise.resolve();
  /** Counts the times the repair form was opened, so late photos don't land in the next one. */
  let formSession = 0;
  let saving = false;
  /** The photo being looked at: its repair, the photos on this device, which one. */
  let viewing: { repair: Repair; ids: string[]; index: number; url: string | null } | null = null;

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
    announce(ok ? message : COULD_NOT_SAVE);
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
    required<HTMLElement>(item, '[data-meta]').textContent = [
      repair.mileage === null ? '' : mileage(repair.mileage),
      repair.system,
    ]
      .filter(Boolean)
      .join(' · ');
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
          line.textContent =
            part.price === null
              ? partLabel(part)
              : `${partLabel(part)} · ${money(part.quantity * part.price)}`;
          return line;
        }),
      );
    } else rows.parts.remove();
    if (repair.hours !== null) {
      required<HTMLElement>(rows.hours, 'dd').textContent = formatHours(repair.hours);
    } else rows.hours.remove();
    const cost = repairCost(repair);
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
    required<HTMLElement>(row, '[data-photos-elsewhere]').textContent =
      elsewhere === 0 ? '' : `${countLabel(elsewhere, 'photo', 'photos')} on another device`;
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
    const sums = totalsText(totals(found));
    resultCount.textContent =
      (filtered ? `${count}${on}${matching}` : `${count} in all`) + (sums ? ` · ${sums}.` : '.');

    daysList.replaceChildren(
      ...byDay(found.slice(0, shown)).map((day) => {
        const fragment = dayTemplate.content.cloneNode(true) as DocumentFragment;
        const block = required<HTMLElement>(fragment, 'div');
        required<HTMLElement>(block, '[data-day-heading]').textContent = dayLabel(day.date);
        required<HTMLElement>(block, '[data-day-total]').textContent = totalsText(
          totals(day.repairs),
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
    const summaries = vehicleSummaries(vehicles, repairs);
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
    (input instanceof HTMLElement ? input : addPartButton).focus();
    return true;
  }

  // ---------- Photos in the repair form ----------

  /** Shows the form's photos; says how many are on another device. */
  async function renderFormPhotos(): Promise<void> {
    const ids = [...formPhotos];
    const urls = await Promise.all(ids.map(thumbUrl));
    // Changed again meanwhile: that render shows the latest.
    if (ids.join() !== formPhotos.join()) return;
    const here = ids.flatMap((id, index) => {
      const url = urls[index];
      return url ? [{ id, url }] : [];
    });
    formPhotoList.replaceChildren(
      ...here.map(({ id, url }, index) => {
        const fragment = formPhotoTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        entry.dataset['photo'] = id;
        const image = required<HTMLImageElement>(entry, '[data-thumb]');
        image.src = url;
        image.alt = `Photo ${index + 1}`;
        required<HTMLElement>(entry, '[data-action="remove-photo"]').ariaLabel =
          `Remove photo ${index + 1}`;
        return entry;
      }),
    );
    const elsewhere = ids.length - here.length;
    formPhotosElsewhere.hidden = elsewhere === 0;
    formPhotosElsewhere.textContent =
      elsewhere === 1
        ? '1 photo is on another device. It stays with this repair.'
        : `${elsewhere} photos are on another device. They stay with this repair.`;
    addPhotosButton.hidden = ids.length >= LIMITS.photos;
  }

  function showPhotoProblem(problem: string): void {
    photoError.textContent = problem;
  }

  /** Makes the picked files into photos, one at a time, and adds them. */
  async function addPhotos(picked: readonly File[]): Promise<void> {
    const session = formSession;
    const room = LIMITS.photos - formPhotos.length;
    const problems: string[] = [];
    if (picked.length > room) {
      problems.push(
        `A repair can have up to ${LIMITS.photos} photos, so ${countLabel(picked.length - room, 'photo wasn’t', 'photos weren’t')} added.`,
      );
    }
    photosBusy.hidden = false;
    for (const file of picked.slice(0, Math.max(0, room))) {
      try {
        const photo = await makePhoto(file);
        // The form was closed meanwhile: this photo isn't wanted.
        if (session !== formSession) break;
        pendingPhotos.set(photo.id, photo);
        rememberThumb(photo);
        formPhotos = [...formPhotos, photo.id];
        await renderFormPhotos();
      } catch (error) {
        problems.push(
          error instanceof NotAPhotoError ? error.message : 'Couldn’t read a photo. Try again.',
        );
      }
    }
    photosBusy.hidden = true;
    if (session === formSession) showPhotoProblem(problems.join(' '));
  }

  photoInput.addEventListener('change', () => {
    const picked = [...(photoInput.files ?? [])];
    photoInput.value = '';
    if (picked.length === 0) return;
    showPhotoProblem('');
    addingPhotos = addingPhotos.then(() => addPhotos(picked));
  });

  function removePhoto(id: string): void {
    const index = formPhotos.indexOf(id);
    formPhotos = formPhotos.filter((photo) => photo !== id);
    if (pendingPhotos.delete(id)) void deletePhotos([id]);
    else removedPhotos = [...removedPhotos, id];
    void renderFormPhotos().then(() => {
      // Keep keyboard focus nearby: the next photo's button, or "Add photos".
      const buttons = formPhotoList.querySelectorAll<HTMLElement>('[data-action="remove-photo"]');
      (buttons[Math.min(index, buttons.length - 1)] ?? addPhotosButton).focus();
    });
  }

  /** Forgets photos picked in the form but not saved (it was closed without saving). */
  function dropPendingPhotos(): void {
    if (pendingPhotos.size > 0) void deletePhotos([...pendingPhotos.keys()]);
    pendingPhotos.clear();
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
    formSession += 1;
    dropPendingPhotos();
    formPhotos = [...values.photos];
    removedPhotos = [];
    formPhotoList.replaceChildren();
    void renderFormPhotos();
    showPhotoProblem('');
    photosBusy.hidden = true;
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
      price.value = String(known.price);
    }
  });

  repairForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    // Photos still being made smaller are waited for.
    void addingPhotos.then(submitRepair).finally(() => {
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
        photos: formPhotos,
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
    try {
      await savePhotos([...pendingPhotos.values()]);
    } catch {
      showPhotoProblem('Couldn’t save the photos. Your device may be out of space.');
      addPhotosButton.focus();
      return;
    }
    pendingPhotos.clear();
    void deletePhotos(removedPhotos);
    removedPhotos = [];
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

  // ---------- Looking at a photo ----------

  async function showPhoto(): Promise<void> {
    if (!viewing) return;
    const { repair, ids, index } = viewing;
    const photo = await getPhoto(ids[index] ?? '');
    if (!viewing || viewing.index !== index) return;
    if (viewing.url) URL.revokeObjectURL(viewing.url);
    viewing.url = photo ? URL.createObjectURL(photo.full) : null;
    photoImage.src = viewing.url ?? '';
    const what = `the repair on ${vehicleName(vehicles, repair.vehicle)} on ${dateLabel(repair.date)}`;
    photoTitle.textContent = ids.length === 1 ? 'Photo' : `Photo ${index + 1} of ${ids.length}`;
    photoImage.alt =
      ids.length === 1 ? `From ${what}` : `${index + 1} of ${ids.length}, from ${what}`;
  }

  async function openPhoto(repair: Repair, id: string): Promise<void> {
    const urls = await Promise.all(repair.photos.map(thumbUrl));
    const ids = repair.photos.filter((_, index) => urls[index]);
    viewing = { repair, ids, index: Math.max(0, ids.indexOf(id)), url: null };
    for (const action of ['previous-photo', 'next-photo']) {
      required<HTMLElement>(photoDialog, `[data-action="${action}"]`).hidden = ids.length < 2;
    }
    await showPhoto();
    photoDialog.showModal();
  }

  function stepPhoto(by: number): void {
    if (!viewing) return;
    viewing.index = (viewing.index + by + viewing.ids.length) % viewing.ids.length;
    void showPhoto();
  }

  /** "Save a copy": the photo as a file, named after the repair. */
  async function savePhotoCopy(): Promise<void> {
    if (!viewing) return;
    const { repair, ids, index } = viewing;
    const photo = await getPhoto(ids[index] ?? '');
    if (!photo) return;
    const name = `${vehicleName(vehicles, repair.vehicle)}-${repair.date}-photo-${index + 1}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    const url = URL.createObjectURL(photo.full);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.jpg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  photoDialog.addEventListener('close', () => {
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = null;
    photoImage.removeAttribute('src');
  });

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
    if (first) (vehicleForm.elements.namedItem(first) as HTMLElement).focus();
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
      newRepairButton.focus();
    } else {
      const vehicle = findVehicle(target.id);
      vehicleDialog.close();
      if (!vehicle) return;
      const own = repairs.repairs.filter((repair) => repair.vehicle === vehicle.id);
      const count = own.length;
      void deletePhotos(photosOf(own));
      save(
        removeVehicle(vehicles, repairs, vehicle.id),
        count === 0
          ? `Deleted ${vehicle.name}.`
          : `Deleted ${vehicle.name} and its ${countLabel(count, 'repair', 'repairs')}.`,
      );
      newVehicleButton.focus();
    }
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
      case 'more':
        shown += PAGE_SIZE;
        renderRepairs();
        break;
      case 'add-photos':
        photoInput.click();
        break;
      case 'remove-photo': {
        const photo = button?.closest<HTMLElement>('li[data-photo]')?.dataset['photo'];
        if (photo) removePhoto(photo);
        break;
      }
      case 'view-photo': {
        const repair = findRepair(id);
        const photo = button?.dataset['photo'];
        if (repair && photo) void openPhoto(repair, photo);
        break;
      }
      case 'previous-photo':
        stepPhoto(-1);
        break;
      case 'next-photo':
        stepPhoto(1);
        break;
      case 'save-photo':
        void savePhotoCopy();
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
      case 'csv':
        if (repairs.repairs.length === 0) {
          announce('There’s nothing to download yet.');
          break;
        }
        downloadFile(`repairs-${today()}.csv`, toCsv(repairs, vehicles, settings), 'text/csv');
        announce('Downloaded your repairs as a spreadsheet.');
        break;
    }
  });

  searchInput.addEventListener('input', () => {
    shown = PAGE_SIZE;
    renderRepairs();
  });

  vehicleFilter.addEventListener('change', () => {
    shown = PAGE_SIZE;
    renderRepairs();
  });

  repairDialog.addEventListener('close', () => {
    editingRepair = null;
    formSession += 1;
    // While saving, the photos are being kept: not dropped.
    if (!saving) dropPendingPhotos();
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

  function reload(): void {
    vehicles = vehiclesStore.load();
    repairs = repairsStore.load();
    settings = settingsStore.load();
    // What's being changed was deleted on another device or tab.
    if (editingRepair !== null && !findRepair(editingRepair)) repairDialog.close();
    if (editingVehicle !== null && !findVehicle(editingVehicle)) vehicleDialog.close();
    render();
  }

  // If Repairs is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    const keys = [vehiclesStore.key, repairsStore.key, settingsStore.key];
    if (event.key !== null && keys.includes(event.key)) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). The
  // newest change to each vehicle, repair and setting wins. Vehicles and
  // repairs are passed on as they come: repairs from an older version of
  // Repairs are upgraded (migrateRepairs) and checked after.
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
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  render();
}
