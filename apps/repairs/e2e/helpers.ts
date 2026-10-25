// Shared by Repairs' browser tests: the day it is, finding things on the
// page, filling in the forms, adding photos, and saving records straight
// into storage.
import type { Page } from '@playwright/test';
import { fileKeys, type jpeg } from '../../../tests/e2e/photos.ts';
import { seedStores } from '../../../tests/e2e/storage.ts';
import {
  REPAIRS_VERSION,
  VEHICLES_VERSION,
  type Repair,
  type Vehicle,
} from '../src/lib/repairs.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

export const repairDialog = (page: Page) => page.locator('[data-repair-dialog]');
export const vehicleDialog = (page: Page) => page.locator('[data-vehicle-dialog]');
export const yearDialog = (page: Page) => page.locator('[data-year-dialog]');
/** The repairs shown, in order. */
export const repairItems = (page: Page) => page.locator('[data-days] li.repair');
/** A vehicle in the Vehicles list, by its name. */
export const vehicleItem = (page: Page, name: string) =>
  page.locator('[data-vehicles] li').filter({
    has: page.locator('[data-name]', { hasText: new RegExp(`^${name}$`) }),
  });
/** A part in the open repair form (1 is the first). */
export const partRow = (page: Page, number: number) =>
  repairDialog(page).getByRole('group', { name: `Part ${number}`, exact: true });

export interface PartFields {
  name?: string;
  number?: string;
  quantity?: string;
  price?: string;
}

/** Fills in the open repair form (only the fields given) and saves. */
export async function fillRepair(
  page: Page,
  fields: {
    vehicle?: string;
    date?: string;
    mileage?: string;
    system?: string;
    problem?: string;
    work?: string;
    parts?: PartFields[];
    hours?: string;
    labour?: string;
  },
): Promise<void> {
  const dialog = repairDialog(page);
  if (fields.vehicle !== undefined) await dialog.getByLabel('Vehicle').fill(fields.vehicle);
  if (fields.date !== undefined) await dialog.getByLabel('Day').fill(fields.date);
  if (fields.mileage !== undefined) await dialog.getByLabel(/^Mileage/).fill(fields.mileage);
  if (fields.system !== undefined) await dialog.getByLabel('System (optional)').fill(fields.system);
  if (fields.problem !== undefined) await dialog.getByLabel('Damage found').fill(fields.problem);
  if (fields.work !== undefined) await dialog.getByLabel('Work done').fill(fields.work);
  for (const [index, part] of (fields.parts ?? []).entries()) {
    if ((await dialog.locator('[data-part-rows] > li').count()) <= index) {
      await dialog.getByRole('button', { name: 'Add a part' }).click();
    }
    const row = partRow(page, index + 1);
    if (part.name !== undefined) await row.getByLabel('Name').fill(part.name);
    if (part.number !== undefined) await row.getByLabel('Part number (optional)').fill(part.number);
    if (part.quantity !== undefined) await row.getByLabel('Quantity').fill(part.quantity);
    if (part.price !== undefined) await row.getByLabel('Price each (optional)').fill(part.price);
  }
  if (fields.hours !== undefined) {
    await dialog.getByLabel('Hours worked (optional)').fill(fields.hours);
  }
  if (fields.labour !== undefined) {
    await dialog.getByLabel('Labour and other costs (optional)').fill(fields.labour);
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
}

/** "New repair", filled in and saved. */
export async function addRepair(
  page: Page,
  fields: Parameters<typeof fillRepair>[1],
): Promise<void> {
  await page.getByRole('button', { name: 'New repair' }).click();
  await fillRepair(page, fields);
}

export const vehicle = (overrides: Partial<Vehicle>): Vehicle => ({
  id: crypto.randomUUID(),
  name: 'Bus 105',
  model: 'Isuzu Novociti Life',
  plate: '',
  notes: '',
  ...overrides,
});

export const repair = (overrides: Partial<Repair>): Repair => ({
  id: crypto.randomUUID(),
  vehicle: 'b105',
  date: '2026-10-21',
  mileage: 120_000,
  system: 'Brakes',
  problem: '',
  work: 'Replaced the front pads',
  parts: [],
  hours: null,
  labour: null,
  photos: [],
  ...overrides,
});

/** Saves vehicles and repairs straight into storage, then reloads. */
export async function seed(
  page: Page,
  { vehicles = [], repairs = [] }: { vehicles?: Vehicle[]; repairs?: Repair[] },
): Promise<void> {
  await seedStores(page, {
    'repairs-vehicles': { version: VEHICLES_VERSION, data: { vehicles } },
    repairs: { version: REPAIRS_VERSION, data: { repairs } },
  });
}

// ---------- Photos ----------

export { jpeg, naturalWidth, picture } from '../../../tests/e2e/photos.ts';

/** Picks files with the open repair form's "Add photos". */
export async function addPhotos(page: Page, files: ReturnType<typeof jpeg>[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await repairDialog(page).getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles(files);
}

/** How many photos are kept on this device. */
export const storedPhotos = async (page: Page): Promise<number> => (await fileKeys(page)).length;
