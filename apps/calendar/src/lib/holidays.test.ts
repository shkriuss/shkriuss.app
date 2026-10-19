import { describe, expect, it } from 'vitest';
import { addDays } from './dates.ts';
import {
  DEFAULT_SETTINGS,
  displayName,
  isNotable,
  isSpecialDaySettings,
  kindLabel,
  marksOf,
  orthodoxEaster,
  specialDaysBetween,
  specialDaysOn,
  type SpecialDaySettings,
} from './holidays.ts';

const everything: SpecialDaySettings = {
  daysOff: true,
  feasts: true,
  fasts: true,
  weeklyFasts: true,
};
const names = (date: string, settings = DEFAULT_SETTINGS) =>
  specialDaysOn(date, settings).map((day) => day.name);
/** What kind of day the first thing on a day is. */
function firstKind(date: string, settings = DEFAULT_SETTINGS): string {
  const [first] = specialDaysOn(date, settings);
  if (!first) throw new Error(`Nothing on ${date}`);
  return kindLabel(first, settings);
}

describe('orthodoxEaster', () => {
  it('finds Orthodox Easter Sunday', () => {
    expect(
      [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030].map((year) => orthodoxEaster(year)),
    ).toEqual([
      '2023-04-16',
      '2024-05-05',
      '2025-04-20',
      '2026-04-12',
      '2027-05-02',
      '2028-04-16',
      '2029-04-08',
      '2030-04-28',
    ]);
  });
});

describe('days off', () => {
  const daysOff = (year: number) =>
    [...specialDaysBetween(`${year}-01-01`, `${year}-12-31`, DEFAULT_SETTINGS)]
      .filter(([, days]) => days.some((day) => day.dayOff))
      .map(([date]) => date);

  it('are the 18 days in the Labour Code (Article 30)', () => {
    expect(daysOff(2026)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-07',
      '2026-01-19',
      '2026-03-03',
      '2026-03-08',
      '2026-04-09',
      // Good Friday, Holy Saturday, Easter, Easter Monday
      '2026-04-10',
      '2026-04-11',
      '2026-04-12',
      '2026-04-13',
      '2026-05-09',
      '2026-05-12',
      '2026-05-17',
      '2026-05-26',
      '2026-08-28',
      '2026-10-14',
      '2026-11-23',
    ]);
  });

  it('move the Easter days with Easter', () => {
    expect(daysOff(2027).filter((date) => date >= '2027-04-28' && date <= '2027-05-05')).toEqual([
      '2027-04-30',
      '2027-05-01',
      '2027-05-02',
      '2027-05-03',
    ]);
  });

  it('start in 2024, with today’s list; church days stay', () => {
    expect(daysOff(2023)).toEqual([]);
    // New Year wasn't a day off in this list yet: only the Nativity Fast shows.
    expect(names('2023-01-01')).toEqual(['Nativity Fast']);
    expect(names('2023-01-07')).toEqual(['Christmas']);
    expect(specialDaysOn('2023-01-07', DEFAULT_SETTINGS)[0]?.dayOff).toBe(false);
  });
});

describe('the Georgian Orthodox calendar for 2026 (as orthodoxy.ge lists it)', () => {
  const span = (id: string) => {
    const dates = [...specialDaysBetween('2026-01-01', '2026-12-31', DEFAULT_SETTINGS)]
      .filter(([, days]) => days.some((day) => day.id === id))
      .map(([date]) => date);
    return [dates[0], dates.at(-1), dates.length];
  };

  it('has the fasts', () => {
    expect(span('great-lent')).toEqual(['2026-02-23', '2026-04-11', 48]);
    expect(span('apostles-fast')).toEqual(['2026-06-08', '2026-07-11', 34]);
    expect(span('dormition-fast')).toEqual(['2026-08-14', '2026-08-27', 14]);
    expect(names('2026-01-06')).toEqual(['Nativity Fast']);
    expect(names('2026-11-28')).toEqual(['Nativity Fast']);
    // The one-day fasts.
    expect(names('2026-01-18')).toEqual(['Eve of Epiphany']);
    expect(names('2026-09-11')).toEqual(['Beheading of St John the Baptist']);
    expect(firstKind('2026-09-27')).toBe('Orthodox holiday · Fast day');
  });

  it('marks the first day of a longer fast', () => {
    const starts = (date: string) =>
      specialDaysOn(date, DEFAULT_SETTINGS).find((day) => day.fast)?.starts;
    expect(starts('2026-02-23')).toBe(true);
    expect(starts('2026-02-24')).toBe(false);
    expect(starts('2026-11-28')).toBe(true);
    // The Nativity Fast started the year before.
    expect(starts('2026-01-01')).toBe(false);
  });

  it('has the holidays that move with Easter', () => {
    expect(names('2026-04-05')).toEqual(['Palm Sunday', 'Great Lent']);
    expect(names('2026-05-21')).toEqual(['Ascension']);
    expect(names('2026-05-31')).toEqual(['Pentecost']);
    expect(names('2026-06-01')).toEqual([
      'Ninooba (St Nino comes to Georgia)',
      'Day of the Holy Spirit',
    ]);
  });

  it('has the holidays on fixed dates, in the old calendar', () => {
    const fixed = {
      '2026-01-07': 'Christmas',
      '2026-01-19': 'Epiphany',
      '2026-02-15': 'Presentation of the Lord',
      '2026-08-19': 'Transfiguration',
      '2026-08-28': 'Mariamoba (Dormition of the Mother of God)',
      '2026-09-21': 'Nativity of the Mother of God',
      '2026-10-14': 'Svetitskhovloba (Mtskhetoba)',
      '2026-11-23': 'Giorgoba (St George’s Day)',
      '2026-12-04': 'Entry of the Mother of God into the Temple',
    };
    for (const [date, name] of Object.entries(fixed)) expect(names(date)[0]).toBe(name);
    // During a fast, both show.
    expect(names('2026-04-07')).toEqual(['Annunciation', 'Great Lent']);
  });

  it('is the same Christmas in every year it covers, and nothing outside them', () => {
    expect(names('2099-01-07')).toEqual(['Christmas']);
    expect(names('1901-01-07')).toEqual(['Christmas']);
    expect(names('2100-01-07')).toEqual([]);
    expect(names('1900-01-07')).toEqual([]);
  });
});

