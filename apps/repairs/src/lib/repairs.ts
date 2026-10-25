/**
 * Repairs' data and rules, kept separate from the page so they're easy to
 * test. Every function returns new data instead of changing the old.
 *
 * Three lists, saved and synced separately:
 * - vehicles: a name or number (a bus number, a plate, "My car"), and
 *   optionally the model, number plate and notes;
 * - repairs: the work done on one vehicle on one day: the mileage, the system
 *   (brakes, doors…), the damage found, the work done, the parts replaced
 *   (each with a price, if known), the hours worked and the labour cost;
 * - settings: kilometres or miles, and the currency, only for showing
 *   (nothing is converted). Each is saved only once changed (kilometres and
 *   US dollars until then).
 *
 * Version 2 of the repairs added the hours, the labour cost and part prices,
 * version 3 the photos (`migrateRepairs` fills them in as unknown, or none).
 * A repair keeps its photos' ids; the photos themselves are files on the
 * device (scripts/photos.ts, docs/adr/0013-photos-on-the-device.md), synced
 * as files of their own (docs/adr/0014-syncing-photos.md).
 *
 * A repair names its vehicle by id, so a vehicle can be renamed. Typing a new
 * vehicle in the repair form adds it.
 */
import { isIsoDate, type IsoDate } from '@shkriuss/dates';
import { csvFile } from '@shkriuss/storage/csv';
import { defineSettings, type SettingsState as SavedSettings } from '@shkriuss/storage/settings';
import {
  CURRENCIES,
  currencyDigits,
  decimalText,
  formatMoney,
  parseDecimal,
  parseWhole,
  roundDecimal,
  type Currency,
} from '@shkriuss/ui/numbers';
import { compareText, foldText } from '@shkriuss/ui/text';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

export interface Vehicle {
  id: string;
  /** A bus number, a plate or a name: how it's found. */
  name: string;
  model: string;
  plate: string;
  notes: string;
}

export interface VehiclesState {
  vehicles: Vehicle[];
}

/** The vehicles' data version. */
export const VEHICLES_VERSION = 1;

export interface Part {
  name: string;
  /** The part number, or "". */
  number: string;
  quantity: number;
  /** The price of one, or null if it wasn't noted. */
  price: number | null;
}

export interface Repair {
  id: string;
  /** The vehicle's id. */
  vehicle: string;
  date: IsoDate;
  /** What the odometer showed, or null if it wasn't noted. */
  mileage: number | null;
  /** Which part of the vehicle: "Brakes", "Doors"…, or "". */
  system: string;
  /** The damage found, or "". */
  problem: string;
  /** The work done, or "". */
  work: string;
  /** The parts replaced, in the order entered. */
  parts: Part[];
  /** The hours worked on it, or null if they weren't noted. */
  hours: number | null;
  /** Labour and other costs (not parts), or null if not noted. */
  labour: number | null;
  /** Its photos' ids, in the order added. The photos may be on another device. */
  photos: string[];
}

export interface RepairsState {
  repairs: Repair[];
}

/** The repairs' data version (see migrateRepairs). */
export const REPAIRS_VERSION = 3;

export const LIMITS = {
  vehicle: 40,
  model: 60,
  plate: 20,
  notes: 500,
  system: 40,
  text: 2000,
  partName: 60,
  partNumber: 40,
  parts: 30,
  quantity: 10_000,
  mileage: 9_999_999,
  hours: 1000,
  photos: 10,
  money: 1_000_000_000,
  vehicles: 500,
  /**
   * The most repairs kept, so they fit on the device and in the sync copy
   * (measured in repairs.test.ts: "room for every repair").
   */
  repairs: 3000,
};

/**
 * Suggestions for the system, for city buses like the Isuzu Novociti Life
 * first; anything else can be typed.
 */
export const SYSTEMS = [
  'Engine',
  'Cooling',
  'Fuel and AdBlue',
  'Exhaust',
  'Transmission',
  'Brakes',
  'Air system',
  'Suspension',
  'Steering',
  'Electrical',
  'Lights',
  'Doors',
  'A/C and heating',
  'Body and glass',
  'Seats and interior',
  'Tyres and wheels',
  'Wheelchair ramp',
  'Scheduled service',
  'Other',
];

