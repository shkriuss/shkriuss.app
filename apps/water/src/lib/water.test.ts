import { describe, expect, it } from 'vitest';
import {
  addDrink,
  amountOf,
  amountProblem,
  averageOf,
  dayLabel,
  DEFAULT_REMINDERS,
  DEFAULTS,
  drinkProblem,
  drinksOn,
  emptyDrinks,
  emptySettings,
  everyLabel,
  formatAmount,
  goalReached,
  inUnit,
  isDrinksState,
  isSettingsState,
  KEEP_DAYS,
  MAX_DRINKS_PER_DAY,
  progressText,
  pruneDrinks,
  recentDays,
  REMINDER_BODY,
  REMINDER_TITLE,
  reminderDue,
  reminderNotices,
  remindersOf,
  reminderTimes,
  removeDrink,
  setAmount,
  setReminders,
  setUnit,
  streak,
  streakText,
  timeLabel,
  toMl,
  totalOn,
  typedMl,
  unitOf,
  withDrinks,
  withSettings,
  type Drink,
  type DrinksState,
} from './water.ts';

const TODAY = '2026-10-21';
const drink = (date: string, time: string, ml: number, id = `${date}~${time}`): Drink => ({
  id,
  date,
  time,
  ml,
});
const log = (...drinks: Drink[]): DrinksState => ({ drinks });

describe('units', () => {
  it('turns ounces into millilitres and back', () => {
    expect(toMl(250, 'ml')).toBe(250);
    expect(toMl(8, 'oz')).toBe(237);
    expect(toMl(64, 'oz')).toBe(1893);
    expect(inUnit(237, 'oz')).toBe(8);
    expect(inUnit(250, 'oz')).toBe(8.5);
    expect(inUnit(1893, 'oz')).toBe(64);
    expect(typedMl('12.5', 'oz')).toBe(370);
  });

  it('formats amounts', () => {
    expect(formatAmount(1250, 'ml', 'en-US')).toBe('1,250 ml');
    expect(formatAmount(250, 'oz', 'en-US')).toBe('8.5 fl oz');
    expect(formatAmount(1893, 'oz', 'en-US')).toBe('64 fl oz');
  });

  it('checks typed amounts in the units shown', () => {
    expect(amountProblem('', 'ml', 'drink')).toBe('Enter an amount.');
    expect(amountProblem('abc', 'ml', 'goal')).toBe('Enter a daily goal.');
    expect(amountProblem('5', 'ml', 'drink', 'en-US')).toBe('Enter at least 10 ml.');
    expect(amountProblem('3001', 'ml', 'drink', 'en-US')).toBe('Enter at most 3,000 ml.');
    expect(amountProblem('300', 'ml', 'goal', 'en-US')).toBe('Enter at least 500 ml.');
    expect(amountProblem('0.4', 'oz', 'drink', 'en-US')).toBe('Enter at least 0.5 fl oz.');
    expect(amountProblem('250', 'ml', 'drink')).toBeUndefined();
    expect(amountProblem(' 64 ', 'oz', 'goal')).toBeUndefined();
  });
});

describe('settings', () => {
  it('uses the defaults for the units until changed', () => {
    const state = emptySettings();
    expect(unitOf(state)).toBe('ml');
    expect(amountOf(state, 'goal')).toBe(2000);
    expect(amountOf(state, 'glass')).toBe(250);
    expect(remindersOf(state)).toEqual(DEFAULT_REMINDERS);

    const ounces = setUnit(state, 'oz');
    expect(amountOf(ounces, 'goal')).toBe(DEFAULTS.oz.goal);
    expect(amountOf(ounces, 'bottle')).toBe(toMl(16, 'oz'));
    // A goal that was set stays as it is.
    expect(amountOf(setUnit(setAmount(state, 'goal', 2500), 'oz'), 'goal')).toBe(2500);
  });

  it('saves only what was changed, once each, in the same order', () => {
    let state = setAmount(emptySettings(), 'bottle', 750);
    state = setUnit(state, 'oz');
    state = setAmount(state, 'bottle', 700);
    expect(state.settings).toEqual([
      { id: 'unit', unit: 'oz' },
      { id: 'bottle', ml: 700 },
    ]);
    expect(setAmount(state, 'goal', 0)).toBe(state);
    expect(setAmount(state, 'goal', 1.5)).toBe(state);
  });

  it('sets reminders, keeping only valid ones', () => {
    const reminders = { on: true, every: 60, from: '08:00', until: '20:00' };
    const state = setReminders(emptySettings(), reminders);
    expect(remindersOf(state)).toEqual(reminders);
    expect(setReminders(state, { ...reminders, every: 45 })).toBe(state);
    expect(setReminders(state, { ...reminders, from: '21:00' })).toBe(state);
    expect(setReminders(state, { ...reminders, until: '25:00' })).toBe(state);
  });

  it('takes settings from sync that look right', () => {
    expect(
      withSettings([
        { id: 'reminders', ...DEFAULT_REMINDERS, on: true },
        { id: 'goal', ml: 1800 },
        { id: 'goal', ml: -1 },
        { id: 'unit', unit: 'gallons' },
        { id: 'other' },
        null,
      ]).settings,
    ).toEqual([
      { id: 'goal', ml: 1800 },
      { id: 'reminders', ...DEFAULT_REMINDERS, on: true },
    ]);
  });

  it('checks saved settings', () => {
    expect(isSettingsState({ settings: [{ id: 'unit', unit: 'oz' }] })).toBe(true);
    expect(isSettingsState({ settings: [{ id: 'glass', ml: '250' }] })).toBe(false);
    expect(isSettingsState({ settings: {} })).toBe(false);
    expect(isSettingsState(null)).toBe(false);
  });
});

