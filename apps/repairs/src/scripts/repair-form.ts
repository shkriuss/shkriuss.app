/**
 * Repairs: the repair form, with its parts and its photos (form-photos.ts):
 * opening it on a repair or a new one, showing what's wrong, and saving it.
 * Split from repairs.ts (audit 3 J-9), as the photos were (audit J-7).
 */
import { today } from '@shkriuss/dates';
import { required } from '@shkriuss/ui/dom';
import { decimalText } from '@shkriuss/ui/numbers';
import { focusProblem } from '@shkriuss/ui/problem';
import { watchTextLimits } from '@shkriuss/ui/text-limit';
import {
  dateLabel,
  findVehicleByName,
  formatMileage,
  knownPart,
  lastMileage,
  photoFiles,
  readEditedRepair,
  saveRepair,
  saveVehicle,
  toRepairForm,
  unitOf,
  vehicleName,
  type PartForm,
  type Repair,
  type RepairForm,
  type RepairsState,
  type SettingsState,
  type Vehicle,
  type VehiclesState,
} from '../lib/repairs.ts';
import { mountFormPhotos } from './form-photos.ts';
import { deletePhotos } from './photos.ts';

const EMPTY_PART: PartForm = { name: '', number: '', quantity: '1', price: '' };
const PART_FIELDS = ['name', 'number', 'quantity', 'price'] as const;

