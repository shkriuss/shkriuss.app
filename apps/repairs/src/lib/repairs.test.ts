import { describe, expect, it } from 'vitest';
import { addDays } from '@shkriuss/dates';
import { footprint, sampleText } from '@shkriuss/sync/testing';
import { MAX_SEALED_CHARS } from '../../../../packages/sync/src/validate.ts';
import {
  byDay,
  currencyOf,
  dateLabel,
  fromPhotoFile,
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
  isVehiclesState,
  knownPart,
  LIMITS,
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
  REPAIRS_VERSION,
  roomNote,
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
  photos: [],
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
  photos: [],
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

  // Audit F2-6: two devices that each added "Bus 105" before they first
  // synced have twins, and neither could be changed.
  it('lets a vehicle keep a name it shares with another', () => {
    const twins = { vehicles: [...vehicles.vehicles, vehicle({ id: 'b105-2', name: 'Bus 105' })] };
    const details = { model: 'Isuzu Novociti Life', plate: 'tb-105-aa', notes: '' };
    expect(readVehicle({ ...details, name: 'bus 105' }, 'b105-2', twins).vehicle).toEqual({
      id: 'b105-2',
      name: 'bus 105',
      ...details,
      plate: 'TB-105-AA',
    });
    expect(readVehicle({ ...details, name: 'Bus 105' }, 'b105', twins).problems).toBeUndefined();
    // A new name is still checked, and so is a new vehicle.
    expect(readVehicle({ ...details, name: 'Bus 12' }, 'b105-2', twins).problems).toEqual({
      name: 'You already have a vehicle with that name.',
    });
    expect(readVehicle({ ...details, name: 'Bus 105' }, 'new', twins).problems).toEqual({
      name: 'You already have a vehicle with that name.',
    });
  });

  // Audit F2-2: a virama or a Thai tone mark was dropped like an accent.
  it('tells apart names that differ in a vowel sign or a tone mark', () => {
    const named = (name: string) => ({ vehicles: [vehicle({ id: 'x', name })] });
    const details = { model: '', plate: '', notes: '' };
    // Hindi: truck, and the same letters without the virama.
    expect(readVehicle({ ...details, name: 'टरक 1' }, 'y', named('ट्रक 1')).vehicle?.name).toBe(
      'टरक 1',
    );
    expect(findVehicleByName(named('ट्रक 1'), 'टरक 1')).toBeUndefined();
    // Thai: chicken, and the same letters without the tone mark.
    expect(findVehicleByName(named('ไก่ 1'), 'ไก 1')).toBeUndefined();
    expect(findVehicleByName(named('ไก่ 1'), ' ไก่  1 ')?.id).toBe('x');
    // Accents, case and apostrophes still don't matter.
    expect(findVehicleByName(named('Mike’s Van'), 'mikes van')?.id).toBe('x');
    expect(findVehicleByName(named('Café'), 'CAFE')?.id).toBe('x');
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
      photos: [],
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
      problem: 'Describe the damage found or the work done, or add a part or a photo.',
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
    // In German too, where "1.125" would be one thousand one hundred and twenty-five.
    const exact = repair({
      mileage: 120_000,
      parts: [{ name: 'Oil', number: '', quantity: 1.125, price: 1.234 }],
      hours: 1.125,
      labour: 1234.5,
    });
    const german = toRepairForm(exact, vehicles, 'de-DE');
    expect(german).toMatchObject({ mileage: '120000', hours: '1,125', labour: '1234,5' });
    expect(readRepair(german, 'r', repairs(exact), vehicles, newId, 'de-DE').repair).toEqual(exact);
  });

  // Audit F2-1: "1,500" was read as 1.5, and a mileage of "120.000" as 120.
  it('reads numbers the way the person’s language writes them', () => {
    const typed = (fields: Partial<RepairForm>, locale: string) =>
      readRepair(form(fields), 'r', emptyRepairs(), vehicles, newId, locale);
    const part = (quantity: string, price: string) => ({
      name: 'Gearbox',
      number: '',
      quantity,
      price,
    });
    expect(
      typed({ mileage: '120,000', parts: [part('1,500', '1,500')], labour: '2,000' }, 'en-US')
        .repair,
    ).toMatchObject({ mileage: 120_000, parts: [{ quantity: 1500, price: 1500 }], labour: 2000 });
    expect(
      typed(
        { mileage: '120.000', parts: [part('1,5', '1.500')], labour: '2.000', hours: '1,5' },
        'de-DE',
      ).repair,
    ).toMatchObject({
      mileage: 120_000,
      parts: [{ quantity: 1.5, price: 1500 }],
      labour: 2000,
      hours: 1.5,
    });
    // A mileage with decimals, or anything but digits, is asked for again.
    for (const mileage of ['120.000', '12.5', '1e3', '0x10', '-5']) {
      expect(typed({ mileage }, 'en-US').problems, mileage).toEqual({
        mileage: 'Enter the mileage as a whole number, or leave it empty.',
      });
    }
    for (const quantity of ['1e3', '0x10', 'Infinity']) {
      expect(typed({ parts: [part(quantity, '')] }, 'en-US').problems, quantity).toEqual({
        'part-quantity-0': 'Enter a number above 0.',
      });
    }
    // Audit 3 F2-3: in French, a price typed "1.500" was saved as 1.5. A price
    // or labour that could be thousands or decimals is asked again; a quantity
    // or hours (not money) are read as typed.
    expect(
      typed({ parts: [part('1.500', '1.500')], labour: '2.000', hours: '1.5' }, 'fr-FR').problems,
    ).toEqual({
      'part-price-0': 'Enter 1500 or 1,5 to show which you mean.',
      labour: 'Enter 2000 or 2 to show which you mean.',
    });
    expect(
      typed({ parts: [part('1.500', '1 500,50')], labour: '2,5' }, 'fr-FR').repair,
    ).toMatchObject({ parts: [{ quantity: 1.5, price: 1500.5 }], labour: 2.5 });
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

describe('making room', () => {
  const years = repairs(
    repair({ id: 'a', date: '2024-03-02', photos: ['p1', 'p2'] }),
    repair({ id: 'b', date: '2026-10-21' }),
    repair({ id: 'c', date: '2024-12-31', vehicle: 'b12', photos: ['p3'] }),
    repair({ id: 'd', date: '2025-01-01' }),
  );

  it('lists the years with repairs, and deletes one with its photos', () => {
    expect(repairYears(years)).toEqual([
      { year: '2024', count: 2 },
      { year: '2025', count: 1 },
      { year: '2026', count: 1 },
    ]);
    expect(repairYears(emptyRepairs())).toEqual([]);
    expect(photosOf(repairsIn(years, '2024'))).toEqual(['p1', 'p2', 'p3']);
    expect(removeYear(years, '2024').repairs.map((item) => item.id)).toEqual(['b', 'd']);
    expect(removeYear(years, '2023')).toEqual(years);
  });

  it('says so once Repairs is nearly full', () => {
    const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
    const nearly = LIMITS.repairs * 0.9;
    const makeRoom =
      'To make room, download the spreadsheet, then use “Delete a year…” under Units and spreadsheet, below.';
    expect(roomNote(nearly, 'en-US')).toBeNull();
    expect(roomNote(nearly + 1, 'en-US')).toBe(
      `Repairs is nearly full: there’s room for ${number(LIMITS.repairs - nearly - 1)} more repairs (it keeps up to ${number(LIMITS.repairs)}). ${makeRoom}`,
    );
    expect(roomNote(LIMITS.repairs - 1, 'en-US')).toContain('there’s room for 1 more repair (');
    expect(roomNote(LIMITS.repairs, 'en-US')).toBe(
      `Repairs is full: it keeps up to ${number(LIMITS.repairs)} repairs. ${makeRoom}`,
    );
    const full = repairs(
      ...Array.from({ length: LIMITS.repairs }, (_, index) => repair({ id: `r${index}` })),
    );
    expect(readRepair(form({}), 'new', full, vehicles, newId, 'en-US').problems).toEqual({
      vehicle: `You can keep up to ${number(LIMITS.repairs)} repairs. To make room, delete a year (under Units and spreadsheet).`,
    });
    // A repair already kept can still be changed.
    expect(readRepair(form({}), 'r0', full, vehicles, newId, 'en-US').repair).toBeDefined();
  });

  // Audit F2-3: 10,000 repairs didn't fit. Every repair is saved on the device
  // (in localStorage, about 5 MB for each site), and with sync on, also goes
  // into the copy that goes online.
  it('has room for every repair, on the device and in the sync copy', async () => {
    const ids = Array.from({ length: 60 }, () => crypto.randomUUID());
    const list = Array.from({ length: LIMITS.repairs }, (_, index): Repair => ({
      id: crypto.randomUUID(),
      vehicle: ids[index % ids.length] ?? '',
      // Five a working day.
      date: addDays('2020-01-01', Math.floor(index / 5)),
      mileage: 100_000 + index * 37,
      system: SYSTEMS[index % SYSTEMS.length] ?? '',
      // Modest texts: 200 characters (of the 4,000 allowed).
      problem: sampleText(80, index),
      work: sampleText(120, index + 1),
      // Two parts on two repairs in three, a photo or two on one in four.
      parts:
        index % 3 === 0
          ? []
          : [
              { name: 'Brake pads', number: '8-97366-123-0', quantity: 2, price: 45.5 },
              { name: 'Brake disc', number: '', quantity: 1, price: null },
            ],
      hours: 1.5,
      labour: index % 2 ? 50 : null,
      photos: index % 4 === 0 ? [crypto.randomUUID(), crypto.randomUUID()] : [],
    }));
    const size = await footprint({
      app: 'repairs',
      store: 'shkriuss:repairs',
      version: REPAIRS_VERSION,
      data: { repairs: list },
      items: list,
      // A quarter of them deleted ("Delete a year") less than 180 days ago.
      deleted: LIMITS.repairs / 4,
    });
    expect(size.saved).toBeLessThan(2_000_000);
    expect(size.compressed).toBeLessThan(1_000_000);
    expect(size.sealed).toBeLessThan(MAX_SEALED_CHARS);
    // Safari allows 5 MiB (5,242,880 bytes), and counts 2 bytes for each
    // character of text with any character beyond Latin-1 (like ’ from an
    // iPhone's keyboard, or Georgian). Sync's own records are plain letters
    // and digits: 1 byte each. Some room is left for the rest (the vehicles).
    expect(2 * size.saved + size.syncState).toBeLessThan(4_500_000);
  }, 60_000);
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

  it('finds words with vowel signs from their start, like any other', () => {
    // Hindi: "changed the brake oil" (तेल is oil).
    const written = repairs(repair({ id: 'h', work: 'ब्रेक तेल बदला' }));
    const found = (query: string) =>
      findRepairs(written, vehicles, { vehicle: null, query }).map((item) => item.id);
    expect(found('तेल')).toEqual(['h']);
    expect(found('ते')).toEqual(['h']);
    // Not from the middle of a word, as "7" doesn't find "97366".
    expect(found('ेल')).toEqual([]);
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
      // A byte-order mark first, for Excel (audit 3 F2-6).
      '\uFEFFDate,Vehicle,Model,Plate,Mileage (km),System,Damage found,Work done,Parts replaced,Hours worked,Parts cost (GEL),Labour cost (GEL),Total cost (GEL)',
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
    expect(toRepairForm(read as Repair, vehicles, 'en-US')).toMatchObject({
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

  it('adds up each part as it’s shown, rounded once', () => {
    // 2.5 litres at $3.45 shows as $8.63: two of them make $17.26, not $17.25
    // (audit F2-13).
    const oil = { name: 'Oil', number: '', quantity: 2.5, price: 3.45 };
    expect(partCost(oil)).toBe(8.63);
    expect(partCost({ ...oil, price: null })).toBeNull();
    const twice = repair({ parts: [oil, { ...oil, name: 'Gear oil' }], labour: 10.004 });
    expect(repairCost(twice)).toEqual({ parts: 17.26, labour: 10, total: 27.26 });
    expect(totals([twice, twice])).toEqual({ hours: null, cost: 54.52 });
    // Yen have no decimals: 1.5 × ¥333 shows as ¥500, and two make ¥1,000.
    const bolts = { name: 'Bolts', number: '', quantity: 1.5, price: 333 };
    expect(partCost(bolts, 'JPY')).toBe(500);
    const yen = repair({ parts: [bolts, { ...bolts, name: 'Nuts' }] });
    expect(repairCost(yen, 'JPY')).toEqual({ parts: 1000, labour: 0, total: 1000 });
    expect(totals([yen], 'JPY')).toEqual({ hours: null, cost: 1000 });
    expect(vehicleSummaries(vehicles, repairs(yen), 'JPY').map((summary) => summary.cost)).toEqual([
      null,
      1000,
      null,
    ]);
    // The spreadsheet has the same sums.
    const csv = toCsv(repairs(yen), vehicles, setCurrency(emptySettings(), 'JPY'));
    expect(csv.split('\r\n')[1]).toMatch(/,1000,0,1000$/);
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
    expect(formatMoney(1234.5, 'USD', { locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney(80, 'GEL', { locale: 'en-US' })).toMatch(/^GEL\s80\.00$/);
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
    expect(upgraded?.repairs[0]?.photos).toEqual([]);
    expect(isRepairsState(upgraded)).toBe(true);
    expect(isRepairsState(old)).toBe(false);
    expect(migrateRepairs(old, 3)).toBeUndefined();
    expect(migrateRepairs(null, 1)).toBeUndefined();
  });
});

describe('photos', () => {
  it('upgrades repairs saved before photos, keeping their costs', () => {
    const saved = {
      repairs: [
        {
          id: 'a',
          vehicle: 'b105',
          date: '2026-10-21',
          mileage: null,
          system: '',
          problem: '',
          work: 'Pads',
          parts: [{ name: 'Brake pads', number: '', quantity: 2, price: 45 }],
          hours: 1.5,
          labour: 20,
        },
      ],
    };
    const upgraded = migrateRepairs(saved, 2);
    expect(upgraded?.repairs[0]).toMatchObject({
      hours: 1.5,
      labour: 20,
      parts: [{ price: 45 }],
      photos: [],
    });
    expect(isRepairsState(upgraded)).toBe(true);
  });

  it('keeps up to 10 photos, and a photo alone is enough', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `p${index}`);
    expect(
      readRepair(form({ work: '', photos: ten }), 'r', emptyRepairs(), vehicles, newId).repair
        ?.photos,
    ).toEqual(ten);
    expect(
      readRepair(form({ photos: [...ten, 'p10'] }), 'r', emptyRepairs(), vehicles, newId).problems,
    ).toEqual({ photos: 'Add up to 10 photos.' });
    expect(isRepairsState(repairs(repair({ photos: [...ten, 'p10'] })))).toBe(false);
    expect(isRepairsState(repairs(repair({ photos: [''] })))).toBe(false);
    expect(toRepairForm(repair({ photos: ['p1', 'p2'] }), vehicles).photos).toEqual(['p1', 'p2']);
    expect(photosOf([repair({ photos: ['p1'] }), repair({ photos: ['p2', 'p3'] })])).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('sync as a thumbnail and a full photo, each a file', () => {
    const id = '6f1c2d3e-0000-4000-8000-000000000000';
    expect(photoFiles([id, 'p2'])).toEqual([`${id}.thumb`, `${id}.full`, 'p2.thumb', 'p2.full']);
    // Not one this app made: it can't be a file, so it never syncs.
    expect(photoFiles(['a/b', 'x'.repeat(65)])).toEqual([]);
    expect(fromPhotoFile(`${id}.full`)).toEqual({ photo: id, part: 'full' });
    expect(fromPhotoFile('p2.thumb')).toEqual({ photo: 'p2', part: 'thumb' });
    for (const file of ['p2', 'p2.png', '.thumb', 'a/b.full'])
      expect(fromPhotoFile(file)).toBeNull();
  });
});
