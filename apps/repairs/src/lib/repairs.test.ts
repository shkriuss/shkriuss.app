import { describe, expect, it } from 'vitest';
import {
  byDay,
  dateLabel,
  dayLabel,
  emptyRepairs,
  emptySettings,
  emptyVehicles,
  findRepairs,
  formatMileage,
  isRepairsState,
  isVehiclesState,
  LIMITS,
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
  SYSTEMS,
  systemNames,
  toCsv,
  toRepairForm,
  unitOf,
  vehicleName,
  vehicleSummaries,
  withRepairs,
  withSettings,
  withVehicles,
  type Repair,
  type RepairForm,
  type RepairsState,
  type Vehicle,
  type VehiclesState,
} from './repairs.ts';

const vehicle = (overrides: Partial<Vehicle>): Vehicle => ({
  id: 'v',
  name: 'Bus 105',
  model: 'Isuzu Novociti Life',
  plate: '',
  notes: '',
  ...overrides,
});
const vehicles: VehiclesState = {
  vehicles: [
    vehicle({ id: 'b105', name: 'Bus 105' }),
    vehicle({ id: 'b12', name: 'Bus 12', plate: 'TB-012-BB' }),
    vehicle({ id: 'car', name: 'My car', model: 'Toyota Corolla' }),
  ],
};
const repair = (overrides: Partial<Repair>): Repair => ({
  id: 'r',
  vehicle: 'b105',
  date: '2026-10-21',
  mileage: 120_000,
  system: 'Brakes',
  problem: '',
  work: 'Replaced the front pads',
  parts: [],
  ...overrides,
});
const repairs = (...list: Repair[]): RepairsState => ({ repairs: list });
const form = (overrides: Partial<RepairForm>): RepairForm => ({
  vehicle: 'Bus 105',
  date: '2026-10-21',
  mileage: '',
  system: '',
  problem: '',
  work: 'Checked the doors',
  parts: [],
  ...overrides,
});
let ids = 0;
const newId = () => `new-${(ids += 1)}`;

describe('vehicles', () => {
  it('checks the name, model, plate and notes', () => {
    expect(readVehicle({ name: ' ', model: '', plate: '', notes: '' }, 'x', vehicles)).toEqual({
      problems: { name: 'Enter a name or number, like a bus number.' },
    });
    expect(
      readVehicle({ name: 'bus  105', model: '', plate: '', notes: '' }, 'x', vehicles).problems,
    ).toEqual({ name: 'You already have a vehicle with that name.' });
    // Its own name is fine.
    expect(
      readVehicle({ name: 'Bus 105', model: '', plate: '', notes: '' }, 'b105', vehicles).vehicle
        ?.name,
    ).toBe('Bus 105');
    expect(
      readVehicle(
        { name: ' Bus  7 ', model: ' Isuzu  Novociti Life ', plate: 'tb-007-aa', notes: ' Old ' },
        'b7',
        vehicles,
      ),
    ).toEqual({
      vehicle: {
        id: 'b7',
        name: 'Bus 7',
        model: 'Isuzu Novociti Life',
        plate: 'TB-007-AA',
        notes: 'Old',
      },
    });
    expect(
      readVehicle({ name: 'x'.repeat(41), model: '', plate: '', notes: '' }, 'x', vehicles)
        .problems,
    ).toEqual({ name: 'Use 40 characters or fewer.' });
  });

  it('are saved, renamed, and removed with their repairs', () => {
    const renamed = saveVehicle(vehicles, vehicle({ id: 'b12', name: 'Bus 012' }));
    expect(vehicleName(renamed, 'b12')).toBe('Bus 012');
    expect(saveVehicle(emptyVehicles(), vehicle({ id: 'n' })).vehicles).toHaveLength(1);
    const removed = removeVehicle(
      vehicles,
      repairs(repair({ id: 'a' }), repair({ id: 'b', vehicle: 'b12' })),
      'b105',
    );
    expect(removed.vehicles.vehicles.map((item) => item.id)).toEqual(['b12', 'car']);
    expect(removed.repairs.repairs.map((item) => item.id)).toEqual(['b']);
    expect(vehicleName(removed.vehicles, 'b105')).toBe('Unknown vehicle');
  });

  it('are summed up in number order', () => {
    const summaries = vehicleSummaries(
      vehicles,
      repairs(
        repair({ id: 'a', date: '2026-10-01', mileage: 118_000 }),
        repair({ id: 'b', date: '2026-10-21', mileage: null }),
        repair({ id: 'c', date: '2026-09-15', mileage: 119_500 }),
      ),
    );
    expect(summaries.map((summary) => summary.vehicle.name)).toEqual([
      'Bus 12',
      'Bus 105',
      'My car',
    ]);
    expect(summaries[1]).toMatchObject({
      repairs: 3,
      lastDate: '2026-10-21',
      lastMileage: 119_500,
    });
    expect(summaries[0]).toMatchObject({ repairs: 0, lastDate: null, lastMileage: null });
  });

  it('suggests the Novociti Life and the models used', () => {
    expect(modelNames(vehicles)).toEqual(['Isuzu Novociti Life', 'Toyota Corolla']);
  });
});