/** Shows or clears a field's problem (in the vehicle form too). */
export function markField(
  input: HTMLElement,
  error: HTMLElement | null,
  problem: string | undefined,
): void {
  if (error) error.textContent = problem ?? '';
  if (problem) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** What the repair form needs from the page. */
export interface RepairFormPage {
  /** The vehicles, repairs and settings as they are now. */
  data(): { vehicles: VehiclesState; repairs: RepairsState; settings: SettingsState };
  /** The vehicle the list is showing only, if one: a new repair is on it. */
  shownVehicle(): Vehicle | undefined;
  /** Saves, shows the change, and tells other devices. False if it couldn't be saved. */
  save(next: { vehicles?: VehiclesState; repairs?: RepairsState }, message: string): boolean;
  /** The repair just saved is never hidden behind "Show more" (shownCount). */
  keepShown(id: string): void;
  /** After saving: focus the repair in the list, or "New repair" if it isn't shown. */
  focusRepair(id: string): void;
  /** Whether sync is on. */
  syncOn(): boolean;
  /** Tells sync about photo files added and removed. */
  filesAdded(files: readonly string[]): void;
  filesRemoved(files: readonly string[]): void;
}

export interface RepairFormControls {
  /** Opens the form on a repair, or on a new one. */
  open(repair: Repair | undefined): void;
  /** The repair the form is open on (null: a new one, or the form is closed). */
  editing(): string | null;
  /** The repair changed on another device or tab while the form is open: its photos follow. */
  follow(repair: Repair): void;
  /** The photos in the form, which mustn't be deleted (none while it's closed). */
  inUse(): string[];
  /** "Add a part". */
  addPart(): void;
  /** A part's "Remove": `row` is the part's row. */
  removePart(row: Element | null | undefined): void;
  /** "Add photos". */
  pickPhotos(): void;
  /** A photo's "Remove". */
  removePhoto(id: string): void;
}

export function mountRepairForm(root: ParentNode, page: RepairFormPage): RepairFormControls {
  const repairDialog = required<HTMLDialogElement>(root, '[data-repair-dialog]');
  const repairForm = required<HTMLFormElement>(repairDialog, '[data-repair-form]');
  const repairTitle = required<HTMLElement>(repairDialog, '[data-repair-title]');
  const mileageHint = required<HTMLElement>(repairForm, '[data-mileage-hint]');
  const partRows = required<HTMLOListElement>(repairForm, '[data-part-rows]');
  const addPartButton = required<HTMLButtonElement>(repairForm, '[data-action="add-part"]');
  const partTemplate = required<HTMLTemplateElement>(root, '[data-part-template]');

  /** The repair being changed (null: a new one). */
  let editingRepair: string | null = null;
  /** The form as it opened, to tell what the person changed (see withEdits). */
  let openedRepair: RepairForm | null = null;
  let saving = false;
  const formPhotos = mountFormPhotos(root, repairForm, { syncOn: () => page.syncOn() });
  // A paste longer than a box takes is cut by the browser: say so (audit 4
  // F2-7). Not the parts' short boxes, drawn later inside their labels,
  // where the message would become part of the box's name.
  const limits = watchTextLimits(repairForm);

  const mileage = (value: number) => formatMileage(value, unitOf(page.data().settings));

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
    const { vehicles, repairs } = page.data();
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
      ...['parts', 'photos', 'hours', 'labour'],
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
    // Too many photos, with those added on another device: "Remove photo" (audit 3 F2-1).
    const photo = repairForm.querySelector<HTMLElement>('[data-action="remove-photo"]');
    focusProblem(
      input instanceof HTMLElement ? input : first === 'photos' ? photo : addPartButton,
      problems[first],
    );
    return true;
  }

  function openRepair(repair: Repair | undefined): void {
    editingRepair = repair?.id ?? null;
    openedRepair = repair ? toRepairForm(repair, page.data().vehicles) : null;
    limits.clear();
    repairTitle.textContent = repair ? 'Change repair' : 'New repair';
    const only = page.shownVehicle();
    const values = openedRepair ?? {
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
    const known = knownPart(page.data().repairs, input.value);
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
    const before = page.data();
    // A sync or another tab may have changed the repair while the form was
    // open: only what was changed here goes on it (audit 3 F2-1).
    const read = readEditedRepair(
      openedRepair,
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
      before.repairs,
      before.vehicles,
      () => crypto.randomUUID(),
    );
    if (!read.repair) {
      showRepairProblems(read.problems);
      return;
    }
    const { repair, newVehicle } = read;
    const photos = await formPhotos.save();
    if (!photos) return;
    page.filesAdded(photoFiles(photos.added));
    repairDialog.close();
    // As they are now: a sync may have come while the photos were saved.
    const { vehicles, repairs } = page.data();
    const name = newVehicle?.name ?? vehicleName(vehicles, repair.vehicle);
    page.keepShown(repair.id);
    const saved = page.save(
      {
        repairs: saveRepair(repairs, repair),
        ...(newVehicle ? { vehicles: saveVehicle(vehicles, newVehicle) } : {}),
      },
      newVehicle
        ? `Saved the repair on ${name}, and added ${name} to your vehicles.`
        : `Saved the repair on ${name}.`,
    );
    // Photos taken off it go once it's saved without them. If it couldn't
    // be, the repair as saved still has them: they stay (audit 4 F2-8).
    if (saved) {
      void deletePhotos(photos.removed);
      page.filesRemoved(photoFiles(photos.removed));
    }
    page.focusRepair(repair.id);
  }

  repairDialog.addEventListener('close', () => {
    editingRepair = null;
    formPhotos.close(saving);
  });

  return {
    open: openRepair,
    editing: () => editingRepair,
    follow: (repair) => formPhotos.follow(repair.photos),
    inUse: () => (repairDialog.open ? formPhotos.inUse() : []),
    addPart() {
      const parts = partValues();
      renderParts([...parts, EMPTY_PART]);
      partInput(parts.length, 'name')?.focus();
    },
    removePart(row) {
      const index = [...partRows.children].indexOf(row as Element);
      const parts = partValues().filter((_, at) => at !== index);
      renderParts(parts);
      (partInput(Math.min(index, parts.length - 1), 'name') ?? addPartButton).focus();
    },
    pickPhotos: () => formPhotos.pick(),
    removePhoto: (id) => formPhotos.remove(id),
  };
}