describe('Wednesday and Friday fasts', () => {
  const weekly = (date: string) =>
    specialDaysOn(date, everything).some((day) => day.fast === 'weekly');

  it('are shown only when asked for', () => {
    expect(names('2026-10-21')).toEqual([]);
    expect(names('2026-10-21', everything)).toEqual(['Wednesday fast']);
    expect(names('2026-10-23', everything)).toEqual(['Friday fast']);
    expect(names('2026-10-21', { ...everything, fasts: false })).toEqual([]);
  });

  it('aren’t kept in the weeks without fasting, or twice in a longer fast', () => {
    // Christmas to Epiphany; the week after the Publican and the Pharisee;
    // Cheese Week; Bright Week; the week after Pentecost.
    for (const date of ['2026-01-14', '2026-02-04', '2026-02-18', '2026-04-15', '2026-06-03']) {
      expect(weekly(date)).toBe(false);
    }
    expect(names('2026-03-04', everything)).toEqual(['Great Lent']);
    expect(weekly('2026-02-11')).toBe(true);
  });
});

describe('settings', () => {
  it('show only the chosen kinds', () => {
    const noDaysOff = { ...DEFAULT_SETTINGS, daysOff: false };
    // Christmas is a church holiday too; Mother's Day is only a day off
    // (in 2026 it's during Great Lent, which still shows).
    expect(names('2026-01-07', noDaysOff)).toEqual(['Christmas']);
    expect(firstKind('2026-01-07', noDaysOff)).toBe('Orthodox holiday');
    expect(names('2026-03-03')).toEqual(['Mother’s Day', 'Great Lent']);
    expect(names('2026-03-03', noDaysOff)).toEqual(['Great Lent']);
    const onlyDaysOff = { ...DEFAULT_SETTINGS, feasts: false, fasts: false };
    expect(names('2026-04-05', onlyDaysOff)).toEqual([]);
    expect(firstKind('2026-01-07', onlyDaysOff)).toBe('Day off');
    expect(firstKind('2026-01-07')).toBe('Day off · Orthodox holiday');
  });

  it('are checked when loaded', () => {
    expect(isSpecialDaySettings(DEFAULT_SETTINGS)).toBe(true);
    expect(isSpecialDaySettings({ ...DEFAULT_SETTINGS, fasts: 'yes' })).toBe(false);
    expect(isSpecialDaySettings(null)).toBe(false);
  });
});

describe('specialDaysBetween', () => {
  it('lists only days with something on, across years', () => {
    const found = specialDaysBetween('2026-12-30', addDays('2026-12-30', 3), DEFAULT_SETTINGS);
    expect([...found.keys()]).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(found.get('2027-01-01')?.map((day) => day.name)).toEqual(['New Year', 'Nativity Fast']);
  });
});

describe('showing them', () => {
  it('marks days off, holidays and fasts on the month, as chosen', () => {
    const christmasEve = specialDaysOn('2026-01-06', DEFAULT_SETTINGS);
    expect(marksOf(christmasEve, DEFAULT_SETTINGS)).toEqual({
      dayOff: false,
      feast: false,
      fast: true,
    });
    const easter = specialDaysOn('2026-04-12', DEFAULT_SETTINGS);
    expect(marksOf(easter, DEFAULT_SETTINGS)).toEqual({ dayOff: true, feast: true, fast: false });
    const noDaysOff = { ...DEFAULT_SETTINGS, daysOff: false };
    expect(marksOf(easter, noDaysOff)).toEqual({ dayOff: false, feast: true, fast: false });
  });

  it('names the first day of a fast, and lists only notable days ahead', () => {
    const [lent] = specialDaysOn('2026-02-23', DEFAULT_SETTINGS);
    expect(lent && displayName(lent)).toBe('Great Lent starts');
    const ahead = (date: string) =>
      specialDaysOn(date, { ...DEFAULT_SETTINGS, weeklyFasts: true })
        .filter(isNotable)
        .map(displayName);
    expect(ahead('2026-02-23')).toEqual(['Great Lent starts']);
    expect(ahead('2026-02-24')).toEqual([]);
    expect(ahead('2026-10-21')).toEqual([]);
    expect(ahead('2026-04-05')).toEqual(['Palm Sunday']);
  });
});
