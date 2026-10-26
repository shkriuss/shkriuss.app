/**
 * Repairs: the vehicle form, to add a vehicle or change one. Split from
 * repairs.ts (audit 3 J-9).
 */
import { withEdits } from '@shkriuss/sync/edits';
import { required } from '@shkriuss/ui/dom';
import { focusProblem } from '@shkriuss/ui/problem';
import { watchTextLimits } from '@shkriuss/ui/text-limit';
import {
  readVehicle,
  saveVehicle,
  toVehicleForm,
  type Vehicle,
  type VehicleForm,
  type VehiclesState,
} from '../lib/repairs.ts';
import { markField } from './repair-form.ts';

const VEHICLE_FIELDS = ['name', 'model', 'plate', 'notes'] as const;

/** What the vehicle form needs from the page. */
export interface VehicleFormPage {
  /** The vehicles as they are now. */
  vehicles(): VehiclesState;
  /** Saves, shows the change, and tells other devices. */
  save(next: { vehicles: VehiclesState }, message: string): void;
  /** After saving: focus the vehicle in the list, or "Add vehicle" if it isn't shown. */
  focusVehicle(id: string): void;
}

export interface VehicleFormControls {
  /** Opens the form on a vehicle, or on a new one. */
  open(vehicle: Vehicle | undefined): void;
  /** The vehicle the form is open on (null: a new one, or the form is closed). */
  editing(): string | null;
}

export function mountVehicleForm(root: ParentNode, page: VehicleFormPage): VehicleFormControls {
  const vehicleDialog = required<HTMLDialogElement>(root, '[data-vehicle-dialog]');
  const vehicleForm = required<HTMLFormElement>(vehicleDialog, '[data-vehicle-form]');
  const vehicleTitle = required<HTMLElement>(vehicleDialog, '[data-vehicle-title]');

  // A paste longer than a box takes is cut by the browser: say so (audit 4 F2-7).
  const limits = watchTextLimits(vehicleForm);

  /** The vehicle being changed (null: a new one). */
  let editingVehicle: string | null = null;
  /** The form as it opened, to tell what the person changed (see withEdits). */
  let openedVehicle: VehicleForm | null = null;

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
    openedVehicle = vehicle ? toVehicleForm(vehicle) : null;
    limits.clear();
    vehicleTitle.textContent = vehicle ? 'Change vehicle' : 'Add vehicle';
    for (const name of VEHICLE_FIELDS) {
      (vehicleForm.elements.namedItem(name) as HTMLInputElement).value =
        openedVehicle?.[name] ?? '';
    }
    required<HTMLElement>(vehicleForm, '[data-action="delete-vehicle"]').hidden = !vehicle;
    showVehicleProblems({});
    vehicleDialog.showModal();
  }

  vehicleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name: string) =>
      (vehicleForm.elements.namedItem(name) as HTMLInputElement).value;
    const edited = {
      name: value('name'),
      model: value('model'),
      plate: value('plate'),
      notes: value('notes'),
    };
    const vehicles = page.vehicles();
    // Changed meanwhile on another device or tab: only what was changed here
    // goes on it (audit 3 F2-1).
    const current = vehicles.vehicles.find((vehicle) => vehicle.id === editingVehicle);
    const read = readVehicle(
      current && openedVehicle ? withEdits(openedVehicle, edited, toVehicleForm(current)) : edited,
      editingVehicle ?? crypto.randomUUID(),
      vehicles,
    );
    if (!read.vehicle) {
      showVehicleProblems(read.problems);
      return;
    }
    const { vehicle } = read;
    vehicleDialog.close();
    page.save({ vehicles: saveVehicle(vehicles, vehicle) }, `Saved ${vehicle.name}.`);
    page.focusVehicle(vehicle.id);
  });

  vehicleDialog.addEventListener('close', () => {
    editingVehicle = null;
  });

  return { open: openVehicle, editing: () => editingVehicle };
}
