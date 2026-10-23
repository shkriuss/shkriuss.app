/**
 * Water's data and rules, kept separate from the page so they're easy to test.
 * Every function returns new data instead of changing the old.
 *
 * Two lists, saved and synced separately:
 * - drinks: how much (always saved in millilitres) on which day, at what time.
 *   Drinks older than a year are let go (pruneDrinks);
 * - settings: the units, the daily goal, the glass and bottle sizes and the
 *   reminders. Only the ones ever changed are saved, so a new device has
 *   nothing that could win over another device's settings when they first
 *   sync. The others are the defaults for the units in use.
 */
import {
  addDays,
  isIsoDate,
  isIsoTime,
  shiftTime,
  toStamp,
  type IsoDate,
  type IsoTime,
  type Stamp,
} from '@shkriuss/dates';
import type { Notice } from '@shkriuss/push';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

/** Millilitres, or US fluid ounces. */
export type Unit = 'ml' | 'oz';
export const UNITS: readonly Unit[] = ['ml', 'oz'];
export const UNIT_LABELS: Record<Unit, string> = { ml: 'ml', oz: 'fl oz' };

export interface Drink {
  id: string;
  date: IsoDate;
  time: IsoTime;
  ml: number;
}

export interface DrinksState {
  drinks: Drink[];
}

export interface Reminders {
  on: boolean;
  /** Minutes between reminders (one of EVERY_CHOICES). */
  every: number;
  /** The first reminder of the day… */
  from: IsoTime;
  /** …and no reminders after this. */
  until: IsoTime;
}

/** The amounts that can be set: the daily goal and the two quick sizes. */
export type Amount = 'goal' | 'glass' | 'bottle';
export const AMOUNTS: readonly Amount[] = ['goal', 'glass', 'bottle'];

export type Setting =
  | { id: 'unit'; unit: Unit }
  | { id: 'goal'; ml: number }
  | { id: 'glass'; ml: number }
  | { id: 'bottle'; ml: number }
  | ({ id: 'reminders' } & Reminders);

export interface SettingsState {
  /** Only the settings ever changed, in SETTING_IDS order. */
  settings: Setting[];
}

const SETTING_IDS: readonly Setting['id'][] = ['unit', 'goal', 'glass', 'bottle', 'reminders'];

/** A US fluid ounce. */
export const ML_PER_OZ = 29.5735;

export const toMl = (amount: number, unit: Unit): number =>
  Math.round(unit === 'ml' ? amount : amount * ML_PER_OZ);

/** An amount in the units shown: whole millilitres, or ounces to one decimal. */
export const inUnit = (ml: number, unit: Unit): number =>
  unit === 'ml' ? Math.round(ml) : Math.round((ml / ML_PER_OZ) * 10) / 10;

/** The defaults, in millilitres: round numbers in the units in use. */
export const DEFAULTS: Record<Unit, Record<Amount, number>> = {
  ml: { goal: 2000, glass: 250, bottle: 500 },
  oz: { goal: toMl(64, 'oz'), glass: toMl(8, 'oz'), bottle: toMl(16, 'oz') },
};

/** What can be typed, in the units shown: one drink (or a size), and the daily goal. */
export const LIMITS: Record<Unit, { drink: [number, number]; goal: [number, number] }> = {
  ml: { drink: [10, 3000], goal: [500, 10000] },
  oz: { drink: [0.5, 100], goal: [16, 340] },
};

export const MAX_DRINKS_PER_DAY = 40;
/** Drinks are kept this many days (today included). */
export const KEEP_DAYS = 366;

export const EVERY_CHOICES: readonly number[] = [30, 60, 90, 120, 180, 240];
export const DEFAULT_REMINDERS: Reminders = {
  on: false,
  every: 120,
  from: '09:00',
  until: '21:00',
};

export const emptyDrinks = (): DrinksState => ({ drinks: [] });
export const emptySettings = (): SettingsState => ({ settings: [] });

// ---------- Checking saved data ----------

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000;

