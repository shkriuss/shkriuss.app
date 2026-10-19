/**
 * Holidays, days off and fasts in Georgia, worked out on the device for any
 * year (nothing is downloaded):
 *
 * - Days off: the public holidays in Georgia's Labour Code (Article 30), as
 *   the law stands in 2026, shown from 2024 (when 17 May became one). The
 *   government sometimes adds other days off by decree (for example on
 *   election days); those can't be known ahead, so aren't here.
 * - Orthodox holidays and fasts: the Georgian Orthodox Church's calendar. The
 *   Church keeps the old (Julian) calendar, 13 days behind ours from 1900 to
 *   2100, so Christmas is on 7 January. Easter is worked out the Orthodox
 *   way, and Lent, Palm Sunday, Ascension and Pentecost follow it.
 *
 * Checked against matsne.gov.ge (the Labour Code) and orthodoxy.ge (the
 * 2026 church calendar); see holidays.test.ts.
 */
import { addDays, isIsoDate, makeDate, parts, weekday, type IsoDate } from './dates.ts';

/** Years with church dates (the 13-day gap holds from 1900 to 2100). */
export const FIRST_YEAR = 1901;
export const LAST_YEAR = 2099;
/** The first year with today's list of days off. */
export const DAYS_OFF_FROM = 2024;

export interface SpecialDay {
  /** What it is, for telling entries apart ("christmas", "great-lent"). */
  id: string;
  name: string;
  /** Its Georgian name. */
  nameKa: string;
  /** An official day off in Georgia. */
  dayOff: boolean;
  /** A holiday of the Orthodox Church. */
  feast: boolean;
  /** A fast: on one day, a day of a longer fast, or a Wednesday or Friday. */
  fast: 'day' | 'period' | 'weekly' | null;
  /** The first day of a longer fast. */
  starts: boolean;
}

/** What to show on the calendar. */
export interface SpecialDaySettings {
  daysOff: boolean;
  feasts: boolean;
  fasts: boolean;
  /** Wednesdays and Fridays too (only with `fasts`). */
  weeklyFasts: boolean;
}

export const DEFAULT_SETTINGS: SpecialDaySettings = {
  daysOff: true,
  feasts: true,
  fasts: true,
  weeklyFasts: false,
};

export function isSpecialDaySettings(value: unknown): value is SpecialDaySettings {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (['daysOff', 'feasts', 'fasts', 'weeklyFasts'] as const).every(
    (key) => typeof record[key] === 'boolean',
  );
}

/** Orthodox Easter Sunday, in our (Gregorian) calendar. */
export function orthodoxEaster(year: number): IsoDate {
  // Meeus's method for the Julian calendar, then 13 days on.
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(makeDate(year, month, day), 13);
}

type Kind = Pick<SpecialDay, 'dayOff' | 'feast' | 'fast'>;
const DAY_OFF: Kind = { dayOff: true, feast: false, fast: null };
const HOLY_DAY_OFF: Kind = { dayOff: true, feast: true, fast: null };
const FEAST: Kind = { dayOff: false, feast: true, fast: null };
const FEAST_AND_FAST: Kind = { dayOff: false, feast: true, fast: 'day' };
const FAST_DAY: Kind = { dayOff: false, feast: false, fast: 'day' };