/** Models suggested for a vehicle, besides the ones already used. */
export const MODELS = ['Isuzu Novociti Life'];

export const emptyVehicles = (): VehiclesState => ({ vehicles: [] });
export const emptyRepairs = (): RepairsState => ({ repairs: [] });

// ---------- Checking saved data ----------

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const isMileage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LIMITS.mileage;

const isQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= LIMITS.quantity;

const isHours = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= LIMITS.hours;

const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LIMITS.money;

const isMoneyOrNull = (value: unknown): value is number | null => value === null || isMoney(value);

function isVehicle(value: unknown): value is Vehicle {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['id'] === 'string' &&
    isText(item['name'], LIMITS.vehicle) &&
    item['name'] !== '' &&
    isText(item['model'], LIMITS.model) &&
    isText(item['plate'], LIMITS.plate) &&
    isText(item['notes'], LIMITS.notes)
  );
}

function isPart(value: unknown): value is Part {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isText(item['name'], LIMITS.partName) &&
    item['name'] !== '' &&
    isText(item['number'], LIMITS.partNumber) &&
    isQuantity(item['quantity']) &&
    isMoneyOrNull(item['price'])
  );
}

function isRepair(value: unknown): value is Repair {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['id'] === 'string' &&
    typeof item['vehicle'] === 'string' &&
    isIsoDate(item['date']) &&
    (item['mileage'] === null || isMileage(item['mileage'])) &&
    isText(item['system'], LIMITS.system) &&
    isText(item['problem'], LIMITS.text) &&
    isText(item['work'], LIMITS.text) &&
    Array.isArray(item['parts']) &&
    item['parts'].length <= LIMITS.parts &&
    item['parts'].every(isPart) &&
    (item['hours'] === null || isHours(item['hours'])) &&
    isMoneyOrNull(item['labour']) &&
    Array.isArray(item['photos']) &&
    item['photos'].length <= LIMITS.photos &&
    item['photos'].every((photo) => isText(photo, 100) && photo !== '')
  );
}

export function isVehiclesState(value: unknown): value is VehiclesState {
  if (typeof value !== 'object' || value === null) return false;
  const { vehicles } = value as Record<string, unknown>;
  return Array.isArray(vehicles) && vehicles.every(isVehicle);
}

export function isRepairsState(value: unknown): value is RepairsState {
  if (typeof value !== 'object' || value === null) return false;
  const { repairs } = value as Record<string, unknown>;
  return Array.isArray(repairs) && repairs.every(isRepair);
}

/**
 * Repairs saved by an older version: version 1 had no hours, labour cost or
 * part prices, so they're unknown (null); versions 1 and 2 had no photos.
 */
export function migrateRepairs(old: unknown, version: number): RepairsState | undefined {
  if (version < 1 || version > 2 || typeof old !== 'object' || old === null) return undefined;
  const { repairs } = old as Record<string, unknown>;
  if (!Array.isArray(repairs)) return undefined;
  return {
    repairs: repairs.map((repair: unknown) => {
      if (typeof repair !== 'object' || repair === null) return repair;
      const { parts } = repair as Record<string, unknown>;
      const costs =
        version === 1
          ? {
              hours: null,
              labour: null,
              parts: Array.isArray(parts)
                ? parts.map((part: unknown) =>
                    typeof part === 'object' && part !== null ? { ...part, price: null } : part,
                  )
                : parts,
            }
          : {};
      return { ...repair, ...costs, photos: [] };
    }) as Repair[],
  };
}

// ---------- Words ----------

/**
 * Text for comparing: lower case, without accents, apostrophes or extra
 * spaces (foldText, so a Hindi or Thai name keeps its vowel signs).
 */
