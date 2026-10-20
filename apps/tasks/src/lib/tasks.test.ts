import { describe, expect, it } from 'vitest';
import {
  addTask,
  completeTask,
  doneTasks,
  draftOf,
  draftProblems,
  dueReminders,
  dueText,
  emptyTasks,
  formatDay,
  isTasksState,
  MAX_STEPS,
  MAX_TASKS,
  migrateTasks,
  moveTasks,
  newTask,
  nextDate,
  NO_LIST,
  openGroups,
  openPerList,
  reminderAt,
  reminderNotices,
  REMINDER_BODY,
  removeTask,
  removeTasks,
  reopenTask,
  stepsText,
  taskFromDraft,
  tasksCount,
  tickStep,
  updateTask,
  whenOf,
  type Task,
  type TaskDraft,
  type TasksState,
} from './tasks.ts';

// Tuesday 20 October 2026.
const TODAY = '2026-10-20';

const draft = (changes: Partial<TaskDraft> = {}): TaskDraft => ({
  title: 'Pay rent',
  notes: '',
  steps: [],
  list: NO_LIST,
  important: false,
  date: '',
  time: '',
  repeat: 'none',
  reminder: '',
  ...changes,
});

let clock = 1_000;
const task = (changes: Partial<TaskDraft> = {}, id = `task-${clock}`): Task =>
  taskFromDraft(draft(changes), id, (clock += 1000));
const stateOf = (...tasks: Task[]): TasksState => ({ tasks });
const titles = (tasks: Task[]) => tasks.map((entry) => entry.title);

describe('the form', () => {
  it('explains what to fix', () => {
    expect(draftProblems(draft())).toEqual({});
    expect(draftProblems(draft({ title: '  ' }))).toEqual({ title: 'Give it a title.' });
    expect(draftProblems(draft({ date: '2026-02-30' })).date).toBe(
      'Choose a date, or leave it empty.',
    );
    expect(draftProblems(draft({ date: TODAY, time: '25:00' })).time).toBe(
      'Choose a time, or leave it empty.',
    );
    // A time, a repeat or a reminder needs a date.
    expect(draftProblems(draft({ time: '14:00' })).date).toBe(
      'Choose a date for the time, or clear the time.',
    );
    expect(draftProblems(draft({ repeat: 'weekly' })).date).toBe(
      'Choose the first date, so it can repeat.',
    );
    expect(draftProblems(draft({ reminder: '0' })).date).toBe('Choose a date to be reminded on.');
  });

  it('makes a task from the form, and the form from a task', () => {
    const made = taskFromDraft(
      draft({
        title: '  Pay rent ',
        notes: ' Transfer to the landlord ',
        list: 'home',
        important: true,
        date: '2026-11-01',
        time: '10:00',
        repeat: 'monthly',
        reminder: '60',
      }),
      'a',
      5000,
    );
    expect(made).toEqual({
      id: 'a',
      title: 'Pay rent',
      notes: 'Transfer to the landlord',
      steps: [],
      list: 'home',
      important: true,
      date: '2026-11-01',
      time: '10:00',
      repeat: 'monthly',
      reminder: 60,
      done: null,
      created: 5000,
      updated: 5000,
    });
    expect(taskFromDraft(draftOf(made), 'a', 9000, made)).toEqual({ ...made, updated: 9000 });
    // Changing a done task keeps it done.
    const done = { ...made, done: 7000 };
    expect(taskFromDraft(draftOf(done), 'a', 9000, done).done).toBe(7000);
    // Unknown choices fall back to safe ones.
    const odd = taskFromDraft(draft({ date: TODAY, repeat: 'hourly', reminder: '7' }), 'b', 1);
    expect([odd.repeat, odd.reminder]).toEqual(['none', null]);
  });

  it('keeps the steps written, without empty ones', () => {
    const trip = taskFromDraft(
      draft({
        title: 'Prepare for the trip',
        steps: [
          { id: 's1', title: ' Book the hotel ', done: true },
          { id: 's2', title: '   ', done: false },
          { id: 's3', title: 'Pack', done: false },
        ],
      }),
      't',
      1,
    );
    expect(trip.steps).toEqual([
      { id: 's1', title: 'Book the hotel', done: true },
      { id: 's3', title: 'Pack', done: false },
    ]);
    expect(stepsText(trip)).toBe('1 of 2 steps');
    expect(stepsText({ ...trip, steps: trip.steps.slice(0, 1) })).toBe('1 of 1 step');
    expect(stepsText(task())).toBe('');
    // Up to MAX_STEPS.
    const many = Array.from({ length: MAX_STEPS + 5 }, (_, index) => ({
      id: `s${index}`,
      title: `Step ${index}`,
      done: false,
    }));
    expect(taskFromDraft(draft({ steps: many }), 'm', 1).steps).toHaveLength(MAX_STEPS);
  });

  it('adds a task with just a title', () => {
    expect(newTask(' Call mum ', 'c', 10, { list: 'home', important: true })).toMatchObject({
      title: 'Call mum',
      list: 'home',
      important: true,
      date: null,
      done: null,
    });
  });
});