/** Days on the same date every year: [month, day, id, name, Georgian name, kind]. */
const FIXED: [number, number, string, string, string, Kind][] = [
  [1, 1, 'new-year', 'New Year', 'ახალი წელი', DAY_OFF],
  [1, 2, 'new-year-2', 'New Year holiday', 'ახალი წლის დღესასწაული', DAY_OFF],
  [1, 7, 'christmas', 'Christmas', 'ქრისტეშობა', HOLY_DAY_OFF],
  [1, 14, 'circumcision', 'Circumcision of the Lord, St Basil the Great', 'წინადაცვეთა', FEAST],
  [1, 18, 'epiphany-eve', 'Eve of Epiphany', 'ნათლისღების წინა დღე', FAST_DAY],
  [1, 19, 'epiphany', 'Epiphany', 'ნათლისღება', HOLY_DAY_OFF],
  [1, 27, 'ninooba-january', 'Ninooba (St Nino)', 'ნინოობა', FEAST],
  [2, 15, 'presentation', 'Presentation of the Lord', 'მირქმა', FEAST],
  [3, 3, 'mothers-day', 'Mother’s Day', 'დედის დღე', DAY_OFF],
  [3, 8, 'womens-day', 'International Women’s Day', 'ქალთა საერთაშორისო დღე', DAY_OFF],
  [4, 7, 'annunciation', 'Annunciation', 'ხარება', FEAST],
  [4, 9, 'national-unity', 'National Unity Day', 'ეროვნული ერთიანობის დღე', DAY_OFF],
  [5, 6, 'giorgoba-may', 'Giorgoba (St George’s Day)', 'გიორგობა', FEAST],
  [5, 9, 'victory-day', 'Victory Day', 'ფაშიზმზე გამარჯვების დღე', DAY_OFF],
  [
    5,
    12,
    'st-andrew',
    'St Andrew the First-Called',
    'წმინდა ანდრია მოციქულის ხსენება',
    HOLY_DAY_OFF,
  ],
  [
    5,
    17,
    'family-day',
    'Family Purity and Respect for Parents Day',
    'ოჯახის სიწმინდისა და მშობლების პატივისცემის დღე',
    DAY_OFF,
  ],
  [5, 26, 'independence-day', 'Independence Day', 'დამოუკიდებლობის დღე', DAY_OFF],
  [6, 1, 'ninooba-june', 'Ninooba (St Nino comes to Georgia)', 'ნინოობა', FEAST],
  [7, 7, 'john-nativity', 'Nativity of St John the Baptist', 'იოანე ნათლისმცემლის შობა', FEAST],
  [7, 12, 'peter-paul', 'Sts Peter and Paul', 'პეტრე-პავლობა', FEAST],
  [8, 19, 'transfiguration', 'Transfiguration', 'ფერისცვალება', FEAST],
  [8, 28, 'mariamoba', 'Mariamoba (Dormition of the Mother of God)', 'მარიამობა', HOLY_DAY_OFF],
  [9, 11, 'john-beheading', 'Beheading of St John the Baptist', 'თავისკვეთა', FEAST_AND_FAST],
  [9, 21, 'theotokos-nativity', 'Nativity of the Mother of God', 'ღვთისმშობლის შობა', FEAST],
  [9, 27, 'exaltation', 'Exaltation of the Cross', 'ჯვართამაღლება', FEAST_AND_FAST],
  [10, 14, 'svetitskhovloba', 'Svetitskhovloba (Mtskhetoba)', 'სვეტიცხოვლობა', HOLY_DAY_OFF],
  [11, 23, 'giorgoba', 'Giorgoba (St George’s Day)', 'გიორგობა', HOLY_DAY_OFF],
  [12, 4, 'entry-temple', 'Entry of the Mother of God into the Temple', 'ტაძრად მიყვანება', FEAST],
];

/** Days that move with Easter: [days from Easter, id, name, Georgian name, kind]. */
const MOVING: [number, string, string, string, Kind][] = [
  [-7, 'palm-sunday', 'Palm Sunday', 'ბზობა', FEAST],
  [-2, 'good-friday', 'Good Friday', 'დიდი პარასკევი', HOLY_DAY_OFF],
  [-1, 'holy-saturday', 'Holy Saturday', 'დიდი შაბათი', HOLY_DAY_OFF],
  [0, 'easter', 'Easter', 'აღდგომა', HOLY_DAY_OFF],
  [
    1,
    'easter-monday',
    'Easter Monday, remembrance of the dead',
    'მიცვალებულთა მოხსენიების დღე',
    HOLY_DAY_OFF,
  ],
  [39, 'ascension', 'Ascension', 'ამაღლება', FEAST],
  [49, 'pentecost', 'Pentecost', 'სულთმოფენობა', FEAST],
  [50, 'holy-spirit', 'Day of the Holy Spirit', 'სულიწმიდის დღე', FEAST],
];

/** Every day from `from` to `to`, both included. */
function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(date);
  return days;
}

/** Order on a day: days off, then holidays, then fasts. */
const rank = (day: SpecialDay): number =>
  day.dayOff ? 0 : day.feast ? 1 : day.fast === 'day' ? 2 : day.fast === 'period' ? 3 : 4;

