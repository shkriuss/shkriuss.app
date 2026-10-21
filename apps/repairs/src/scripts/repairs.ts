/**
 * Repairs' page behaviour: connects pages/index.astro to the rules in
 * lib/repairs.ts, saves on the device, and syncs the vehicles, repairs and
 * settings when sync is on.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  byDay,
  countLabel,
  dateLabel,
  dayLabel,
  emptyRepairs,
  emptySettings,
  emptyVehicles,
  findRepairs,
  findVehicleByName,
  formatMileage,
  isRepairsState,
  isSettingsState,
  isVehiclesState,
  lastMileage,
  modelNames,
  partLabel,
  partNames,
  readRepair,
  readVehicle,
  removeRepair,
  removeVehicle,
  saveRepair,
  saveVehicle,
  setUnit,
  systemNames,
  toCsv,
  toRepairForm,
  unitOf,
  UNITS,
  vehicleName,
  vehicleSummaries,
  withRepairs,
  withSettings,
  withVehicles,
  type PartForm,
  type Repair,
  type RepairsState,
  type SettingsState,
  type Vehicle,
  type VehiclesState,
  type VehicleSummary,
} from '../lib/repairs.ts';

const vehiclesStore = createStore<VehiclesState>({
  key: 'repairs-vehicles',
  version: 1,
  fallback: emptyVehicles,
  validate: isVehiclesState,
});

const repairsStore = createStore<RepairsState>({
  key: 'repairs',
  version: 1,
  fallback: emptyRepairs,
  validate: isRepairsState,
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
const EMPTY_PART: PartForm = { name: '', number: '', quantity: '1' };

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
  const dayTemplate = required<HTMLTemplateElement>(root, '[data-day-template]');
  const repairTemplate = required<HTMLTemplateElement>(root, '[data-repair-template]');
  const vehicleTemplate = required<HTMLTemplateElement>(root, '[data-vehicle-template]');
  const partTemplate = required<HTMLTemplateElement>(root, '[data-part-template]');
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
  const partRows = required<HTMLOListElement>(repairForm, '[data-part-rows]');
  const addPartButton = required<HTMLButtonElement>(repairForm, '[data-action="add-part"]');
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

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const mileage = (value: number) => formatMileage(value, unitOf(settings));
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
    };
    if (repair.problem) required<HTMLElement>(rows.problem, 'dd').textContent = repair.problem;
    else rows.problem.remove();
    if (repair.work) required<HTMLElement>(rows.work, 'dd').textContent = repair.work;
    else rows.work.remove();
    if (repair.parts.length > 0) {
      required<HTMLUListElement>(rows.parts, '[data-parts]').replaceChildren(
        ...repair.parts.map((part) => {
          const line = document.createElement('li');
          line.textContent = partLabel(part);
          return line;
        }),
      );
    } else rows.parts.remove();
    return item;
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
    resultCount.textContent = filtered ? `${count}${on}${matching}.` : `${count} in all.`;

    daysList.replaceChildren(
      ...byDay(found.slice(0, shown)).map((day) => {
        const fragment = dayTemplate.content.cloneNode(true) as DocumentFragment;
        const block = required<HTMLElement>(fragment, 'div');
        required<HTMLElement>(block, '[data-day-heading]').textContent = dayLabel(day.date);
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
    mileageLabel.textContent = `Mileage (${unitOf(settings)})`;
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
        for (const key of ['name', 'number', 'quantity'] as const) {
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

  const REPAIR_FIELDS = ['vehicle', 'date', 'mileage', 'system', 'problem', 'work', 'parts'];

  /** Shows the form's problems; focuses the first. Returns true if there are any. */
  function showRepairProblems(problems: Partial<Record<string, string>>): boolean {
    const names = [
      ...REPAIR_FIELDS,
      ...partValues().flatMap((_, index) =>
        ['name', 'number', 'quantity'].map((key) => `part-${key}-${index}`),
      ),
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
        };
    for (const name of ['vehicle', 'date', 'mileage', 'system', 'problem', 'work'] as const) {
      field<HTMLInputElement>(name).value = values[name];
    }
    renderParts(values.parts.length > 0 ? values.parts : [EMPTY_PART]);
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

  // A part used before: fill in its part number.
  repairForm.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const match = /^part-name-(\d+)$/.exec(input.name);
    if (!match) return;
    const number = partInput(Number(match[1]), 'number');
    if (!number || number.value.trim() !== '') return;
    const key = input.value.trim().toLowerCase();
    const known = partNames(repairs).find((part) => part.name.toLowerCase() === key);
    if (known?.number) number.value = known.number;
  });

  repairForm.addEventListener('submit', (event) => {
    event.preventDefault();
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
      if (!findRepair(target.id)) return;
      save({ repairs: removeRepair(repairs, target.id) }, 'Deleted the repair.');
      newRepairButton.focus();
    } else {
      const vehicle = findVehicle(target.id);
      vehicleDialog.close();
      if (!vehicle) return;
      const count = repairs.repairs.filter((repair) => repair.vehicle === vehicle.id).length;
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
        downloadFile(
          `repairs-${today()}.csv`,
          toCsv(repairs, vehicles, unitOf(settings)),
          'text/csv',
        );
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
  // newest change to each vehicle, repair and setting wins.
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: vehiclesStore,
        items: (value) => value.vehicles,
        withItems: (_value, items) => withVehicles(items),
      }),
      syncedStore({
        store: repairsStore,
        items: (value) => value.repairs,
        withItems: (_value, items) => withRepairs(items),
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