describe('changes', () => {
  it('adds, changes and removes tasks', () => {
    const rent = task();
    let state = addTask(emptyTasks(), rent);
    const call = task({ title: 'Call mum' });
    state = addTask(state, call);
    state = updateTask(state, { ...rent, important: true });
    expect(state.tasks.find((entry) => entry.id === rent.id)?.important).toBe(true);
    state = removeTask(state, call.id);
    expect(titles(state.tasks)).toEqual(['Pay rent']);
    // Changed after it was deleted on another device: it comes back.
    expect(titles(updateTask(state, call).tasks)).toEqual(['Call mum', 'Pay rent']);
    expect(removeTasks(state, new Set([rent.id])).tasks).toEqual([]);
  });

  it('keeps to the most tasks', () => {
    const full = stateOf(...Array.from({ length: MAX_TASKS }, (_, index) => task({}, `t${index}`)));
    expect(addTask(full, task())).toBe(full);
  });

  it('marks tasks done and not done', () => {
    const rent = task();
    const { state, next } = completeTask(stateOf(rent), rent.id, 5000, TODAY, 'copy');
    expect(next).toBeNull();
    expect(state.tasks).toEqual([{ ...rent, done: 5000, updated: 5000 }]);
    // Twice changes nothing.
    expect(completeTask(state, rent.id, 6000, TODAY, 'copy').state).toBe(state);
    expect(reopenTask(state, rent.id, 7000).tasks).toEqual([{ ...rent, updated: 7000 }]);
  });

  it('ticks steps', () => {
    const trip = task({
      title: 'Prepare for the trip',
      steps: [
        { id: 'hotel', title: 'Book the hotel', done: false },
        { id: 'pack', title: 'Pack', done: false },
      ],
    });
    const state = tickStep(stateOf(trip), trip.id, 'hotel', true, 5000);
    expect(state.tasks[0]).toEqual({
      ...trip,
      steps: [
        { id: 'hotel', title: 'Book the hotel', done: true },
        { id: 'pack', title: 'Pack', done: false },
      ],
      updated: 5000,
    });
    // Nothing to change: the same state.
    expect(tickStep(state, trip.id, 'hotel', true, 6000)).toBe(state);
    expect(tickStep(state, trip.id, 'gone', true, 6000)).toBe(state);
    expect(tickStep(state, trip.id, 'hotel', false, 7000).tasks[0]?.steps[0]?.done).toBe(false);
  });

  it('moves a repeating task on to its next date, keeping a done copy', () => {
    const plants = task({
      title: 'Water plants',
      date: TODAY,
      repeat: 'weekly',
      reminder: '0',
      steps: [{ id: 'balcony', title: 'Balcony', done: true }],
    });
    const { state, next } = completeTask(stateOf(plants), plants.id, 5000, TODAY, 'copy');
    expect(next).toBe('2026-10-27');
    expect(state.tasks).toEqual([
      { ...plants, id: 'copy', repeat: 'none', done: 5000, created: 5000, updated: 5000 },
      // Its steps start again.
      {
        ...plants,
        date: '2026-10-27',
        steps: [{ id: 'balcony', title: 'Balcony', done: false }],
        updated: 5000,
      },
    ]);
  });

  it('works out the next date of each kind of repeat', () => {
    // Due today (Tuesday).
    expect(nextDate(TODAY, 'daily', TODAY)).toBe('2026-10-21');
    expect(nextDate(TODAY, 'weekly', TODAY)).toBe('2026-10-27');
    expect(nextDate(TODAY, 'monthly', TODAY)).toBe('2026-11-20');
    expect(nextDate(TODAY, 'yearly', TODAY)).toBe('2027-10-20');
    // Weekdays skip the weekend.
    expect(nextDate('2026-10-23', 'weekdays', '2026-10-23')).toBe('2026-10-26');
    // Done early: the one after its date.
    expect(nextDate('2026-10-30', 'weekly', TODAY)).toBe('2026-11-06');
    // Done late: the next one after today, not one that's overdue already.
    expect(nextDate('2026-10-01', 'daily', TODAY)).toBe('2026-10-21');
    expect(nextDate('2026-10-06', 'weekly', TODAY)).toBe('2026-10-27');
    expect(nextDate('2025-03-15', 'monthly', TODAY)).toBe('2026-11-15');
    // Month ends: the last day of shorter months.
    expect(nextDate('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextDate('2024-02-29', 'yearly', TODAY)).toBe('2027-02-28');
  });

  it('moves the tasks of a list that goes', () => {
    const rent = task({ list: 'home' });
    const report = task({ list: 'work' });
    const moved = moveTasks(stateOf(rent, report), 'home', NO_LIST);
    expect(moved.tasks.map((entry) => entry.list)).toEqual([NO_LIST, 'work']);
  });

  it('reads tasks saved before there were steps', () => {
    const { steps: _, ...old } = task({ title: 'From version 1' });
    const migrated = migrateTasks({ tasks: [old] }, 1);
    expect(migrated?.tasks).toEqual([{ ...old, steps: [] }]);
    expect(isTasksState(migrated)).toBe(true);
    expect(migrateTasks({ tasks: [old] }, 7)).toBeUndefined();
    expect(migrateTasks({}, 1)).toBeUndefined();
  });

  it('checks saved data', () => {
    expect(isTasksState(stateOf(task({ date: TODAY, time: '09:30', reminder: '10' })))).toBe(true);
    expect(isTasksState({ tasks: [{ ...task(), repeat: 'hourly' }] })).toBe(false);
    expect(isTasksState({ tasks: [{ ...task(), reminder: 7 }] })).toBe(false);
    expect(isTasksState({ tasks: [{ ...task(), date: 'tomorrow' }] })).toBe(false);
    expect(isTasksState({ tasks: [{ ...task(), steps: [{ id: 's', title: 'x' }] }] })).toBe(false);
    expect(isTasksState({})).toBe(false);
  });
});

describe('showing them', () => {
  const overdue = task({ title: 'Renew passport', date: '2026-10-15' });
  const later = task({ title: 'Dentist', date: '2026-11-03', time: '16:00' });
  const today = task({ title: 'Buy bread', date: TODAY, list: 'home' });
  const todayAt = task({ title: 'Team call', date: TODAY, time: '09:00', list: 'work' });
  const star = task({ title: 'Send report', date: TODAY, time: '17:00', important: true });
  const tomorrow = task({ title: 'Gym', date: '2026-10-21' });
  const someday = task({ title: 'Learn guitar' });
  const finished = { ...task({ title: 'Old thing', list: 'home' }), done: 50_000 };
  const state = stateOf(overdue, later, today, todayAt, star, tomorrow, someday, finished);

  it('groups tasks by when they’re due, important ones first', () => {
    const groups = openGroups(state, 'all', TODAY);
    expect(groups.map(({ when, tasks }) => [when, titles(tasks)])).toEqual([
      ['overdue', ['Renew passport']],
      ['today', ['Send report', 'Buy bread', 'Team call']],
      ['tomorrow', ['Gym']],
      ['later', ['Dentist']],
      ['someday', ['Learn guitar']],
    ]);
    expect(whenOf(overdue, TODAY)).toBe('overdue');
  });

  it('shows the important ones, or one list’s', () => {
    const shown = (view: Parameters<typeof openGroups>[1]) =>
      openGroups(state, view, TODAY).flatMap((group) => titles(group.tasks));
    expect(shown('important')).toEqual(['Send report']);
    expect(shown({ list: 'home' })).toEqual(['Buy bread']);
    expect(titles(doneTasks(state, { list: 'home' }))).toEqual(['Old thing']);
    expect(titles(doneTasks(state, { list: 'work' }))).toEqual([]);
    expect(openPerList(state)).toEqual(
      new Map([
        [NO_LIST, 5],
        ['home', 1],
        ['work', 1],
      ]),
    );
  });

  it('lists the most recently done first', () => {
    const first = { ...task({ title: 'First' }), done: 10 };
    const second = { ...task({ title: 'Second' }), done: 20 };
    expect(titles(doneTasks(stateOf(first, second), 'all'))).toEqual(['Second', 'First']);
  });

  it('says when a task is due, in the person’s style', () => {
    expect(formatDay(TODAY, TODAY)).toBe('Today');
    expect(formatDay('2026-10-21', TODAY)).toBe('Tomorrow');
    expect(formatDay('2026-10-19', TODAY)).toBe('Yesterday');
    expect(formatDay('2026-10-23', TODAY, 'en-GB')).toBe('Friday');
    expect(formatDay('2026-11-03', TODAY, 'en-GB')).toBe('Tue 3 Nov');
    expect(formatDay('2027-01-05', TODAY, 'en-GB')).toBe('Tue, 5 Jan 2027');
    expect(dueText(todayAt, TODAY, 'en-GB')).toBe('Today, 9:00');
    expect(dueText(later, TODAY, 'en-US')).toMatch(/^Tue, Nov 3, 4:00\sPM$/);
    expect(dueText(someday, TODAY)).toBe('');
  });

  it('counts tasks', () => {
    expect([tasksCount(0), tasksCount(1), tasksCount(2)]).toEqual(['0 tasks', '1 task', '2 tasks']);
  });
});

describe('reminders', () => {
  const call = task({ title: 'Call the bank', date: TODAY, time: '14:00', reminder: '30' });
  const allDay = task({ title: 'Bin day', date: '2026-10-21', reminder: '0' });
  const dayBefore = task({ title: 'Flight', date: '2026-10-25', time: '07:00', reminder: '1440' });
  const none = task({ title: 'No reminder', date: TODAY, time: '14:00' });
  const done = { ...task({ title: 'Done', date: TODAY, reminder: '0' }), done: 1 };
  const state = stateOf(call, allDay, dayBefore, none, done);

  it('works out when they’re due (9:00 without a time)', () => {
    expect(reminderAt(call)).toBe('2026-10-20T13:30');
    expect(reminderAt(allDay)).toBe('2026-10-21T09:00');
    expect(reminderAt(dayBefore)).toBe('2026-10-24T07:00');
    expect(reminderAt(none)).toBeNull();
  });

  it('finds the ones due now, only for tasks still to do', () => {
    expect(titles(dueReminders(state, '2026-10-20T13:00', '2026-10-20T13:30'))).toEqual([
      'Call the bank',
    ]);
    expect(dueReminders(state, '2026-10-20T13:30', '2026-10-20T14:00')).toEqual([]);
    expect(dueReminders(state, '2026-10-20T08:00', '2026-10-20T10:00')).toEqual([]);
  });

  it('schedules them with the notification service', () => {
    expect(reminderNotices(state)).toEqual([
      {
        id: call.id,
        start: '2026-10-20T14:00',
        repeat: 'none',
        until: null,
        offset: 30,
        title: 'Call the bank',
        body: REMINDER_BODY,
        tag: call.id,
        url: '/',
      },
      expect.objectContaining({ id: allDay.id, start: '2026-10-21T09:00', offset: 0 }),
      expect.objectContaining({ id: dayBefore.id, start: '2026-10-25T07:00', offset: 1440 }),
    ]);
  });
});
