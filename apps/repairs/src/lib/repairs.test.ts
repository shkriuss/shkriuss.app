import { describe, expect, it } from 'vitest';
import {
  byDay,
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
  isVehiclesState,
  knownPart,
  LIMITS,
  lastMileage,
  migrateRepairs,
  modelNames,
  partLabel,
  partNames,
  readRepair,
  readVehicle,
  removeRepair,
  removeVehicle,
  repairCost,
  saveRepair,
  saveVehicle,
  setCurrency,
  setUnit,
  SYSTEMS,
  systemNames,
  toCsv,
  toRepairForm,
  totals,
  unitOf,
  vehicleName,
  vehicleSummaries,
  withSettings,
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
  hours: null,
  labour: null,
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
  hours: '',
  labour: '',
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
          { name: 'Brake pads', number: '8-97366-123-0', quantity: '2', price: '' },
          { name: '', number: '', quantity: '1', price: '' },
          { name: 'Brake fluid', number: '', quantity: '0,5', price: '' },
          { name: ' Disc ', number: 'abc 1', quantity: '', price: '' },
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
        { name: 'Brake pads', number: '8-97366-123-0', quantity: 2, price: null },
        { name: 'Brake fluid', number: '', quantity: 0.5, price: null },
        { name: 'Disc', number: 'ABC 1', quantity: 1, price: null },
      ],
      hours: null,
      labour: null,
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
            { name: '', number: 'X-1', quantity: '1', price: '' },
            { name: 'Bulb', number: '', quantity: '0', price: '' },
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
        form({ work: '', parts: [{ name: 'Wiper blade', number: '', quantity: '2', price: '' }] }),
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
      parts: [{ name: 'Brake pads', number: 'BP-1', quantity: 2, price: null }],
    });
    const again = toRepairForm(saved, vehicles);
    expect(again).toMatchObject({ vehicle: 'Bus 105', mileage: '', system: 'Brakes' });
    expect(again.parts).toEqual([{ name: 'Brake pads', number: 'BP-1', quantity: '2', price: '' }]);
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
    expect(isRepairsState(repairs(repair({ hours: 0 })))).toBe(false);
    expect(isRepairsState(repairs(repair({ labour: -1 })))).toBe(false);
    const many = Array.from({ length: LIMITS.parts + 1 }, () => ({
      name: 'Bolt',
      number: '',
      quantity: 1,
      price: null,
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
      parts: [{ name: 'Brake pads', number: '8-97366-123-0', quantity: 2, price: null }],
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
        parts: [{ name: 'Oil filter', number: 'OF-1', quantity: 1, price: null }],
        system: 'Gearbox',
      }),
      repair({
        date: '2026-10-10',
        parts: [
          { name: 'oil filter', number: '', quantity: 1, price: null },
          { name: 'Air filter', number: 'AF-2', quantity: 1, price: null },
        ],
        system: 'brakes',
      }),
    );
    expect(partNames(used)).toEqual([
      { name: 'Air filter', number: 'AF-2', price: null },
      { name: 'oil filter', number: 'OF-1', price: null },
    ]);
    expect(systemNames(used)).toEqual([...SYSTEMS, 'Gearbox']);
  });
});

describe('for people', () => {
  it('formats mileage, parts and days', () => {
    expect(formatMileage(123_456, 'km', 'en-US')).toBe('123,456 km');
    expect(formatMileage(80_000, 'mi', 'en-US')).toBe('80,000 mi');
    expect(
      partLabel({ name: 'Brake pads', number: 'BP-1', quantity: 2, price: null }, 'en-US'),
    ).toBe('Brake pads × 2 (BP-1)');
    expect(partLabel({ name: 'Oil', number: '', quantity: 0.5, price: null }, 'en-US')).toBe(
      'Oil × 0.5',
    );
    expect(partLabel({ name: 'Bulb', number: '', quantity: 1, price: null })).toBe('Bulb');
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
            { name: 'Brake pads', number: 'BP-1', quantity: 2, price: 45 },
            { name: 'Clip', number: '', quantity: 1, price: null },
          ],
          hours: 1.5,
          labour: 20,
        }),
      ),
      vehicles,
      setCurrency(emptySettings(), 'GEL'),
    );
    expect(csv.split('\r\n')).toEqual([
      'Date,Vehicle,Model,Plate,Mileage (km),System,Damage found,Work done,Parts replaced,Hours worked,Parts cost (GEL),Labour cost (GEL),Total cost (GEL)',
      '2026-10-21,Bus 12,Isuzu Novociti Life,TB-012-BB,,,,Pads,Brake pads × 2 (BP-1); Clip,1.5,90,20,110',
      `2026-10-20,Bus 105,Isuzu Novociti Life,,120000,Brakes,'=cmd,"Fixed, ""properly""",,,,,`,
      '',
    ]);
  });

  it('uses kilometres and dollars until others are chosen', () => {
    expect(unitOf(emptySettings())).toBe('km');
    expect(currencyOf(emptySettings())).toBe('USD');
    const both = setCurrency(setUnit(emptySettings(), 'mi'), 'GEL');
    expect(unitOf(both)).toBe('mi');
    expect(currencyOf(both)).toBe('GEL');
    expect(unitOf(setCurrency(both, 'EUR'))).toBe('mi');
    expect(withSettings([{ id: 'unit', unit: 'leagues' }]).settings).toEqual([]);
    expect(
      withSettings([
        { id: 'currency', currency: 'GEL' },
        { id: 'unit', unit: 'mi' },
        { id: 'unit', unit: 'km' },
      ]).settings,
    ).toEqual([
      { id: 'unit', unit: 'mi' },
      { id: 'currency', currency: 'GEL' },
    ]);
  });
});

