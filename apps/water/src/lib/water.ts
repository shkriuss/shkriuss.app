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
import { defineSettings, type SettingsState as SavedSettings } from '@shkriuss/storage/settings';

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

/** The drinks' data version. */
export const DRINKS_VERSION = 1;

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

export type SettingsState = SavedSettings<Setting>;

/** The settings' data version. */
export const SETTINGS_VERSION = 1;

/** A US fluid ounce. */
export const ML_PER_OZ = 29.5735;

export const toMl = (amount: number, unit: Unit): number =>
  Math.round(unit === 'ml' ? amount : amount * ML_PER_OZ);

/** An amount counted in the smallest step shown: whole millilitres, or tenths of an ounce. */
const steps = (ml: number, unit: Unit): number =>
  Math.round(unit === 'ml' ? ml : (ml / ML_PER_OZ) * 10);
const STEPS_PER_UNIT: Record<Unit, number> = { ml: 1, oz: 10 };

/** An amount in the units shown: whole millilitres, or ounces to one decimal. */
export const inUnit = (ml: number, unit: Unit): number => steps(ml, unit) / STEPS_PER_UNIT[unit];

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

/** Water's settings, saved only once changed (@shkriuss/storage/settings). */
const SETTINGS = defineSettings<Setting>(
  ['unit', 'goal', 'glass', 'bottle', 'reminders'],
  isSetting,
);

export const emptySettings = SETTINGS.empty;
export const isSettingsState = SETTINGS.isState;

/** Oldest first. Drinks at the same minute keep their order (the one added last, last). */
const drinkOrder = (a: Drink, b: Drink): number =>
  toStamp(a.date, a.time).localeCompare(toStamp(b.date, b.time));

/** Drinks from sync: the ones that look right, oldest first. */
export const withDrinks = (items: readonly unknown[]): DrinksState => ({
  drinks: items.filter(isDrink).sort(drinkOrder),
});

/** Settings from sync: the ones that look right, once each, in a fixed order. */
export const withSettings = SETTINGS.fromItems;

// ---------- Settings ----------

export const unitOf = (state: SettingsState): Unit => SETTINGS.get(state, 'unit')?.unit ?? 'ml';

/** The goal or a size, in millilitres. */
export const amountOf = (state: SettingsState, amount: Amount): number =>
  SETTINGS.get(state, amount)?.ml ?? DEFAULTS[unitOf(state)][amount];

export function remindersOf(state: SettingsState): Reminders {
  const saved = SETTINGS.get(state, 'reminders');
  if (!saved) return { ...DEFAULT_REMINDERS };
  const { on, every, from, until } = saved;
  return { on, every, from, until };
}

export const setUnit = (state: SettingsState, unit: Unit): SettingsState =>
  SETTINGS.set(state, { id: 'unit', unit });

/** Sets the goal or a size. Returns the same state if it isn't a valid amount. */
export const setAmount = (state: SettingsState, amount: Amount, ml: number): SettingsState =>
  SETTINGS.set(state, { id: amount, ml });

/** Sets the reminders. Returns the same state if they aren't valid. */
export const setReminders = (state: SettingsState, reminders: Reminders): SettingsState =>
  reminders.from <= reminders.until
    ? SETTINGS.set(state, { id: 'reminders', ...reminders })
    : state;

// ---------- Amounts for people ----------

/** An amount already in the units shown, for people: "1,250 ml" or "42.3 fl oz". */
function formatInUnit(amount: number, unit: Unit, locale?: string): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 'ml' ? 0 : 1,
  }).format(amount);
  return `${number} ${UNIT_LABELS[unit]}`;
}

/** "1,250 ml" or "42.3 fl oz". */
export const formatAmount = (ml: number, unit: Unit, locale?: string): string =>
  formatInUnit(inUnit(ml, unit), unit, locale);

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

/**
 * A drink as it's shown, in millilitres. In ounces each drink shows to a
 * tenth of an ounce, as it was typed (or as the glass or bottle size), but
 * is saved rounded to whole millilitres, and that adds up: five 20 fl oz
 * bottles are saved as 2,955 ml, while 100 fl oz is 2,957 ml. Adding up the
 * drinks as shown, five 20 fl oz bottles make 100 fl oz (audit F1-1).
 */
const asShown = (ml: number, unit: Unit): number =>
  unit === 'ml' ? ml : (steps(ml, unit) / STEPS_PER_UNIT[unit]) * ML_PER_OZ;

/**
 * What was drunk on a day, in millilitres: its drinks added up as they're
 * shown in `unit` (see asShown), so the total is what the list adds up to.
 */
export const totalOn = (state: DrinksState, date: IsoDate, unit: Unit = 'ml'): number =>
  state.drinks.reduce(
    (sum, drink) => (drink.date === date ? sum + asShown(drink.ml, unit) : sum),
    0,
  );

/**
 * Whether `total` (from totalOn) reaches `goal`, as the person sees them: to
 * the millilitre, or to a tenth of an ounce. The same rule decides "Goal
 * reached", the streak, the history and the reminders.
 */
export const goalReached = (total: number, goal: number, unit: Unit = 'ml'): boolean =>
  steps(total, unit) >= steps(goal, unit);

/** "750 ml to go." or "Goal reached. Well done!" */
export function progressText(total: number, goal: number, unit: Unit, locale?: string): string {
  if (goalReached(total, goal, unit)) return 'Goal reached. Well done!';
  // The goal less what was drunk, as both are shown: never 0 while it isn't
  // reached.
  const left = (steps(goal, unit) - steps(total, unit)) / STEPS_PER_UNIT[unit];
  return `${formatInUnit(left, unit, locale)} to go.`;
}

// ---------- History ----------

export interface DayTotal {
  date: IsoDate;
  /** What was drunk, as in totalOn. */
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
  const totals = totalsByDay(state, unit);
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, -index);
    const ml = totals.get(date) ?? 0;
    return { date, ml, reached: goalReached(ml, goal, unit) };
  });
}

/** Each day's total, as in totalOn. */
function totalsByDay(state: DrinksState, unit: Unit): Map<IsoDate, number> {
  const totals = new Map<IsoDate, number>();
  for (const drink of state.drinks)
    totals.set(drink.date, (totals.get(drink.date) ?? 0) + asShown(drink.ml, unit));
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
  const totals = totalsByDay(state, unit);
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
  const unit = unitOf(settings);
  const reached = goalReached(totalOn(drinks, today, unit), amountOf(settings, 'goal'), unit);
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
  const unit = unitOf(settings);
  if (!reminders.on || goalReached(totalOn(drinks, date, unit), goal, unit)) return false;
  return reminderTimes(reminders).some((time) => {
    const due = toStamp(date, time);
    return from < due && due <= to;
  });
}

// ---------- Dates and times for people ----------

// "Today", "Yesterday" or "Monday 19 October", and "8:00 PM" or "20:00",
// as in the other apps.
export { dayLabel, timeLabel } from '@shkriuss/ui/locale';