describe('repairs', () => {
  it('finds the vehicle by its name, or adds it', () => {
    const known = readRepair(form({ vehicle: ' bus 105 ' }), 'r1', emptyRepairs(), vehicles, newId);
    expect(known.repair?.vehicle).toBe('b105');
    expect(known.newVehicle).toBeNull();

    const added = readRepair(form({ vehicle: 'Bus  33' }), 'r2', emptyRepairs(), vehicles, newId);
    expect(added.newVehicle).toEqual({
      id: added.repair?.vehicle,
      name: 'Bus 33',
      model: '',
      plate: '',
      notes: '',
    });
  });

  it('reads the mileage, system, text and parts', () => {
    const read = readRepair(
      form({
        mileage: '123 456',
        system: ' Brakes ',
        problem: ' Grinding noise at the front ',
        work: 'Replaced pads and discs.\nBled the brakes.',
        parts: [
          { name: 'Brake pads', number: '8-97366-123-0', quantity: '2' },
          { name: '', number: '', quantity: '1' },
          { name: 'Brake fluid', number: '', quantity: '0,5' },
          { name: ' Disc ', number: 'abc 1', quantity: '' },
        ],
      }),
      'r',
      emptyRepairs(),
      vehicles,
      newId,
    );
    expect(read.repair).toEqual({
      id: 'r',
      vehicle: 'b105',
      date: '2026-10-21',
      mileage: 123_456,
      system: 'Brakes',
      problem: 'Grinding noise at the front',
      work: 'Replaced pads and discs.\nBled the brakes.',
      parts: [
        { name: 'Brake pads', number: '8-97366-123-0', quantity: 2 },
        { name: 'Brake fluid', number: '', quantity: 0.5 },
        { name: 'Disc', number: 'ABC 1', quantity: 1 },
      ],
    });
  });

  it('says what’s wrong', () => {
    expect(
      readRepair(
        form({ vehicle: '', date: '', mileage: '12.5', work: '' }),
        'r',
        emptyRepairs(),
        vehicles,
        newId,
      ).problems,
    ).toEqual({
      vehicle: 'Enter the vehicle, like a bus number.',
      date: 'Choose the day.',
      mileage: 'Enter the mileage as a whole number, or leave it empty.',
      problem: 'Describe the damage found, the work done, or add a part.',
    });
    expect(
      readRepair(
        form({
          parts: [
            { name: '', number: 'X-1', quantity: '1' },
            { name: 'Bulb', number: '', quantity: '0' },
          ],
        }),
        'r',
        emptyRepairs(),
        vehicles,
        newId,
      ).problems,
    ).toEqual({
      'part-name-0': 'Enter the part’s name.',
      'part-quantity-1': 'Enter a number above 0.',
    });
    // A part alone is enough.
    expect(
      readRepair(
        form({ work: '', parts: [{ name: 'Wiper blade', number: '', quantity: '2' }] }),
        'r',
        emptyRepairs(),
        vehicles,
        newId,
      ).repair?.parts,
    ).toHaveLength(1);
  });

  it('shows a saved repair in the form again', () => {
    const saved = repair({
      mileage: null,
      parts: [{ name: 'Brake pads', number: 'BP-1', quantity: 2 }],
    });
    const again = toRepairForm(saved, vehicles);
    expect(again).toMatchObject({ vehicle: 'Bus 105', mileage: '', system: 'Brakes' });
    expect(again.parts).toEqual([{ name: 'Brake pads', number: 'BP-1', quantity: '2' }]);
    expect(readRepair(again, 'r', repairs(saved), vehicles, newId).repair).toEqual(saved);
  });

  it('are saved, changed and removed', () => {
    let state = saveRepair(emptyRepairs(), repair({ id: 'a' }));
    state = saveRepair(state, repair({ id: 'b' }));
    state = saveRepair(state, repair({ id: 'a', work: 'Changed' }));
    expect(state.repairs.map((item) => [item.id, item.work])).toEqual([
      ['a', 'Changed'],
      ['b', 'Replaced the front pads'],
    ]);
    expect(removeRepair(state, 'a').repairs.map((item) => item.id)).toEqual(['b']);
  });

  it('checks saved and synced data', () => {
    expect(isRepairsState(repairs(repair({})))).toBe(true);
    expect(isRepairsState(repairs(repair({ mileage: -1 })))).toBe(false);
    expect(isVehiclesState(vehicles)).toBe(true);
    expect(isVehiclesState({ vehicles: [{ id: 'x', name: '' }] })).toBe(false);
    expect(withRepairs([repair({}), { id: 'bad' }]).repairs).toHaveLength(1);
    expect(withVehicles([vehicle({}), null]).vehicles).toHaveLength(1);
    const many = Array.from({ length: LIMITS.parts + 1 }, () => ({
      name: 'Bolt',
      number: '',
      quantity: 1,
    }));
    expect(isRepairsState(repairs(repair({ parts: many })))).toBe(false);
  });
});