describe('hours worked and costs', () => {
  it('reads the hours, labour and part prices', () => {
    const read = readRepair(
      form({
        hours: '1,5',
        labour: '20',
        parts: [
          { name: 'Brake pads', number: '', quantity: '2', price: '45.50' },
          { name: 'Clip', number: '', quantity: '4', price: '' },
        ],
      }),
      'r',
      emptyRepairs(),
      vehicles,
      newId,
    ).repair;
    expect(read).toMatchObject({
      hours: 1.5,
      labour: 20,
      parts: [
        { name: 'Brake pads', number: '', quantity: 2, price: 45.5 },
        { name: 'Clip', number: '', quantity: 4, price: null },
      ],
    });
    expect(toRepairForm(read as Repair, vehicles)).toMatchObject({
      hours: '1.5',
      labour: '20',
      parts: [{ price: '45.5' }, { price: '' }],
    });
  });

  it('says what’s wrong with them', () => {
    expect(
      readRepair(
        form({
          hours: '0',
          labour: '-5',
          parts: [
            { name: 'Bulb', number: '', quantity: '1', price: 'x' },
            { name: '', number: '', quantity: '1', price: '3' },
          ],
        }),
        'r',
        emptyRepairs(),
        vehicles,
        newId,
      ).problems,
    ).toEqual({
      hours: 'Enter the hours as a number above 0, or leave it empty.',
      labour: 'Enter an amount, or leave it empty.',
      'part-price-0': 'Enter a price, or leave it empty.',
      'part-name-1': 'Enter the part’s name.',
    });
  });

  it('works out what a repair cost', () => {
    expect(
      repairCost(
        repair({
          parts: [
            { name: 'Brake pads', number: '', quantity: 2, price: 45.5 },
            { name: 'Clip', number: '', quantity: 4, price: null },
          ],
          labour: 20,
        }),
      ),
    ).toEqual({ parts: 91, labour: 20, total: 111 });
    expect(repairCost(repair({ labour: 0 }))).toEqual({ parts: 0, labour: 0, total: 0 });
    expect(
      repairCost(repair({ parts: [{ name: 'Clip', number: '', quantity: 1, price: null }] })),
    ).toBeNull();
  });

  it('adds up hours and costs, by day and by vehicle', () => {
    expect(
      totals([
        repair({ hours: 0.1, labour: 10.1 }),
        repair({ hours: 0.2, labour: 20.2 }),
        repair({}),
      ]),
    ).toEqual({ hours: 0.3, cost: 30.3 });
    expect(totals([repair({})])).toEqual({ hours: null, cost: null });
    const summaries = vehicleSummaries(
      vehicles,
      repairs(repair({ id: 'a', labour: 50 }), repair({ id: 'b', vehicle: 'b12' })),
    );
    expect(summaries.map((summary) => summary.cost)).toEqual([null, 50, null]);
  });

  it('remembers each part’s last number and price', () => {
    const used = repairs(
      repair({
        date: '2026-10-01',
        parts: [{ name: 'Oil filter', number: 'OF-1', quantity: 1, price: 12 }],
      }),
      repair({
        date: '2026-10-10',
        parts: [{ name: 'oil filter', number: '', quantity: 1, price: null }],
      }),
    );
    expect(knownPart(used, 'OIL FILTER')).toEqual({
      name: 'oil filter',
      number: 'OF-1',
      price: 12,
    });
    expect(knownPart(used, 'Air filter')).toBeUndefined();
  });

  it('in words', () => {
    expect(formatHours(1, 'en-US')).toBe('1 hour');
    expect(formatHours(2.5, 'en-US')).toBe('2.5 hours');
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(80, 'GEL', 'en-US')).toMatch(/^GEL\s80\.00$/);
  });

  it('upgrades repairs saved before hours and costs', () => {
    const old = {
      repairs: [
        {
          id: 'a',
          vehicle: 'b105',
          date: '2026-10-21',
          mileage: 120_000,
          system: 'Brakes',
          problem: '',
          work: 'Pads',
          parts: [{ name: 'Brake pads', number: 'BP-1', quantity: 2 }],
        },
      ],
    };
    const upgraded = migrateRepairs(old, 1);
    expect(upgraded?.repairs[0]).toMatchObject({
      hours: null,
      labour: null,
      parts: [{ name: 'Brake pads', number: 'BP-1', quantity: 2, price: null }],
    });
    expect(isRepairsState(upgraded)).toBe(true);
    expect(isRepairsState(old)).toBe(false);
    expect(migrateRepairs(old, 2)).toBeUndefined();
    expect(migrateRepairs(null, 1)).toBeUndefined();
  });
});