describe('drinks', () => {
  it('adds and removes drinks, kept oldest first', () => {
    let state = addDrink(emptyDrinks(), drink(TODAY, '12:00', 500, 'b'));
    state = addDrink(state, drink(TODAY, '08:30', 250, 'a'));
    state = addDrink(state, drink('2026-10-20', '21:00', 300, 'c'));
    expect(state.drinks.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(drinksOn(state, TODAY).map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(totalOn(state, TODAY)).toBe(750);
    expect(totalOn(state, '2026-10-19')).toBe(0);
    expect(removeDrink(state, 'b').drinks.map((entry) => entry.id)).toEqual(['c', 'a']);
  });

  it('shows drinks at the same minute latest added first', () => {
    let state = addDrink(emptyDrinks(), drink(TODAY, '10:00', 250, 'z'));
    state = addDrink(state, drink(TODAY, '10:00', 500, 'a'));
    expect(drinksOn(state, TODAY).map((entry) => entry.id)).toEqual(['a', 'z']);
  });

  it(`allows up to ${MAX_DRINKS_PER_DAY} drinks a day`, () => {
    let state = emptyDrinks();
    for (let index = 0; index < MAX_DRINKS_PER_DAY; index += 1) {
      state = addDrink(state, drink(TODAY, '09:00', 100, `d${index}`));
    }
    expect(drinkProblem(state, TODAY)).toBe(
      `You can log up to ${MAX_DRINKS_PER_DAY} drinks a day.`,
    );
    expect(addDrink(state, drink(TODAY, '10:00', 100, 'more'))).toBe(state);
    expect(drinkProblem(state, '2026-10-22')).toBeUndefined();
  });

  it('doesn’t add a drink that doesn’t look right', () => {
    const state = emptyDrinks();
    expect(addDrink(state, drink(TODAY, '9:00', 250))).toBe(state);
    expect(addDrink(state, drink(TODAY, '09:00', 0))).toBe(state);
  });

  it(`keeps drinks for ${KEEP_DAYS} days`, () => {
    const state = log(drink('2025-10-20', '09:00', 250), drink('2025-10-21', '09:00', 250));
    expect(pruneDrinks(state, TODAY).drinks.map((entry) => entry.date)).toEqual(['2025-10-21']);
    const kept = log(drink(TODAY, '09:00', 250));
    expect(pruneDrinks(kept, TODAY)).toBe(kept);
  });

  it('takes drinks from sync that look right', () => {
    expect(
      withDrinks([drink(TODAY, '10:00', 250, 'b'), { id: 'x' }, drink(TODAY, '09:00', 250, 'a')])
        .drinks,
    ).toEqual([drink(TODAY, '09:00', 250, 'a'), drink(TODAY, '10:00', 250, 'b')]);
  });

  it('checks saved drinks', () => {
    expect(isDrinksState(log(drink(TODAY, '09:00', 250)))).toBe(true);
    expect(isDrinksState({ drinks: [{ ...drink(TODAY, '09:00', 250), date: 'today' }] })).toBe(
      false,
    );
    expect(isDrinksState({})).toBe(false);
  });

  it('says how much is left', () => {
    expect(progressText(1250, 2000, 'ml', 'en-US')).toBe('750 ml to go.');
    expect(progressText(2000, 2000, 'ml')).toBe('Goal reached. Well done!');
  });
});

describe('history', () => {
  const state = log(
    drink(TODAY, '09:00', 500),
    drink('2026-10-20', '09:00', 2000),
    drink('2026-10-19', '09:00', 1000),
    drink('2026-10-19', '18:00', 1200),
    drink('2026-10-17', '09:00', 2500),
  );

  it('shows the last days, today first', () => {
    expect(recentDays(state, 2000, TODAY, 5)).toEqual([
      { date: TODAY, ml: 500, reached: false },
      { date: '2026-10-20', ml: 2000, reached: true },
      { date: '2026-10-19', ml: 2200, reached: true },
      { date: '2026-10-18', ml: 0, reached: false },
      { date: '2026-10-17', ml: 2500, reached: true },
    ]);
    expect(averageOf(recentDays(state, 2000, TODAY, 5))).toBe(1440);
    expect(averageOf([])).toBe(0);
  });

  it('reaches a goal in ounces with drinks that add up to it', () => {
    // Four 16 fl oz bottles are 1,892 ml; 64 fl oz is 1,893 ml.
    const goal = toMl(64, 'oz');
    const bottles = [1, 2, 3, 4].reduce(
      (all, hour) => addDrink(all, drink(TODAY, `1${hour}:00`, toMl(16, 'oz'))),
      emptyDrinks(),
    );
    const total = totalOn(bottles, TODAY);
    expect(total).toBeLessThan(goal);
    expect(goalReached(total, goal, 'oz')).toBe(true);
    expect(progressText(total, goal, 'oz')).toBe('Goal reached. Well done!');
    expect(streak(bottles, goal, TODAY, 'oz')).toBe(1);
    expect(recentDays(bottles, goal, TODAY, 1, 'oz')[0]?.reached).toBe(true);
    // In millilitres, a millilitre short is short.
    expect(goalReached(1999, 2000, 'ml')).toBe(false);
  });

  it('counts days in a row the goal was reached', () => {
    // Today isn't over: the streak goes on from yesterday.
    expect(streak(state, 2000, TODAY)).toBe(2);
    // Reached today too.
    const more = addDrink(state, drink(TODAY, '12:00', 1500));
    expect(streak(more, 2000, TODAY)).toBe(3);
    // Missed yesterday.
    expect(streak(state, 2000, '2026-10-22')).toBe(0);
    expect(streakText(0)).toBe('');
    expect(streakText(1)).toBe('Goal reached 1 day in a row.');
    expect(streakText(3)).toBe('Goal reached 3 days in a row.');
  });
});

describe('reminders', () => {
  const on = { on: true, every: 120, from: '09:00', until: '21:00' };

  it('go off from the first time, every so often, up to the last', () => {
    expect(reminderTimes(on)).toEqual([
      '09:00',
      '11:00',
      '13:00',
      '15:00',
      '17:00',
      '19:00',
      '21:00',
    ]);
    expect(reminderTimes({ ...on, every: 90, until: '13:00' })).toEqual([
      '09:00',
      '10:30',
      '12:00',
    ]);
    expect(reminderTimes({ ...on, every: 240, from: '22:00', until: '23:59' })).toEqual(['22:00']);
  });

  it('are named for people', () => {
    expect(everyLabel(30)).toBe('Every 30 minutes');
    expect(everyLabel(60)).toBe('Every hour');
    expect(everyLabel(90)).toBe('Every 1½ hours');
    expect(everyLabel(120)).toBe('Every 2 hours');
  });

  it('go to the notification service daily, from tomorrow once the goal is reached', () => {
    const settings = setReminders(emptySettings(), { ...on, every: 240, until: '17:00' });
    expect(reminderNotices(emptyDrinks(), emptySettings(), TODAY)).toEqual([]);
    const notices = reminderNotices(log(drink(TODAY, '08:00', 500)), settings, TODAY);
    expect(notices).toEqual([
      {
        id: 'drink~09:00',
        start: '2026-10-21T09:00',
        repeat: 'daily',
        until: null,
        offset: 0,
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        tag: 'drink',
        url: '/',
      },
      expect.objectContaining({ id: 'drink~13:00', start: '2026-10-21T13:00' }),
      expect.objectContaining({ id: 'drink~17:00', start: '2026-10-21T17:00' }),
    ]);
    const done = reminderNotices(log(drink(TODAY, '08:00', 2000)), settings, TODAY);
    expect(done.map((notice) => notice.start)).toEqual([
      '2026-10-22T09:00',
      '2026-10-22T13:00',
      '2026-10-22T17:00',
    ]);
  });

  it('are due while the app is open, unless the goal is reached', () => {
    const settings = setReminders(emptySettings(), on);
    const none = emptyDrinks();
    expect(reminderDue(none, settings, '2026-10-21T10:55', '2026-10-21T11:00')).toBe(true);
    expect(reminderDue(none, settings, '2026-10-21T11:00', '2026-10-21T11:05')).toBe(false);
    // From the evening before.
    expect(reminderDue(none, settings, '2026-10-20T23:00', '2026-10-21T09:00')).toBe(true);
    const reached = log(drink(TODAY, '10:00', 2000));
    expect(reminderDue(reached, settings, '2026-10-21T10:55', '2026-10-21T11:00')).toBe(false);
    expect(reminderDue(none, emptySettings(), '2026-10-21T10:55', '2026-10-21T11:00')).toBe(false);
  });
});

describe('labels', () => {
  it('names days and times', () => {
    expect(dayLabel(TODAY, TODAY)).toBe('Today');
    expect(dayLabel('2026-10-20', TODAY)).toBe('Yesterday');
    expect(dayLabel('2026-10-19', TODAY, 'en-GB')).toBe('Monday 19 October');
    expect(timeLabel('20:00', 'en-US')).toMatch(/^8:00\sPM$/);
    expect(timeLabel('20:00', 'en-GB')).toBe('20:00');
  });
});