describe('finding repairs', () => {
  const state = repairs(
    repair({ id: 'a', date: '2026-10-20', problem: 'Front door won’t close', system: 'Doors' }),
    repair({
      id: 'b',
      date: '2026-10-21',
      vehicle: 'b12',
      parts: [{ name: 'Brake pads', number: '8-97366-123-0', quantity: 2 }],
    }),
    repair({ id: 'c', date: '2026-10-21', work: 'Fixed the A/C', system: 'A/C and heating' }),
    repair({ id: 'd', date: '2026-10-19', vehicle: 'car', work: 'Oil change', system: '' }),
  );
  const ids = (query: string, only: string | null = null) =>
    findRepairs(state, vehicles, { vehicle: only, query }).map((item) => item.id);

  it('lists the latest first; on the same day, the one added last first', () => {
    expect(ids('')).toEqual(['c', 'b', 'a', 'd']);
    expect(byDay(findRepairs(state, vehicles, { vehicle: null, query: '' }))).toEqual([
      { date: '2026-10-21', repairs: [state.repairs[2], state.repairs[1]] },
      { date: '2026-10-20', repairs: [state.repairs[0]] },
      { date: '2026-10-19', repairs: [state.repairs[3]] },
    ]);
  });

  it('searches every word in the vehicle, system, text and parts', () => {
    expect(ids('door')).toEqual(['a']);
    expect(ids('bus 12')).toEqual(['b']);
    expect(ids('TB-012')).toEqual(['b']);
    expect(ids('97366')).toEqual(['b']);
    expect(ids('pads brake')).toEqual(['b']);
    expect(ids('corolla oil')).toEqual(['d']);
    expect(ids('wont')).toEqual(['a']);
    expect(ids('bus 7')).toEqual([]);
    expect(ids('8-97366')).toEqual(['b']);
    expect(ids('replac')).toEqual(['b', 'a']);
    expect(ids('eplaced')).toEqual([]);
    expect(ids('', 'b105')).toEqual(['c', 'a']);
    expect(ids('a/c', 'b105')).toEqual(['c']);
  });

  it('knows the last mileage noted', () => {
    const noted = repairs(
      repair({ id: 'a', mileage: 120_500, date: '2026-10-01' }),
      repair({ id: 'b', mileage: 121_000, date: '2026-10-20' }),
      repair({ id: 'c', mileage: null }),
      repair({ id: 'd', vehicle: 'b12', mileage: 300_000 }),
    );
    expect(lastMileage(noted, 'b105')).toEqual({ mileage: 121_000, date: '2026-10-20' });
    expect(lastMileage(noted, 'b105', 'b')).toEqual({ mileage: 120_500, date: '2026-10-01' });
    expect(lastMileage(noted, 'car')).toBeNull();
  });

  it('suggests parts with their last number, and systems', () => {
    const used = repairs(
      repair({
        date: '2026-10-01',
        parts: [{ name: 'Oil filter', number: 'OF-1', quantity: 1 }],
        system: 'Gearbox',
      }),
      repair({
        date: '2026-10-10',
        parts: [
          { name: 'oil filter', number: '', quantity: 1 },
          { name: 'Air filter', number: 'AF-2', quantity: 1 },
        ],
        system: 'brakes',
      }),
    );
    expect(partNames(used)).toEqual([
      { name: 'Air filter', number: 'AF-2' },
      { name: 'oil filter', number: 'OF-1' },
    ]);
    expect(systemNames(used)).toEqual([...SYSTEMS, 'Gearbox']);
  });
});