function isDrink(value: unknown): value is Drink {
  if (typeof value !== 'object' || value === null) return false;
  const { id, date, time, ml } = value as Record<string, unknown>;
  return (
    typeof id === 'string' && id.length > 0 && isIsoDate(date) && isIsoTime(time) && isAmount(ml)
  );
}

function isSetting(value: unknown): value is Setting {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  switch (item['id']) {
    case 'unit':
      return UNITS.includes(item['unit'] as Unit);
    case 'goal':
    case 'glass':
    case 'bottle':
      return isAmount(item['ml']);
    case 'reminders':
      return (
        typeof item['on'] === 'boolean' &&
        EVERY_CHOICES.includes(item['every'] as number) &&
        isIsoTime(item['from']) &&
        isIsoTime(item['until'])
      );
    default:
      return false;
  }
}

/** True when saved drinks have the shape Water expects (limits apply when adding, not here). */
export function isDrinksState(value: unknown): value is DrinksState {
  if (typeof value !== 'object' || value === null) return false;
  const { drinks } = value as Record<string, unknown>;
  return Array.isArray(drinks) && drinks.every(isDrink);
}

export function isSettingsState(value: unknown): value is SettingsState {
  if (typeof value !== 'object' || value === null) return false;
  const { settings } = value as Record<string, unknown>;
  return Array.isArray(settings) && settings.every(isSetting);
}

/** Oldest first. Drinks at the same minute keep their order (the one added last, last). */
const drinkOrder = (a: Drink, b: Drink): number =>
  toStamp(a.date, a.time).localeCompare(toStamp(b.date, b.time));

/** Drinks from sync: the ones that look right, oldest first. */
export const withDrinks = (items: readonly unknown[]): DrinksState => ({
  drinks: items.filter(isDrink).sort(drinkOrder),
});

/** Settings from sync: the ones that look right, once each, in a fixed order. */
export const withSettings = (items: readonly unknown[]): SettingsState => ({
  settings: SETTING_IDS.flatMap((id) => {
    const item = items.find(
      (entry): entry is Setting => isSetting(entry) && (entry as Setting).id === id,
    );
    return item ? [item] : [];
  }),
});

// ---------- Settings ----------

function find<T extends Setting['id']>(
  state: SettingsState,
  id: T,
): Extract<Setting, { id: T }> | undefined {
  return state.settings.find((setting) => setting.id === id) as
    Extract<Setting, { id: T }> | undefined;
}

const withSetting = (state: SettingsState, setting: Setting): SettingsState =>
  withSettings([...state.settings.filter((item) => item.id !== setting.id), setting]);

export const unitOf = (state: SettingsState): Unit => find(state, 'unit')?.unit ?? 'ml';

/** The goal or a size, in millilitres. */
export const amountOf = (state: SettingsState, amount: Amount): number =>
  find(state, amount)?.ml ?? DEFAULTS[unitOf(state)][amount];

export function remindersOf(state: SettingsState): Reminders {
  const saved = find(state, 'reminders');
  if (!saved) return { ...DEFAULT_REMINDERS };
  const { on, every, from, until } = saved;
  return { on, every, from, until };
}

export const setUnit = (state: SettingsState, unit: Unit): SettingsState =>
  UNITS.includes(unit) ? withSetting(state, { id: 'unit', unit }) : state;

/** Sets the goal or a size. Returns the same state if it isn't a valid amount. */
export const setAmount = (state: SettingsState, amount: Amount, ml: number): SettingsState =>
  isAmount(ml) ? withSetting(state, { id: amount, ml }) : state;

/** Sets the reminders. Returns the same state if they aren't valid. */
export function setReminders(state: SettingsState, reminders: Reminders): SettingsState {
  const setting = { id: 'reminders' as const, ...reminders };
  return isSetting(setting) && reminders.from <= reminders.until
    ? withSetting(state, setting)
    : state;
}

// ---------- Amounts for people ----------

/** "1,250 ml" or "42.3 fl oz". */
export function formatAmount(ml: number, unit: Unit, locale?: string): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 'ml' ? 0 : 1,
  }).format(inUnit(ml, unit));
  return `${number} ${UNIT_LABELS[unit]}`;
}

