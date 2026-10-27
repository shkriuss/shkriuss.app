import { addDays, daysBetween } from '@shkriuss/dates';
import { footprint } from '@shkriuss/sync/testing';
import { describe, expect, it } from 'vitest';
import { MAX_SEALED_CHARS } from '../../../../packages/sync/src/validate.ts';
import {
  addHabit,
  bestStreak,
  checkId,
  checksCount,
  checksProblem,
  checkYears,
  currentStreak,
  dayLabel,
  doneDates,
  draftOf,
  dueReminders,
  editHabit,
  emptyChecks,
  emptyHabits,
  EVERY_DAY,
  isChecksState,
  isHabitsState,
  MAX_CHECKS,
  MAX_HABITS,
  MAX_NAME_LENGTH,
  nameError,
  recentDays,
  REMINDER_BODY,
  reminderNotices,
  removeHabit,
  removeYear,
  roomNote,
  scheduleLabel,
  setDone,
  streakLabel,
  timeLabel,
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
    // A name as long as its box lets in on an iPhone, which counts an emoji
    // or a flag once: fine, where it was refused as too long (audit 5 F1-5).
    expect(nameError('🏃'.repeat(MAX_NAME_LENGTH), state)).toBeUndefined();
    expect(nameError('🇬🇪'.repeat(MAX_NAME_LENGTH), state)).toBeUndefined();
    expect(nameError('🏃'.repeat(MAX_NAME_LENGTH + 1), state)).toMatch(/characters or fewer/);
    expect(isHabitsState(addHabit(state, '🏃'.repeat(MAX_NAME_LENGTH), 'b'))).toBe(true);
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

  it('counts a name with other accents or spaces as the same name, as the other apps do', () => {
    // Only toLowerCase() made "Café" and "Cafe" two habits (audit 3 J-12).
    const state = { habits: [{ ...daily, id: 'cafe', name: 'Café with Ana' }] };
    const taken = 'You already have a habit with that name.';
    expect(nameError('cafe with ana', state)).toBe(taken);
    expect(nameError('  CAFÉ  with   Ana ', state)).toBe(taken);
    expect(nameError('Café with Ana', state, 'cafe')).toBeUndefined();
    expect(nameError('Cafés with Ana', state)).toBeUndefined();
    // Hindi's vowel signs are letters, not accents: these are two words.
    expect(nameError('चना', { habits: [{ ...daily, name: 'चीनी' }] })).toBeUndefined();
  });

  it('keeps a habit’s own name, even when another has the same one (audit 4 F3-6)', () => {
    // Saved before wide and narrow letters were folded, "Run 5km" and
    // "Run ５km" were two names; now they're one. Changing either one's
    // days said "You already have a habit with that name."
    const state = {
      habits: [
        { ...daily, id: 'a', name: 'Run 5km' },
        { ...daily, id: 'b', name: 'Run ５km' },
      ],
    };
    expect(nameError('Run ５km', state, 'b')).toBeUndefined();
    expect(nameError(' run 5KM ', state, 'a')).toBeUndefined();
    expect(updateHabit(state, 'b', { name: 'Run ５km', days: [1, 3] }).habits[1]?.days).toEqual([
      1, 3,
    ]);
    // Saved from its form, as the page does.
    const opened = draftOf({ ...daily, id: 'b', name: 'Run ５km' });
    expect(nameError(opened.name, state, 'b', opened.name)).toBeUndefined();
    expect(editHabit(state, 'b', opened, { ...opened, days: [6, 7] }).habits[1]).toEqual({
      id: 'b',
      name: 'Run ５km',
      days: [6, 7],
    });
    // Another habit's name is still taken.
    const two = { habits: [daily, weekdaysOnly] };
    expect(nameError('RUN', two, 'water')).toBe('You already have a habit with that name.');
    expect(nameError('RUN', two, 'water', 'Water')).toBe(
      'You already have a habit with that name.',
    );
  });

  it('sets, keeps and removes a reminder', () => {
    const state = { habits: [daily] };
    const withReminder = updateHabit(state, 'water', {
      name: 'Water',
      days: EVERY_DAY,
      reminder: '20:00',
    });
    expect(withReminder.habits[0]?.reminder).toBe('20:00');
    // Left out: stays as it was.
    const renamed = updateHabit(withReminder, 'water', { name: 'Drink', days: EVERY_DAY });
    expect(renamed.habits[0]).toEqual({ ...daily, name: 'Drink', reminder: '20:00' });
    expect(
      updateHabit(renamed, 'water', { name: 'Drink', days: EVERY_DAY, reminder: null }).habits[0],
    ).toEqual({ ...daily, name: 'Drink' });
    expect(updateHabit(state, 'water', { name: 'Water', days: EVERY_DAY, reminder: '25:00' })).toBe(
      state,
    );
  });

  // While the edit form is open, a sync (or another tab) may change the habit
  // (audit F1-2): saving puts on only what was changed in the form.
  it('saves the edit form on top of a change made elsewhere meanwhile', () => {
    const opened = draftOf(daily);
    const weekdays = updateHabit({ habits: [daily, weekdaysOnly] }, 'water', {
      name: 'Water',
      days: [1, 2, 3, 4, 5],
      reminder: '08:00',
    });
    const renamed = editHabit(weekdays, 'water', opened, { ...opened, name: 'Drink water' });
    expect(renamed.habits[0]).toEqual({
      id: 'water',
      name: 'Drink water',
      days: [1, 2, 3, 4, 5],
      reminder: '08:00',
    });
    // Where both changed the same thing, the change here wins.
    expect(
      editHabit(weekdays, 'water', opened, { ...opened, days: [6, 7] }).habits[0]?.days,
    ).toEqual([6, 7]);
    // Renamed meanwhile to the other habit's name (on two devices at once,
    // which sync can bring together): the form as it is.
    const clash = { habits: [{ ...daily, name: 'Run' }, weekdaysOnly] };
    const changed = { ...opened, days: [6, 7] };
    expect(editHabit(clash, 'water', opened, changed).habits[0]).toEqual({
      id: 'water',
      name: 'Water',
      days: [6, 7],
    });
    expect(editHabit(weekdays, 'gone', opened, changed)).toBe(weekdays);
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

// Every check mark is kept until the person lets go of a year's (audit F1-5).
describe('making room', () => {
  const checks = [
    ['water', '2024-12-31'],
    ['run', '2025-01-01'],
    ['water', '2025-06-01'],
    ['water', MONDAY],
  ].reduce((state, [habit = '', date = '']) => setDone(state, habit, date, true), emptyChecks());

  it('lists the years with check marks, and deletes one', () => {
    expect(checkYears(checks)).toEqual([
      { year: '2024', count: 1 },
      { year: '2025', count: 2 },
      { year: '2026', count: 1 },
    ]);
    expect(checkYears(emptyChecks())).toEqual([]);
    expect(removeYear(checks, '2025').checks.map((check) => check.date)).toEqual([
      '2024-12-31',
      MONDAY,
    ]);
    expect(removeYear(checks, '2023')).toEqual(checks);
    expect(checksCount(1, 'en-US')).toBe('1 check mark');
    expect(checksCount(3650, 'en-US')).toBe('3,650 check marks');
  });

  it('counts streaks from the check marks kept', () => {
    // Done every day since 20 December 2025.
    let marks = emptyChecks();
    for (let date = '2025-12-20'; date <= MONDAY; date = addDays(date, 1)) {
      marks = setDone(marks, 'water', date, true);
    }
    const since = (date: string) => daysBetween(date, MONDAY) + 1;
    expect(currentStreak(daily, doneDates(marks, 'water'), MONDAY)).toBe(since('2025-12-20'));
    // Without 2025's, it starts on 1 January.
    const kept = doneDates(removeYear(marks, '2025'), 'water');
    expect(currentStreak(daily, kept, MONDAY)).toBe(since('2026-01-01'));
    expect(bestStreak(daily, kept, MONDAY)).toBe(since('2026-01-01'));
  });

  it(`keeps up to ${MAX_CHECKS} check marks, and says so once nearly full`, () => {
    const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
    const many = (count: number): ChecksState => ({
      checks: Array.from({ length: count }, (_, index) => {
        const date = addDays(MONDAY, -index);
        return { id: checkId('water', date), habit: 'water', date };
      }),
    });
    expect(checksProblem(many(MAX_CHECKS - 1))).toBeUndefined();
    expect(checksProblem(many(MAX_CHECKS - 1), 2, 'en-US')).toBe(
      `Habits keeps up to ${number(MAX_CHECKS)} check marks. To make room, delete the check marks from a year (under Check marks).`,
    );
    expect(checksProblem(many(MAX_CHECKS))).toBeDefined();

    const makeRoom =
      'To make room, use “Delete check marks from a year…” under Check marks, below.';
    const nearly = MAX_CHECKS * 0.9;
    expect(roomNote(nearly, 'en-US')).toBeNull();
    expect(roomNote(nearly + 1, 'en-US')).toBe(
      `Habits is nearly full: there’s room for ${number(MAX_CHECKS - nearly - 1)} more check marks (it keeps up to ${number(MAX_CHECKS)}). ${makeRoom}`,
    );
    expect(roomNote(MAX_CHECKS - 1, 'en-US')).toContain('there’s room for 1 more check mark (');
    expect(roomNote(MAX_CHECKS, 'en-US')).toBe(
      `Habits is full: it keeps up to ${number(MAX_CHECKS)} check marks. ${makeRoom}`,
    );
  });

  // Check marks are saved on the device (in localStorage, about 5 MB for each
  // site), and with sync on, also go into the copy that goes online. Sync's
  // own records of them take more room than the check marks themselves.
  it('has room for every check mark, on the device and in the sync copy', async () => {
    const habits = Array.from({ length: MAX_HABITS }, () => crypto.randomUUID());
    const list = Array.from({ length: MAX_CHECKS }, (_, index) => {
      const habit = habits[index % habits.length] ?? '';
      const date = addDays('2016-01-01', Math.floor(index / habits.length));
      return { id: checkId(habit, date), habit, date };
    });
    const size = await footprint({
      app: 'habits',
      store: 'shkriuss:habit-checks',
      version: 1,
      data: { checks: list },
      items: list,
      // A quarter of them deleted ("Delete check marks from a year") less than 180 days ago.
      deleted: MAX_CHECKS / 4,
    });
    expect(size.compressed).toBeLessThan(1_000_000);
    expect(size.sealed).toBeLessThan(MAX_SEALED_CHARS);
    // Safari allows 5 MiB (5,242,880 bytes). Check marks are plain letters,
    // digits and dashes (a habit's id and a date), like sync's own records:
    // 1 byte each. Some room is left for the rest (the habits themselves).
    expect(size.saved + size.syncState).toBeLessThan(4_500_000);
  }, 60_000);
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

describe('reminders', () => {
  const run: Habit = { ...weekdaysOnly, reminder: '07:30' };

  it('schedules one a week for each planned day, from today on', () => {
    const notices = reminderNotices({ habits: [run, daily] }, emptyChecks(), MONDAY);
    expect(notices.map((notice) => [notice.id, notice.start])).toEqual([
      ['run~1', '2026-10-19T07:30'],
      ['run~2', '2026-10-20T07:30'],
      ['run~3', '2026-10-21T07:30'],
      ['run~4', '2026-10-22T07:30'],
      ['run~5', '2026-10-23T07:30'],
    ]);
    expect(notices[0]).toEqual({
      id: 'run~1',
      start: '2026-10-19T07:30',
      repeat: 'weekly',
      until: null,
      offset: 0,
      title: 'Run',
      body: REMINDER_BODY,
      tag: 'run',
      url: '/',
    });
  });

  it('skips today’s once it’s done', () => {
    const checks = setDone(emptyChecks(), 'run', MONDAY, true);
    const notices = reminderNotices({ habits: [run] }, checks, MONDAY);
    expect(notices.find((notice) => notice.id === 'run~1')?.start).toBe('2026-10-26T07:30');
    expect(notices.find((notice) => notice.id === 'run~2')?.start).toBe('2026-10-20T07:30');
  });

  it('finds reminders that are due while Habits is open', () => {
    const habits = { habits: [run, { ...daily, reminder: '07:45' }] };
    const names = (from: string, to: string, checks = emptyChecks()) =>
      dueReminders(habits, checks, from, to).map((habit) => habit.name);
    expect(names('2026-10-19T07:00', '2026-10-19T07:30')).toEqual(['Run']);
    expect(names('2026-10-19T07:30', '2026-10-19T07:44')).toEqual([]);
    expect(names('2026-10-19T07:00', '2026-10-19T08:00')).toEqual(['Run', 'Water']);
    // Done already, or not planned (Sunday): no reminder.
    expect(
      names('2026-10-19T07:00', '2026-10-19T08:00', setDone(emptyChecks(), 'run', MONDAY, true)),
    ).toEqual(['Water']);
    expect(names('2026-10-18T07:00', '2026-10-18T08:00')).toEqual(['Water']);
  });

  it('finds one from just before midnight when the page wakes just after it (audit 4 F1-11)', () => {
    const late = { habits: [{ ...daily, reminder: '23:59' }] };
    const names = (checks = emptyChecks()) =>
      dueReminders(late, checks, '2026-10-19T23:57', '2026-10-20T00:02').map((habit) => habit.name);
    expect(names()).toEqual(['Water']);
    // Done that day: not; done the new day only: still.
    expect(names(setDone(emptyChecks(), 'water', MONDAY, true))).toEqual([]);
    expect(names(setDone(emptyChecks(), 'water', '2026-10-20', true))).toEqual(['Water']);
  });

  it('shows times the local way', () => {
    expect(timeLabel('07:30', 'en-GB')).toBe('7:30');
    expect(timeLabel('20:00', 'en-US')).toMatch(/^8:00\sPM$/);
  });
});

describe('saved data', () => {
  it('accepts what Habits saves', () => {
    expect(isHabitsState({ habits: [daily, { ...weekdaysOnly, reminder: '07:30' }] })).toBe(true);
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
      { habits: [{ ...daily, reminder: '8pm' }] },
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