function buildYear(year: number): Map<IsoDate, SpecialDay[]> {
  const days = new Map<IsoDate, SpecialDay[]>();
  if (year < FIRST_YEAR || year > LAST_YEAR) return days;
  const add = (date: IsoDate, day: SpecialDay): void => {
    const list = days.get(date) ?? [];
    list.push(day);
    days.set(date, list);
  };
  const entry = (id: string, name: string, nameKa: string, kind: Kind): SpecialDay => {
    // Before today's list of days off, the same dates are only church days.
    const dayOff = kind.dayOff && year >= DAYS_OFF_FROM;
    return { id, name, nameKa, ...kind, dayOff, starts: false };
  };

  for (const [month, day, id, name, nameKa, kind] of FIXED) {
    const item = entry(id, name, nameKa, kind);
    if (item.dayOff || item.feast || item.fast) add(makeDate(year, month, day), item);
  }
  const easter = orthodoxEaster(year);
  for (const [offset, id, name, nameKa, kind] of MOVING) {
    add(addDays(easter, offset), entry(id, name, nameKa, kind));
  }

  // Longer fasts: [first day, last day, id, name, Georgian name].
  const periods: [IsoDate, IsoDate, string, string, string][] = [
    [addDays(easter, -48), addDays(easter, -1), 'great-lent', 'Great Lent', 'დიდი მარხვა'],
    [
      addDays(easter, 57),
      makeDate(year, 7, 11),
      'apostles-fast',
      'Apostles’ Fast',
      'პეტრე-პავლობის მარხვა',
    ],
    [
      makeDate(year, 8, 14),
      makeDate(year, 8, 27),
      'dormition-fast',
      'Dormition Fast',
      'მარიამობის მარხვა',
    ],
    // The Nativity Fast runs from 28 November to 6 January.
    [makeDate(year, 1, 1), makeDate(year, 1, 6), 'nativity-fast', 'Nativity Fast', 'შობის მარხვა'],
    [
      makeDate(year, 11, 28),
      makeDate(year, 12, 31),
      'nativity-fast',
      'Nativity Fast',
      'შობის მარხვა',
    ],
  ];
  const fasting = new Set<IsoDate>();
  for (const [from, to, id, name, nameKa] of periods) {
    for (const date of eachDay(from, to)) {
      fasting.add(date);
      const starts = date === from && !(id === 'nativity-fast' && parts(date).month === 1);
      add(date, { id, name, nameKa, dayOff: false, feast: false, fast: 'period', starts });
    }
  }

  // Wednesdays and Fridays are fast days, except in the weeks without fasting.
  const free = new Set<IsoDate>([
    ...eachDay(makeDate(year, 1, 7), makeDate(year, 1, 17)), // Christmas to Epiphany
    makeDate(year, 1, 19), // Epiphany
    ...eachDay(addDays(easter, -69), addDays(easter, -63)), // after the Publican and the Pharisee
    ...eachDay(addDays(easter, -55), addDays(easter, -49)), // Cheese Week
    ...eachDay(addDays(easter, 1), addDays(easter, 7)), // Bright Week
    ...eachDay(addDays(easter, 50), addDays(easter, 56)), // the week after Pentecost
  ]);
  for (const date of eachDay(makeDate(year, 1, 1), makeDate(year, 12, 31))) {
    const day = weekday(date);
    if ((day !== 3 && day !== 5) || free.has(date) || fasting.has(date)) continue;
    if (days.get(date)?.some((item) => item.fast === 'day')) continue;
    const wednesday = day === 3;
    add(date, {
      id: wednesday ? 'wednesday-fast' : 'friday-fast',
      name: wednesday ? 'Wednesday fast' : 'Friday fast',
      nameKa: wednesday ? 'ოთხშაბათის მარხვა' : 'პარასკევის მარხვა',
      dayOff: false,
      feast: false,
      fast: 'weekly',
      starts: false,
    });
  }

  for (const list of days.values()) list.sort((a, b) => rank(a) - rank(b));
  return days;
}

const years = new Map<number, Map<IsoDate, SpecialDay[]>>();

function yearOf(year: number): Map<IsoDate, SpecialDay[]> {
  let found = years.get(year);
  if (!found) {
    found = buildYear(year);
    years.set(year, found);
  }
  return found;
}

/** Whether a day is shown with these settings. */
export function isShown(day: SpecialDay, settings: SpecialDaySettings): boolean {
  if (day.dayOff && settings.daysOff) return true;
  if (day.feast && settings.feasts) return true;
  if (day.fast === 'weekly') return settings.fasts && settings.weeklyFasts;
  return day.fast !== null && settings.fasts;
}

/** The holidays and fasts on a day, as shown with these settings. */
export function specialDaysOn(date: IsoDate, settings: SpecialDaySettings): SpecialDay[] {
  if (!isIsoDate(date)) return [];
  return (yearOf(parts(date).year).get(date) ?? []).filter((day) => isShown(day, settings));
}

/** The holidays and fasts from `from` to `to` (both included), by day. */
export function specialDaysBetween(
  from: IsoDate,
  to: IsoDate,
  settings: SpecialDaySettings,
): Map<IsoDate, SpecialDay[]> {
  const found = new Map<IsoDate, SpecialDay[]>();
  for (const date of eachDay(from, to)) {
    const list = specialDaysOn(date, settings);
    if (list.length > 0) found.set(date, list);
  }
  return found;
}

/** "Day off · Orthodox holiday", "Fast": what kind of day it is, as shown. */
export function kindLabel(day: SpecialDay, settings: SpecialDaySettings): string {
  const kinds: string[] = [];
  if (day.dayOff && settings.daysOff) kinds.push('Day off');
  if (day.feast && settings.feasts) kinds.push('Orthodox holiday');
  if (day.fast !== null && settings.fasts) kinds.push(day.fast === 'day' ? 'Fast day' : 'Fast');
  return kinds.join(' · ');
}

/** "Great Lent starts" on the first day of a longer fast, else its name. */
export const displayName = (day: SpecialDay): string =>
  day.starts ? `${day.name} starts` : day.name;

/** How a day looks on the month: a day off, a ring for a holiday, a line for a fast. */
export function marksOf(
  days: readonly SpecialDay[],
  settings: SpecialDaySettings,
): { dayOff: boolean; feast: boolean; fast: boolean } {
  return {
    dayOff: settings.daysOff && days.some((day) => day.dayOff),
    feast: settings.feasts && days.some((day) => day.feast),
    fast: settings.fasts && days.some((day) => day.fast !== null && isShown(day, settings)),
  };
}

/** Worth listing among the next days: a longer fast only on its first day, no weekly fasts. */
export const isNotable = (day: SpecialDay): boolean =>
  day.fast === 'period' ? day.starts : day.fast !== 'weekly';
