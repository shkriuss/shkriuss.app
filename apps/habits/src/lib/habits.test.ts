import { addDays } from '@shkriuss/dates';
import { describe, expect, it } from 'vitest';
import {
  addHabit,
  bestStreak,
  checkId,
  currentStreak,
  dayLabel,
  doneDates,
  emptyChecks,
  emptyHabits,
  EVERY_DAY,
  isChecksState,
  isHabitsState,
  MAX_HABITS,
  MAX_NAME_LENGTH,
  nameError,
  recentDays,
  removeHabit,
  scheduleLabel,
  setDone,
  streakLabel,
  updateHabit,
  weekOrder,
  type ChecksState,
  type Habit,
} from './habits.ts';

// 19 October 2026 is a Monday.
const MONDAY = '2026-10-19';
const daily: Habit = { id: 'water', name: 'Water', days: [...EVERY_DAY] };
const weekdaysOnly: Habit = { id: 'run', name: 'Run', days: [1, 2, 3, 4, 5] };
/** Done on these days before `day` (0 = that day, 1 = the day before …). */
const doneBefore = (day: string, ...offsets: number[]) =>
  new Set(offsets.map((offset) => addDays(day, -offset)));

describe('habits', () => {
  it('adds a habit for every day, refusing bad names', () => {
    let state = addHabit(emptyHabits(), '  Drink water ', 'a');
    expect(state.habits).toEqual([{ id: 'a', name: 'Drink water', days: EVERY_DAY }]);
    expect(addHabit(state, 'drink WATER', 'b')).toBe(state);
    expect(addHabit(state, '   ', 'b')).toBe(state);
    expect(nameError('x'.repeat(MAX_NAME_LENGTH + 1), state)).toMatch(/characters or fewer/);
    const full = {
      habits: Array.from({ length: MAX_HABITS }, (_, index) => ({
        ...daily,
        id: `${index}`,
        name: `${index}`,
      })),
    };
    expect(nameError('One more', full)).toMatch(/up to 50 habits/);
    state = updateHabit(state, 'a', { name: 'Drink water', days: [3, 1, 1] });
    expect(state.habits[0]?.days).toEqual([1, 3]);
  });

  it('renames and changes days, but never to no days or a taken name', () => {
    const state = { habits: [daily, weekdaysOnly] };
    expect(updateHabit(state, 'water', { name: 'Water', days: [] })).toBe(state);
    expect(updateHabit(state, 'water', { name: 'run', days: [1] })).toBe(state);
    expect(updateHabit(state, 'water', { name: 'WATER', days: [6, 7] }).habits[0]).toEqual({
      id: 'water',
      name: 'WATER',
      days: [6, 7],
    });
  });

  it('removes a habit with its check marks', () => {
    let checks: ChecksState = emptyChecks();
    checks = setDone(checks, 'water', MONDAY, true);
    checks = setDone(checks, 'run', MONDAY, true);
    const result = removeHabit({ habits: [daily, weekdaysOnly] }, checks, 'water');
    expect(result.habits.habits).toEqual([weekdaysOnly]);
    expect(result.checks.checks.map((check) => check.habit)).toEqual(['run']);
  });
});

describe('check marks', () => {
  it('marks a day done once, and not done again', () => {
    let checks = setDone(emptyChecks(), 'water', MONDAY, true);
    checks = setDone(checks, 'water', MONDAY, true);
    expect(checks.checks).toEqual([{ id: checkId('water', MONDAY), habit: 'water', date: MONDAY }]);
    expect(doneDates(checks, 'water')).toEqual(new Set([MONDAY]));
    expect(setDone(checks, 'water', MONDAY, false).checks).toEqual([]);
  });

  it('gives the same id on every device, so the same day never conflicts', () => {
    expect(checkId('water', MONDAY)).toBe(checkId('water', MONDAY));
    expect(checkId('water', MONDAY)).not.toBe(checkId('water', addDays(MONDAY, 1)));
  });
});