describe('for people', () => {
  it('formats mileage, parts and days', () => {
    expect(formatMileage(123_456, 'km', 'en-US')).toBe('123,456 km');
    expect(formatMileage(80_000, 'mi', 'en-US')).toBe('80,000 mi');
    expect(partLabel({ name: 'Brake pads', number: 'BP-1', quantity: 2 }, 'en-US')).toBe(
      'Brake pads × 2 (BP-1)',
    );
    expect(partLabel({ name: 'Oil', number: '', quantity: 0.5 }, 'en-US')).toBe('Oil × 0.5');
    expect(partLabel({ name: 'Bulb', number: '', quantity: 1 })).toBe('Bulb');
    expect(dayLabel('2026-10-21', 'en-US')).toBe('Wednesday, October 21, 2026');
    expect(dateLabel('2026-10-21', 'en-US')).toBe('Oct 21, 2026');
  });

  it('downloads every repair as a spreadsheet, safe to open', () => {
    const csv = toCsv(
      repairs(
        repair({ id: 'a', date: '2026-10-20', problem: '=cmd', work: 'Fixed, "properly"' }),
        repair({
          id: 'b',
          vehicle: 'b12',
          mileage: null,
          system: '',
          work: 'Pads',
          parts: [
            { name: 'Brake pads', number: 'BP-1', quantity: 2 },
            { name: 'Clip', number: '', quantity: 1 },
          ],
        }),
      ),
      vehicles,
      'km',
    );
    expect(csv.split('\r\n')).toEqual([
      'Date,Vehicle,Model,Plate,Mileage (km),System,Damage found,Work done,Parts replaced',
      '2026-10-21,Bus 12,Isuzu Novociti Life,TB-012-BB,,,,Pads,Brake pads × 2 (BP-1); Clip',
      `2026-10-20,Bus 105,Isuzu Novociti Life,,120000,Brakes,'=cmd,"Fixed, ""properly""",`,
      '',
    ]);
  });

  it('uses kilometres until miles are chosen', () => {
    expect(unitOf(emptySettings())).toBe('km');
    expect(unitOf(setUnit(emptySettings(), 'mi'))).toBe('mi');
    expect(withSettings([{ id: 'unit', unit: 'leagues' }]).settings).toEqual([]);
  });
});