/**
 * What's wrong with a typed amount, in the units shown, or undefined when
 * it's fine. `kind` is a drink (or a glass or bottle size), or the daily goal.
 */
export function amountProblem(
  typed: string,
  unit: Unit,
  kind: 'drink' | 'goal',
  locale?: string,
): string | undefined {
  const value = Number(typed.trim());
  if (typed.trim() === '' || !Number.isFinite(value)) {
    return kind === 'goal' ? 'Enter a daily goal.' : 'Enter an amount.';
  }
  const [min, max] = LIMITS[unit][kind];
  const shown = (amount: number) =>
    `${new Intl.NumberFormat(locale).format(amount)} ${UNIT_LABELS[unit]}`;
  if (value < min) return `Enter at least ${shown(min)}.`;
  if (value > max) return `Enter at most ${shown(max)}.`;
  return undefined;
}

/** A typed amount (already checked with amountProblem), in millilitres. */
export const typedMl = (typed: string, unit: Unit): number => toMl(Number(typed.trim()), unit);

// ---------- Drinks ----------

/** A problem with adding a drink on a day, or undefined when it's fine. */
export const drinkProblem = (state: DrinksState, date: IsoDate): string | undefined =>
  drinksOn(state, date).length >= MAX_DRINKS_PER_DAY
    ? `You can log up to ${MAX_DRINKS_PER_DAY} drinks a day.`
    : undefined;

export const addDrink = (state: DrinksState, drink: Drink): DrinksState =>
  isDrink(drink) && !drinkProblem(state, drink.date)
    ? { drinks: [...state.drinks, drink].sort(drinkOrder) }
    : state;

export const removeDrink = (state: DrinksState, id: string): DrinksState => ({
  drinks: state.drinks.filter((drink) => drink.id !== id),
});

/** Lets go of drinks older than KEEP_DAYS. Returns the same state if there are none. */
export function pruneDrinks(state: DrinksState, today: IsoDate): DrinksState {
  const first = addDays(today, -(KEEP_DAYS - 1));
  const kept = state.drinks.filter((drink) => drink.date >= first);
  return kept.length === state.drinks.length ? state : { drinks: kept };
}

/** A day's drinks, latest first (at the same minute, the one added last first). */
export const drinksOn = (state: DrinksState, date: IsoDate): Drink[] =>
  state.drinks
    .filter((drink) => drink.date === date)
    .sort(drinkOrder)
    .reverse();

export const totalOn = (state: DrinksState, date: IsoDate): number =>
  state.drinks.reduce((sum, drink) => (drink.date === date ? sum + drink.ml : sum), 0);

/**
 * Whether `total` reaches `goal`, as the person sees them. In ounces each
 * drink is rounded to whole millilitres, so four 16 fl oz bottles (1,892 ml)
 * must still reach a 64 fl oz goal (1,893 ml).
 */
export const goalReached = (total: number, goal: number, unit: Unit = 'ml'): boolean =>
  inUnit(total, unit) >= inUnit(goal, unit);

/** "750 ml to go." or "Goal reached. Well done!" */
export const progressText = (total: number, goal: number, unit: Unit, locale?: string): string =>
  goalReached(total, goal, unit)
    ? 'Goal reached. Well done!'
    : `${formatAmount(goal - total, unit, locale)} to go.`;

// ---------- History ----------

export interface DayTotal {
  date: IsoDate;
  ml: number;
  reached: boolean;
}

/** The last `count` days, today first. */
export function recentDays(
  state: DrinksState,
  goal: number,
  today: IsoDate,
  count = 7,
  unit: Unit = 'ml',
): DayTotal[] {
  const totals = totalsByDay(state);
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, -index);
    const ml = totals.get(date) ?? 0;
    return { date, ml, reached: goalReached(ml, goal, unit) };
  });
}