const fold = (text: string): string => foldText(text.replace(/['’ʼ]/g, ''));

/** Tidies typed text: no spaces at the ends, and no runs of spaces in one-line fields. */
const oneLine = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** "Bus 2" before "Bus 10". */
const byName = compareText;

// ---------- Vehicles ----------

export interface VehicleForm {
  name: string;
  model: string;
  plate: string;
  notes: string;
}

export type VehicleProblems = Partial<Record<keyof VehicleForm, string>>;

export const findVehicleByName = (state: VehiclesState, name: string): Vehicle | undefined =>
  state.vehicles.find((vehicle) => fold(vehicle.name) === fold(name));

/** Reads the vehicle form (for the vehicle with this id), or says what's wrong. */
export function readVehicle(
  form: VehicleForm,
  id: string,
  state: VehiclesState,
): { vehicle: Vehicle; problems?: undefined } | { vehicle?: undefined; problems: VehicleProblems } {
  const problems: VehicleProblems = {};
  const name = oneLine(form.name);
  const own = state.vehicles.find((vehicle) => vehicle.id === id);
  const isNew = own === undefined;
  // Its own name, unchanged, is fine even if another vehicle has it too:
  // two devices that each added "Bus 105" before they first synced.
  const unchanged = own !== undefined && fold(own.name) === fold(name);
  if (name === '') problems.name = 'Enter a name or number, like a bus number.';
  else if (name.length > LIMITS.vehicle)
    problems.name = `Use ${LIMITS.vehicle} characters or fewer.`;
  else if (
    !unchanged &&
    state.vehicles.some((vehicle) => vehicle.id !== id && fold(vehicle.name) === fold(name))
  ) {
    problems.name = 'You already have a vehicle with that name.';
  } else if (isNew && state.vehicles.length >= LIMITS.vehicles) {
    problems.name = `You can keep up to ${LIMITS.vehicles} vehicles.`;
  }
  const model = oneLine(form.model);
  if (model.length > LIMITS.model) problems.model = `Use ${LIMITS.model} characters or fewer.`;
  const plate = oneLine(form.plate).toUpperCase();
  if (plate.length > LIMITS.plate) problems.plate = `Use ${LIMITS.plate} characters or fewer.`;
  const notes = form.notes.trim();
  if (notes.length > LIMITS.notes) problems.notes = `Use ${LIMITS.notes} characters or fewer.`;
  if (Object.keys(problems).length > 0) return { problems };
  return { vehicle: { id, name, model, plate, notes } };
}

export function saveVehicle(state: VehiclesState, vehicle: Vehicle): VehiclesState {
  const exists = state.vehicles.some((item) => item.id === vehicle.id);
  return {
    vehicles: exists
      ? state.vehicles.map((item) => (item.id === vehicle.id ? vehicle : item))
      : [...state.vehicles, vehicle],
  };
}

/** Removes a vehicle and its repairs. */
export function removeVehicle(
  vehicles: VehiclesState,
  repairs: RepairsState,
  id: string,
): { vehicles: VehiclesState; repairs: RepairsState } {
  return {
    vehicles: { vehicles: vehicles.vehicles.filter((vehicle) => vehicle.id !== id) },
    repairs: { repairs: repairs.repairs.filter((repair) => repair.vehicle !== id) },
  };
}

export const sortedVehicles = (state: VehiclesState): Vehicle[] =>
  [...state.vehicles].sort((a, b) => byName(a.name, b.name));

/** The models used so far and the suggested ones, for suggestions. */
export const modelNames = (state: VehiclesState): string[] =>
  [...new Set([...MODELS, ...state.vehicles.map((vehicle) => vehicle.model).filter(Boolean)])].sort(
    byName,
  );

// ---------- Repairs ----------

export interface PartForm {
  name: string;
  number: string;
  quantity: string;
  price: string;
}

export interface RepairForm {
  vehicle: string;
  date: string;
  mileage: string;
  system: string;
  problem: string;
  work: string;
  parts: PartForm[];
  hours: string;
  labour: string;
  /** The photos' ids (the photos are handled by the page). */
  photos: string[];
}

/**
 * What's wrong, by field name. A part's fields are "part-name-0",
 * "part-quantity-0", "part-price-0" and so on (0 is the first part).
 */
export type RepairProblems = Partial<Record<string, string>>;

/**
 * Reads the repair form into a repair (with the given id), or says what's
 * wrong, field by field. A vehicle that isn't saved yet is made, with an id
 * from `newId`, and returned as `newVehicle`. Numbers are read as typed in
 * `locale` (the browser's own when left out): "1,5" is 1.5, and "1,500" is
 * 1500 in English (parseDecimal); the mileage is a whole number ("120.000"
 * is 120000 in German).
 */
export function readRepair(
  form: RepairForm,
  id: string,
  repairs: RepairsState,
  vehicles: VehiclesState,
  newId: () => string,
  locale?: string,
):
  | { repair: Repair; newVehicle: Vehicle | null; problems?: undefined }
  | { repair?: undefined; newVehicle?: undefined; problems: RepairProblems } {
  const parseNumber = (text: string) => parseDecimal(text, locale);
  const problems: RepairProblems = {};

  const name = oneLine(form.vehicle);
  let vehicle = findVehicleByName(vehicles, name);
  let newVehicle: Vehicle | null = null;
  if (name === '') problems['vehicle'] = 'Enter the vehicle, like a bus number.';
  else if (!vehicle) {
    if (name.length > LIMITS.vehicle) {
      problems['vehicle'] = `Use ${LIMITS.vehicle} characters or fewer.`;
    } else if (vehicles.vehicles.length >= LIMITS.vehicles) {
      problems['vehicle'] = `You can keep up to ${LIMITS.vehicles} vehicles.`;
    } else {
      newVehicle = { id: newId(), name, model: '', plate: '', notes: '' };
      vehicle = newVehicle;
    }
  }

  if (!isIsoDate(form.date)) problems['date'] = 'Choose the day.';

  const mileage = parseWhole(form.mileage, locale);
  if (mileage !== null && !isMileage(mileage)) {
    problems['mileage'] = 'Enter the mileage as a whole number, or leave it empty.';
  }

  const system = oneLine(form.system);
  if (system.length > LIMITS.system)
    problems['system'] = `Use ${LIMITS.system} characters or fewer.`;
  const problem = form.problem.trim();
  if (problem.length > LIMITS.text) problems['problem'] = `Use ${LIMITS.text} characters or fewer.`;
  const work = form.work.trim();
  if (work.length > LIMITS.text) problems['work'] = `Use ${LIMITS.text} characters or fewer.`;

  const parts: Part[] = [];
  form.parts.forEach((row, index) => {
    const partName = oneLine(row.name);
    const number = oneLine(row.number).toUpperCase();
    const typedQuantity = parseNumber(row.quantity);
    const price = parseNumber(row.price);
    // An empty row is left out.
    if (
      partName === '' &&
      number === '' &&
      (typedQuantity === null || typedQuantity === 1) &&
      price === null
    ) {
      return;
    }
    if (partName === '') problems[`part-name-${index}`] = 'Enter the part’s name.';
    else if (partName.length > LIMITS.partName) {
      problems[`part-name-${index}`] = `Use ${LIMITS.partName} characters or fewer.`;
    }
    if (number.length > LIMITS.partNumber) {
      problems[`part-number-${index}`] = `Use ${LIMITS.partNumber} characters or fewer.`;
    }
    const quantity = typedQuantity ?? 1;
    if (!isQuantity(quantity)) problems[`part-quantity-${index}`] = 'Enter a number above 0.';
    if (!isMoneyOrNull(price))
      problems[`part-price-${index}`] = 'Enter a price, or leave it empty.';
    parts.push({ name: partName, number, quantity, price });
  });
  if (parts.length > LIMITS.parts) problems['parts'] = `Add up to ${LIMITS.parts} parts.`;

  const hours = parseNumber(form.hours);
  if (hours !== null && !isHours(hours)) {
    problems['hours'] = 'Enter the hours as a number above 0, or leave it empty.';
  }
  const labour = parseNumber(form.labour);
  if (!isMoneyOrNull(labour)) problems['labour'] = 'Enter an amount, or leave it empty.';

  if (form.photos.length > LIMITS.photos) {
    problems['photos'] = `Add up to ${LIMITS.photos} photos.`;
  }

  if (problem === '' && work === '' && parts.length === 0 && form.photos.length === 0) {
    problems['problem'] = 'Describe the damage found or the work done, or add a part or a photo.';
  }
  const isNew = !repairs.repairs.some((repair) => repair.id === id);
  if (isNew && repairs.repairs.length >= LIMITS.repairs) {
    problems['vehicle'] ??=
      `You can keep up to ${new Intl.NumberFormat(locale).format(LIMITS.repairs)} repairs. To make room, delete a year (under Units and spreadsheet).`;
  }

  if (Object.keys(problems).length > 0 || !vehicle) return { problems };
  return {
    repair: {
      id,
      vehicle: vehicle.id,
      date: form.date,
      mileage,
      system,
      problem,
      work,
      parts,
      hours,
      labour,
      photos: [...form.photos],
    },
    newVehicle,
  };
}

/**
 * A repair as the form shows it: numbers as they'd be typed in `locale` (the
 * browser's own when left out), so saving the form unchanged keeps them.
 */
export function toRepairForm(repair: Repair, vehicles: VehiclesState, locale?: string): RepairForm {
  const number = (value: number | null) => (value === null ? '' : decimalText(value, locale));
  return {
    vehicle: vehicleName(vehicles, repair.vehicle),
    date: repair.date,
    mileage: number(repair.mileage),
    system: repair.system,
    problem: repair.problem,
    work: repair.work,
    parts: repair.parts.map((part) => ({
      name: part.name,
      number: part.number,
      quantity: number(part.quantity),
      price: number(part.price),
    })),
    hours: number(repair.hours),
    labour: number(repair.labour),
    photos: [...repair.photos],
  };
}

export function saveRepair(state: RepairsState, repair: Repair): RepairsState {
  const exists = state.repairs.some((item) => item.id === repair.id);
  return {
    repairs: exists
      ? state.repairs.map((item) => (item.id === repair.id ? repair : item))
      : [...state.repairs, repair],
  };
}

export const removeRepair = (state: RepairsState, id: string): RepairsState => ({
  repairs: state.repairs.filter((repair) => repair.id !== id),
});

// ---------- Making room ----------

export interface YearCount {
  /** "2024". */
  year: string;
  count: number;
}

const yearOf = (date: IsoDate): string => date.slice(0, 4);

/** The years that have repairs, the earliest first, with how many each has (for "Delete a year"). */
export function repairYears(state: RepairsState): YearCount[] {
  const counts = new Map<string, number>();
  for (const repair of state.repairs) {
    counts.set(yearOf(repair.date), (counts.get(yearOf(repair.date)) ?? 0) + 1);
  }
  return [...counts]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/** The repairs of a year ("2024"), to delete with their photos. */
export const repairsIn = (state: RepairsState, year: string): Repair[] =>
  state.repairs.filter((repair) => yearOf(repair.date) === year);

/** Removes every repair of a year ("2024"). Vehicles stay. */
export const removeYear = (state: RepairsState, year: string): RepairsState => ({
  repairs: state.repairs.filter((repair) => yearOf(repair.date) !== year),
});

/**
 * What the page says once Repairs is nearly full (over 90% of the repairs it
 * keeps): how many more fit, and how to make room. Null until then.
 */
export function roomNote(count: number, locale?: string): string | null {
  if (count <= LIMITS.repairs * 0.9) return null;
  const left = LIMITS.repairs - count;
  const number = new Intl.NumberFormat(locale);
  const start =
    left > 0
      ? `Repairs is nearly full: there’s room for ${number.format(left)} more ${left === 1 ? 'repair' : 'repairs'} (it keeps up to ${number.format(LIMITS.repairs)}).`
      : `Repairs is full: it keeps up to ${number.format(LIMITS.repairs)} repairs.`;
  return `${start} To make room, download the spreadsheet, then use “Delete a year…” under Units and spreadsheet, below.`;
}

/** The vehicle's name, or a stand-in if it was deleted (on another device). */
export const vehicleName = (state: VehiclesState, id: string): string =>
  state.vehicles.find((vehicle) => vehicle.id === id)?.name ?? 'Unknown vehicle';

// ---------- Finding repairs ----------

/**
 * True if every word typed is in the repair or its vehicle. A word of only
 * letters and digits matches the start of a word ("7" finds Bus 7 and Bus 70,
 * not a part number with a 7 inside); one with other characters, like "a/c" or
 * "8-97366", matches anywhere.
 */
export function matchesSearch(
  repair: Repair,
  vehicle: Vehicle | undefined,
  query: string,
): boolean {
  const haystack = fold(
    [
      vehicle?.name,
      vehicle?.model,
      vehicle?.plate,
      repair.system,
      repair.problem,
      repair.work,
      ...repair.parts.flatMap((part) => [part.name, part.number]),
    ].join(' '),
  );
  // Words are letters (with their vowel signs, in Hindi or Thai) and digits.
  const words = haystack.split(/[^\p{L}\p{M}\p{N}]+/u);
  return fold(query)
    .split(' ')
    .filter(Boolean)
    .every((typed) =>
      /^[\p{L}\p{M}\p{N}]+$/u.test(typed)
        ? words.some((word) => word.startsWith(typed))
        : haystack.includes(typed),
    );
}

/**
 * The repairs to show: on one vehicle (or all, with null) and matching the
 * search, the latest day first. On the same day, the one added last comes first.
 */
export function findRepairs(
  repairs: RepairsState,
  vehicles: VehiclesState,
  filter: { vehicle: string | null; query: string },
): Repair[] {
  const byId = new Map(vehicles.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  return repairs.repairs
    .map((repair, index) => ({ repair, index }))
    .filter(
      ({ repair }) =>
        (filter.vehicle === null || repair.vehicle === filter.vehicle) &&
        matchesSearch(repair, byId.get(repair.vehicle), filter.query),
    )
    .sort((a, b) => b.repair.date.localeCompare(a.repair.date) || b.index - a.index)
    .map(({ repair }) => repair);
}

export interface Day {
  date: IsoDate;
  repairs: Repair[];
}

/** Repairs (already in order) grouped by day. */
export function byDay(repairs: readonly Repair[]): Day[] {
  const days: Day[] = [];
  for (const repair of repairs) {
    const last = days.at(-1);
    if (last?.date === repair.date) last.repairs.push(repair);
    else days.push({ date: repair.date, repairs: [repair] });
  }
  return days;
}

// ---------- Hours and costs ----------

/** Sums without floating-point crumbs (0.1 + 0.2 is 0.3). */
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/** An amount as it's shown in `currency`: to the cent, or to the yen (no decimals). */
const shown = (amount: number, currency: Currency): number =>
  roundDecimal(tidy(amount), currencyDigits(currency));

export interface Cost {
  /** Each priced part's quantity × price (partCost), added up. */
  parts: number;
  labour: number;
  total: number;
}

/**
 * What a part cost: its quantity × its price, rounded once to its
 * currency's decimals, as it's shown (so the parts add up to what's shown
 * for them). Null if no price was noted.
 */
export const partCost = (part: Part, currency: Currency = 'USD'): number | null =>
  part.price === null ? null : shown(part.quantity * part.price, currency);

/**
 * What a repair cost in `currency`: its priced parts and labour, each as
 * it's shown. Null if no price was noted.
 */
export function repairCost(repair: Repair, currency: Currency = 'USD'): Cost | null {
  const priced = repair.parts.filter((part) => part.price !== null);
  if (priced.length === 0 && repair.labour === null) return null;
  const parts = shown(
    priced.reduce((sum, part) => sum + (partCost(part, currency) ?? 0), 0),
    currency,
  );
  const labour = shown(repair.labour ?? 0, currency);
  return { parts, labour, total: shown(parts + labour, currency) };
}

export interface Totals {
  /** All the hours noted, or null if none were. */
  hours: number | null;
  /** All the costs noted, or null if none were. */
  cost: number | null;
}

/** The hours and costs (in `currency`) of some repairs, added up. */
export function totals(repairs: readonly Repair[], currency: Currency = 'USD'): Totals {
  let hours: number | null = null;
  let cost: number | null = null;
  for (const repair of repairs) {
    if (repair.hours !== null) hours = tidy((hours ?? 0) + repair.hours);
    const own = repairCost(repair, currency);
    if (own) cost = shown((cost ?? 0) + own.total, currency);
  }
  return { hours, cost };
}

/**
 * The highest mileage noted for a vehicle and the day it was noted, leaving
 * out one repair (the one being changed). Null if none was noted.
 */
export function lastMileage(
  state: RepairsState,
  vehicle: string,
  except: string | null = null,
): { mileage: number; date: IsoDate } | null {
  let best: { mileage: number; date: IsoDate } | null = null;
  for (const repair of state.repairs) {
    if (repair.vehicle !== vehicle || repair.id === except || repair.mileage === null) continue;
    if (!best || repair.mileage > best.mileage)
      best = { mileage: repair.mileage, date: repair.date };
  }
  return best;
}

export interface VehicleSummary {
  vehicle: Vehicle;
  repairs: number;
  /** The latest day it was repaired, or null. */
  lastDate: IsoDate | null;
  lastMileage: number | null;
  /** What its repairs cost, or null if no price was noted. */
  cost: number | null;
}

/** Each vehicle with how many repairs it had, when, and what they cost (in `currency`), in name order. */
export function vehicleSummaries(
  vehicles: VehiclesState,
  repairs: RepairsState,
  currency: Currency = 'USD',
): VehicleSummary[] {
  return sortedVehicles(vehicles).map((vehicle) => {
    const own = repairs.repairs.filter((repair) => repair.vehicle === vehicle.id);
    const lastDate = own.reduce<IsoDate | null>(
      (latest, repair) => (latest === null || repair.date > latest ? repair.date : latest),
      null,
    );
    return {
      vehicle,
      repairs: own.length,
      lastDate,
      lastMileage: lastMileage(repairs, vehicle.id)?.mileage ?? null,
      cost: totals(own, currency).cost,
    };
  });
}

export interface KnownPart {
  name: string;
  /** The last part number given, or "". */
  number: string;
  /** The last price given, or null. */
  price: number | null;
}

/**
 * The parts used so far, for suggestions: each name once (in name order),
 * with the part number and price it had the last time they were given.
 */
export function partNames(state: RepairsState): KnownPart[] {
  const known = new Map<string, KnownPart>();
  for (const repair of [...state.repairs].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const part of repair.parts) {
      const key = fold(part.name);
      const before = known.get(key);
      known.set(key, {
        name: part.name,
        number: part.number || before?.number || '',
        price: part.price ?? before?.price ?? null,
      });
    }
  }
  return [...known.values()].sort((a, b) => byName(a.name, b.name));
}

/** A part used before, by its name (any case), or undefined. */
export const knownPart = (state: RepairsState, name: string): KnownPart | undefined =>
  partNames(state).find((part) => fold(part.name) === fold(name));

/** The suggested systems, then any others used so far. */
export function systemNames(state: RepairsState): string[] {
  const known = new Set(SYSTEMS.map(fold));
  const used = [
    ...new Set(state.repairs.map((repair) => repair.system).filter((system) => system !== '')),
  ]
    .filter((system) => !known.has(fold(system)))
    .sort(byName);
  return [...SYSTEMS, ...used];
}

// ---------- Photos ----------

/** The longest side of a saved photo, and of its thumbnail, in pixels. */
export const PHOTO_SIZES = { full: 1600, thumb: 320 };

/** A width and height scaled down (never up) so the longest side is at most `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The photos of these repairs (to delete with them). */
export const photosOf = (repairs: readonly Repair[]): string[] =>
  repairs.flatMap((repair) => repair.photos);

/**
 * The biggest a saved photo may be, in bytes: the sync server takes files up
 * to 1.5 MB, sealed. Photos come out far smaller; a very detailed one is
 * saved again at a lower JPEG quality (PHOTO_QUALITIES, best first).
 */
export const MAX_PHOTO_BYTES = 1_400_000;
export const PHOTO_QUALITIES = [0.82, 0.65, 0.5];

/**
 * With sync on, a photo goes to the other devices as two files
 * (docs/adr/0014-syncing-photos.md): its thumbnail, fetched as soon as the
 * list shows it, and the full photo, fetched when it's opened.
 */
export type PhotoPart = 'thumb' | 'full';

const PHOTO_ID = /^[A-Za-z0-9-]{1,64}$/;

/** A photo part's file id: "<photo id>.thumb" or "<photo id>.full". */
export const photoFile = (photo: string, part: PhotoPart): string => `${photo}.${part}`;

/** Every file of these photos (an id that couldn't be a file is left out). */
export const photoFiles = (photos: readonly string[]): string[] =>
  photos
    .filter((photo) => PHOTO_ID.test(photo))
    .flatMap((photo) => [photoFile(photo, 'thumb'), photoFile(photo, 'full')]);

/** Which photo, and which part of it, a file is. */
export function fromPhotoFile(file: string): { photo: string; part: PhotoPart } | null {
  const match = /^([A-Za-z0-9-]{1,64})\.(thumb|full)$/.exec(file);
  return match ? { photo: match[1] as string, part: match[2] as PhotoPart } : null;
}

// ---------- For people ----------

export type Unit = 'km' | 'mi';
export const UNITS: readonly Unit[] = ['km', 'mi'];
export const UNIT_LABELS: Record<Unit, string> = { km: 'Kilometres (km)', mi: 'Miles (mi)' };

/** "123,456 km" */
export const formatMileage = (mileage: number, unit: Unit, locale?: string): string =>
  `${new Intl.NumberFormat(locale).format(mileage)} ${unit}`;

/** "2", "0.5" */
const formatQuantity = (quantity: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(quantity);

/** "1 hour", "2.5 hours" */
export const formatHours = (hours: number, locale?: string): string =>
  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hours)} ${hours === 1 ? 'hour' : 'hours'}`;

// The currencies and formatMoney are shared with Budget and Trades.
export { CURRENCIES, formatMoney, type Currency };

/** "Brake pads × 2 (8-97366-123-0)" */
export function partLabel(part: Part, locale?: string): string {
  const quantity = part.quantity === 1 ? '' : ` × ${formatQuantity(part.quantity, locale)}`;
  return `${part.name}${quantity}${part.number ? ` (${part.number})` : ''}`;
}

/** "Wednesday, October 21, 2026" */
export function dayLabel(date: IsoDate, locale = DATE_LOCALE): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, day),
  );
}

/** "Oct 21, 2026" */
export function dateLabel(date: IsoDate, locale = DATE_LOCALE): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, day),
  );
}

/** "1 repair", "3 repairs" */
export const countLabel = (count: number, one: string, many: string): string =>
  `${new Intl.NumberFormat().format(count)} ${count === 1 ? one : many}`;

// ---------- Spreadsheet ----------

/** Every repair as a CSV file (one row each, the latest first). */
export function toCsv(
  repairs: RepairsState,
  vehicles: VehiclesState,
  settings: SettingsState,
): string {
  const unit = unitOf(settings);
  const currency = currencyOf(settings);
  const byId = new Map(vehicles.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const header = [
    'Date',
    'Vehicle',
    'Model',
    'Plate',
    `Mileage (${unit})`,
    'System',
    'Damage found',
    'Work done',
    'Parts replaced',
    'Hours worked',
    `Parts cost (${currency})`,
    `Labour cost (${currency})`,
    `Total cost (${currency})`,
  ];
  const rows = findRepairs(repairs, vehicles, { vehicle: null, query: '' }).map((repair) => {
    const vehicle = byId.get(repair.vehicle);
    const cost = repairCost(repair, currency);
    return [
      repair.date,
      vehicle?.name ?? 'Unknown vehicle',
      vehicle?.model ?? '',
      vehicle?.plate ?? '',
      repair.mileage,
      repair.system,
      repair.problem,
      repair.work,
      repair.parts.map((part) => partLabel(part, 'en-US')).join('; '),
      repair.hours,
      cost?.parts ?? null,
      cost?.labour ?? null,
      cost?.total ?? null,
    ];
  });
  return csvFile([header, ...rows]);
}

// ---------- Settings ----------

export type Setting = { id: 'unit'; unit: Unit } | { id: 'currency'; currency: Currency };

export type SettingsState = SavedSettings<Setting>;

function isSetting(value: unknown): value is Setting {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  switch (item['id']) {
    case 'unit':
      return UNITS.includes(item['unit'] as Unit);
    case 'currency':
      return CURRENCIES.includes(item['currency'] as Currency);
    default:
      return false;
  }
}

/** Repairs' settings, saved only once changed (@shkriuss/storage/settings). */
const SETTINGS = defineSettings<Setting>(['unit', 'currency'], isSetting);

export const emptySettings = SETTINGS.empty;
export const isSettingsState = SETTINGS.isState;
/** Settings from sync: the ones that look right, once each, in a fixed order. */
export const withSettings = SETTINGS.fromItems;

export const unitOf = (state: SettingsState): Unit => SETTINGS.get(state, 'unit')?.unit ?? 'km';

export const currencyOf = (state: SettingsState): Currency =>
  SETTINGS.get(state, 'currency')?.currency ?? 'USD';

export const setUnit = (state: SettingsState, unit: Unit): SettingsState =>
  SETTINGS.set(state, { id: 'unit', unit });

export const setCurrency = (state: SettingsState, currency: Currency): SettingsState =>
  SETTINGS.set(state, { id: 'currency', currency });