describe('streaks', () => {
  it('counts planned days done in a row, without breaking while today is still to do', () => {
    expect(currentStreak(daily, doneBefore(MONDAY, 0, 1, 2), MONDAY)).toBe(3);
    expect(currentStreak(daily, doneBefore(MONDAY, 1, 2), MONDAY)).toBe(2);
    expect(currentStreak(daily, doneBefore(MONDAY, 2, 3), MONDAY)).toBe(0);
    expect(currentStreak(daily, new Set(), MONDAY)).toBe(0);
  });

  it('skips days that aren’t planned', () => {
    // Run on weekdays: done Thursday and Friday, the weekend doesn't count.
    expect(currentStreak(weekdaysOnly, doneBefore(MONDAY, 3, 4), MONDAY)).toBe(2);
    expect(currentStreak(weekdaysOnly, doneBefore(MONDAY, 0, 3, 4), MONDAY)).toBe(3);
  });

  it('finds the best streak so far', () => {
    expect(bestStreak(daily, doneBefore(MONDAY, 1, 5, 6, 7, 8), MONDAY)).toBe(4);
    expect(bestStreak(daily, doneBefore(MONDAY, 0, 1), MONDAY)).toBe(2);
    expect(bestStreak(daily, new Set(), MONDAY)).toBe(0);
  });

  it('says it in words', () => {
    expect(streakLabel(3, 3)).toBe('3-day streak');
    expect(streakLabel(1, 7)).toBe('1-day streak · best 7 days');
    expect(streakLabel(0, 1)).toBe('Best streak: 1 day');
    expect(streakLabel(0, 0)).toBe('No streak yet');
  });
});

describe('days', () => {
  it('lists the last days, oldest first', () => {
    const days = recentDays(weekdaysOnly, doneBefore(MONDAY, 0, 3), MONDAY);
    expect(days.map((day) => day.date)).toEqual(
      [6, 5, 4, 3, 2, 1, 0].map((offset) => addDays(MONDAY, -offset)),
    );
    expect(days.map((day) => [day.planned, day.done])).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, true],
      [false, false],
      [false, false],
      [true, true],
    ]);
  });

  it('describes schedules in the week’s order', () => {
    expect(scheduleLabel(EVERY_DAY, 1, 'en-GB')).toBe('Every day');
    expect(scheduleLabel([1, 2, 3, 4, 5], 1, 'en-GB')).toBe('Weekdays');
    expect(scheduleLabel([7, 6], 1, 'en-GB')).toBe('Weekends');
    expect(scheduleLabel([5, 1, 3], 1, 'en-GB')).toBe('Mon, Wed, Fri');
    expect(scheduleLabel([7, 1], 7, 'en-US')).toBe('Sun, Mon');
    expect(weekOrder(7)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });

  it('names days', () => {
    expect(dayLabel(MONDAY, MONDAY)).toBe('Today');
    expect(dayLabel(addDays(MONDAY, -1), MONDAY)).toBe('Yesterday');
    expect(dayLabel(addDays(MONDAY, -3), MONDAY, 'en-GB')).toBe('Friday 16 October');
  });
});

describe('saved data', () => {
  it('accepts what Habits saves', () => {
    expect(isHabitsState({ habits: [daily, weekdaysOnly] })).toBe(true);
    expect(isChecksState(setDone(emptyChecks(), 'water', MONDAY, true))).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      {},
      { habits: [{ ...daily, id: '' }] },
      { habits: [{ ...daily, days: [] }] },
      { habits: [{ ...daily, days: [1, 1] }] },
      { habits: [{ ...daily, days: [0] }] },
      { habits: [{ ...daily, name: 5 }] },
    ]) {
      expect(isHabitsState(value), JSON.stringify(value)).toBe(false);
    }
    for (const value of [
      { checks: [{ id: 'x', habit: 'water', date: MONDAY }] },
      { checks: [{ id: checkId('water', '2026-02-30'), habit: 'water', date: '2026-02-30' }] },
      { checks: {} },
    ]) {
      expect(isChecksState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