function totalsByDay(state: DrinksState): Map<IsoDate, number> {
  const totals = new Map<IsoDate, number>();
  for (const drink of state.drinks)
    totals.set(drink.date, (totals.get(drink.date) ?? 0) + drink.ml);
  return totals;
}

/**
 * Days in a row the goal was reached, up to today. Today counts once it's
 * reached, but doesn't break the streak while the day isn't over.
 */
export function streak(
  state: DrinksState,
  goal: number,
  today: IsoDate,
  unit: Unit = 'ml',
): number {
  const totals = totalsByDay(state);
  const reached = (date: IsoDate) => goalReached(totals.get(date) ?? 0, goal, unit);
  let day = reached(today) ? today : addDays(today, -1);
  let count = 0;
  while (count < KEEP_DAYS && reached(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/** "Goal reached 3 days in a row." or "" before the first day. */
export function streakText(days: number): string {
  if (days === 0) return '';
  return days === 1 ? 'Goal reached 1 day in a row.' : `Goal reached ${days} days in a row.`;
}

/** The average a day over some days, in millilitres. */
export const averageOf = (days: readonly DayTotal[]): number =>
  days.length === 0 ? 0 : Math.round(days.reduce((sum, day) => sum + day.ml, 0) / days.length);

// ---------- Reminders ----------

/** The times of day reminders go off: from `from`, every `every` minutes, up to `until`. */
export function reminderTimes(reminders: Reminders): IsoTime[] {
  const times: IsoTime[] = [];
  let time: IsoTime | null = reminders.from;
  while (time !== null && time <= reminders.until) {
    times.push(time);
    time = shiftTime(time, reminders.every);
  }
  return times;
}

/** "Every 2 hours", "Every 1½ hours", "Every 30 minutes". */
export function everyLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  if (hours === 1) return 'Every hour';
  const whole = Math.floor(hours);
  const shown = hours === whole ? String(whole) : `${whole}½`;
  return `Every ${shown} hours`;
}

/** What a reminder says (the same every time it's sent). */
export const REMINDER_TITLE = 'Time for some water';
export const REMINDER_BODY = 'Tap to log a drink.';
/** Reminders replace each other: only the latest shows. */
export const REMINDER_TAG = 'drink';

/**
 * The reminders, for the notification service (@shkriuss/push): one a day at
 * each reminder time. Once today's goal is reached, they start tomorrow.
 */
export function reminderNotices(
  drinks: DrinksState,
  settings: SettingsState,
  today: IsoDate,
): Notice[] {
  const reminders = remindersOf(settings);
  if (!reminders.on) return [];
  const reached = goalReached(totalOn(drinks, today), amountOf(settings, 'goal'), unitOf(settings));
  const date = reached ? addDays(today, 1) : today;
  return reminderTimes(reminders).map((time) => ({
    id: `drink~${time}`,
    start: toStamp(date, time),
    repeat: 'daily',
    until: null,
    offset: 0,
    title: REMINDER_TITLE,
    body: REMINDER_BODY,
    tag: REMINDER_TAG,
    url: '/',
  }));
}

/**
 * Whether a reminder went off after `from` and up to `to` (local times, the
 * same day as `to`): reminders are on and that day's goal isn't reached yet.
 */
export function reminderDue(
  drinks: DrinksState,
  settings: SettingsState,
  from: Stamp,
  to: Stamp,
): boolean {
  const reminders = remindersOf(settings);
  const date = to.slice(0, 10);
  const goal = amountOf(settings, 'goal');
  if (!reminders.on || goalReached(totalOn(drinks, date), goal, unitOf(settings))) return false;
  return reminderTimes(reminders).some((time) => {
    const due = toStamp(date, time);
    return from < due && due <= to;
  });
}

// ---------- Dates and times for people ----------

/** "Today", "Yesterday", or a date like "Monday 19 October". */
export function dayLabel(date: IsoDate, today: IsoDate, locale = DATE_LOCALE): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

/** A time of day for people: "8:00 PM", or "20:00" where that's how times are written. */
export function timeLabel(time: IsoTime, locale = DATE_LOCALE): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, 1, hour, minute));
}
