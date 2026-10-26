import { describe, expect, it } from 'vitest';
import {
  addTask,
  completeTask,
  doneTasks,
  draftOf,
  draftProblems,
  dueReminders,
  dueText,
  editedTask,
  emptyTasks,
  everyUnit,
  formatDay,
  isTasksState,
  isViewSettings,
  LIMITS,
  matchesSearch,
  MAX_STEPS,
  MAX_TASKS,
  migrateTasks,
  moveTask,
  moveTasks,
  newTask,
  nextDate,
  NO_LIST,
  openGroups,
  openPerList,
  orderedTasks,
  parseEvery,
  reminderAt,
  reminderNotices,
  REMINDER_BODY,
  removeTask,
  removeTasks,
  reopenTask,
  searchWords,
  repeatText,
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
  every: '1',
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
    // How often: a whole number, only for repeats that count.
    const weekly = { date: TODAY, repeat: 'weekly' };
    for (const wrong of ['', '0', '1.5', '100', 'two']) {
      expect(draftProblems(draft({ ...weekly, every: wrong })).every, wrong).toBe(
        'Write a number from 1 to 99.',
      );
    }
    expect(draftProblems(draft({ ...weekly, every: ' 2 ' }))).toEqual({});
    expect(draftProblems(draft({ date: TODAY, repeat: 'weekdays', every: '' }))).toEqual({});
    expect([parseEvery('3'), parseEvery('03'), parseEvery('-1')]).toEqual([3, 3, undefined]);
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
        every: '3',
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
      every: 3,
      day: 1,
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
    const odd = taskFromDraft(
      draft({ date: TODAY, repeat: 'hourly', every: '5', reminder: '7' }),
      'b',
      1,
    );
    expect([odd.repeat, odd.every, odd.reminder]).toEqual(['none', 1, null]);
    // "Every" only counts for days, weeks, months and years.
    expect(
      taskFromDraft(draft({ date: TODAY, repeat: 'weekdays', every: '4' }), 'c', 1).every,
    ).toBe(1);
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

  it('cuts a long title or step by whole characters, never half an emoji', () => {
    // .slice() cut in the middle of an emoji, which showed as "�" (audit 4 J-11).
    const title = `${'a'.repeat(LIMITS.title - 1)}🎉🎉`;
    const step = { id: 's1', title: `${'b'.repeat(LIMITS.step - 1)}🎉🎉`, done: false };
    const made = taskFromDraft(draft({ title, steps: [step] }), 'e', 1);
    expect(made.title).toBe(`${'a'.repeat(LIMITS.title - 1)}🎉`);
    expect(made.steps[0]?.title).toBe(`${'b'.repeat(LIMITS.step - 1)}🎉`);
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

  // While the form is open, a sync (or another tab) may change the task
  // (audit F1-2): saving puts on only what was changed in the form.
  describe('saving a form that was open while the task changed elsewhere', () => {
    const plants = task({
      title: 'Water plants',
      date: TODAY,
      repeat: 'weekly',
      steps: [{ id: 'fern', title: 'The fern', done: true }],
    });
    const opened = draftOf(plants);
    // Ticked off on the other device: next week, its step unticked.
    const ticked = completeTask(stateOf(plants), plants.id, 5000, TODAY, 'copy').state;
    const current = ticked.tasks.find((entry) => entry.id === plants.id);

    it('keeps the other change', () => {
      const saved = editedTask(
        opened,
        { ...opened, title: 'Water the plants' },
        plants.id,
        6000,
        current,
      );
      expect(saved).toMatchObject({
        title: 'Water the plants',
        date: '2026-10-27',
        steps: [{ id: 'fern', title: 'The fern', done: false }],
        updated: 6000,
      });
      // Saving with nothing changed changes nothing but the time.
      expect(editedTask(opened, opened, plants.id, 6000, current)).toEqual({
        ...current,
        updated: 6000,
      });
    });

    it('lets the change here win where both changed the same thing', () => {
      const moved = editedTask(opened, { ...opened, date: '2026-10-22' }, plants.id, 6000, current);
      expect(moved).toMatchObject({ date: '2026-10-22', title: 'Water plants' });
    });

    it('uses the form as it is if the two don’t fit together', () => {
      // The date was cleared there; a reminder was set here (it needs a date).
      const cleared = updateTask(stateOf(plants), {
        ...plants,
        date: null,
        repeat: 'none',
        updated: 5000,
      }).tasks[0];
      const reminded = { ...opened, reminder: '60' };
      expect(editedTask(opened, reminded, plants.id, 6000, cleared)).toMatchObject({
        date: TODAY,
        repeat: 'weekly',
        reminder: 60,
      });
    });

    it('brings back a task deleted meanwhile, with the change', () => {
      const saved = editedTask(opened, { ...opened, notes: 'Not too much' }, plants.id, 6000);
      expect(saved).toMatchObject({ id: plants.id, date: TODAY, notes: 'Not too much' });
    });
  });

  it('comes back to its day of the month after a short month', () => {
    const tickedOnTime = (start: Task, times: number) => {
      let current = start;
      const dates: (string | null)[] = [];
      for (let time = 0; time < times; time += 1) {
        const due = current.date ?? '';
        const { state } = completeTask(stateOf(current), current.id, 5000, due, `copy${time}`);
        current = state.tasks.find((entry) => entry.id === start.id) ?? current;
        dates.push(current.date);
      }
      return dates;
    };
    const rent = task({ title: 'Pay rent', date: '2026-01-31', repeat: 'monthly' });
    expect(rent.day).toBe(31);
    expect(tickedOnTime(rent, 5)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    const leap = task({ title: 'Birthday', date: '2024-02-29', repeat: 'yearly' });
    expect(tickedOnTime(leap, 4)).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    // Saved before tasks kept their day: from its date's day, which it then keeps.
    const { day: _day, ...older } = { ...rent, date: '2026-02-28' as const };
    expect(tickedOnTime(older as Task, 2)).toEqual(['2026-03-28', '2026-04-28']);
  });

  it('keeps its day of the month when edited, unless its date is changed', () => {
    const rent = task({ title: 'Pay rent', date: '2026-01-31', repeat: 'monthly' });
    const moved = completeTask(stateOf(rent), rent.id, 5000, '2026-01-31', 'copy').state.tasks[1];
    expect(moved).toMatchObject({ date: '2026-02-28', day: 31 });
    const draft = draftOf(moved as Task);
    expect(taskFromDraft({ ...draft, title: 'Rent' }, rent.id, 6000, moved).day).toBe(31);
    expect(taskFromDraft({ ...draft, date: '2026-03-15' }, rent.id, 6000, moved).day).toBe(15);
    expect(taskFromDraft({ ...draft, repeat: 'weekly' }, rent.id, 6000, moved)).not.toHaveProperty(
      'day',
    );
    expect(isTasksState(stateOf({ ...rent, day: 31 }))).toBe(true);
    expect(isTasksState(stateOf({ ...rent, day: 32 }))).toBe(false);
    expect(isTasksState(stateOf({ ...rent, day: 1.5 }))).toBe(false);
  });

  it('is simply done when there’s no next date before 9999-12-31', () => {
    for (const repeat of ['yearly', 'daily'] as const) {
      const last = task({ title: 'Far away', date: '9999-12-31', repeat });
      const { state, next } = completeTask(stateOf(last), last.id, 5000, '9999-12-31', 'copy');
      expect(next).toBeNull();
      expect(state.tasks).toEqual([{ ...last, done: 5000, updated: 5000 }]);
      expect(isTasksState(state)).toBe(true);
    }
  });

  it('is simply done when “every” goes past 9999-12-31, however big (audit F1-14)', () => {
    // The form allows 1 to 99, but a backup or another device can hold more:
    // the checks look only at the shape, so it loads, and ticking it off
    // mustn't fail.
    for (const repeat of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
      for (const every of [1_000_000_000, Number.MAX_SAFE_INTEGER, 1e308]) {
        const far: Task = { ...task({ title: 'Far apart', date: TODAY, repeat }), every };
        expect(isTasksState(stateOf(far))).toBe(true);
        const { state, next } = completeTask(stateOf(far), far.id, 5000, TODAY, 'copy');
        expect(next, `${repeat}, every ${every}`).toBeNull();
        expect(state.tasks).toEqual([{ ...far, done: 5000, updated: 5000 }]);
      }
    }
    // Within the dates there are, it counts on as usual.
    expect(nextDate(TODAY, 'weekly', TODAY, 150)).toBe('2029-09-04');
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

  it('skips some with “every”: every 2 weeks, every 3 months…', () => {
    expect(nextDate(TODAY, 'daily', TODAY, 3)).toBe('2026-10-23');
    expect(nextDate(TODAY, 'weekly', TODAY, 2)).toBe('2026-11-03');
    expect(nextDate(TODAY, 'monthly', TODAY, 3)).toBe('2027-01-20');
    expect(nextDate(TODAY, 'yearly', TODAY, 2)).toBe('2028-10-20');
    // Done late: still on its own rhythm, after today.
    expect(nextDate('2026-10-01', 'daily', TODAY, 3)).toBe('2026-10-22');
    expect(nextDate('2026-09-29', 'weekly', TODAY, 2)).toBe('2026-10-27');
    expect(nextDate('2026-01-31', 'monthly', TODAY, 2)).toBe('2026-11-30');
    // Every weekday has nothing to skip.
    expect(nextDate('2026-10-23', 'weekdays', '2026-10-23', 5)).toBe('2026-10-26');
  });

  it('says how a task repeats', () => {
    expect(repeatText('weekly', 1)).toBe('Every week');
    expect(repeatText('weekly', 2)).toBe('Every 2 weeks');
    expect(repeatText('daily', 3)).toBe('Every 3 days');
    expect(repeatText('yearly', 1)).toBe('Every year');
    expect(repeatText('weekdays', 1)).toBe('Weekdays');
    expect(repeatText('none', 1)).toBe('');
    expect([everyUnit('monthly', 1), everyUnit('monthly', 6), everyUnit('none', 2)]).toEqual([
      'month',
      'months',
      '',
    ]);
  });

  it('moves a task before or after another (My order)', () => {
    const state = stateOf(...['A', 'B', 'C', 'D'].map((title) => task({ title }, title)));
    expect(titles(moveTask(state, 'D', { before: 'B' }).tasks)).toEqual(['A', 'D', 'B', 'C']);
    expect(titles(moveTask(state, 'A', { after: 'C' }).tasks)).toEqual(['B', 'C', 'A', 'D']);
    expect(titles(moveTask(state, 'B', { after: 'D' }).tasks)).toEqual(['A', 'C', 'D', 'B']);
    // Nothing to move: the same state.
    expect(moveTask(state, 'A', { before: 'A' })).toBe(state);
    expect(moveTask(state, 'gone', { before: 'A' })).toBe(state);
    expect(moveTask(state, 'A', { after: 'gone' })).toBe(state);
  });

  it('moves the tasks of a list that goes', () => {
    const rent = task({ list: 'home' });
    const report = task({ list: 'work' });
    const moved = moveTasks(stateOf(rent, report), 'home', NO_LIST);
    expect(moved.tasks.map((entry) => entry.list)).toEqual([NO_LIST, 'work']);
  });

  it('reads tasks saved by older versions', () => {
    // Version 1: no steps, no "every".
    const { steps: _, every: __, ...first } = task({ title: 'From version 1' });
    const fromFirst = migrateTasks({ tasks: [first] }, 1);
    expect(fromFirst?.tasks).toEqual([{ ...first, steps: [], every: 1 }]);
    expect(isTasksState(fromFirst)).toBe(true);
    // Version 2: steps, but no "every".
    const { every: ___, ...second } = task({
      title: 'From version 2',
      date: TODAY,
      repeat: 'weekly',
    });
    const fromSecond = migrateTasks(
      { tasks: [{ ...second, steps: [{ id: 's', title: 'Step', done: true }] }] },
      2,
    );
    expect(fromSecond?.tasks[0]).toMatchObject({
      every: 1,
      repeat: 'weekly',
      steps: [{ id: 's' }],
    });
    expect(isTasksState(fromSecond)).toBe(true);
    expect(migrateTasks({ tasks: [first] }, 7)).toBeUndefined();
    expect(migrateTasks({}, 1)).toBeUndefined();
  });

  it('checks saved data', () => {
    expect(isTasksState(stateOf(task({ date: TODAY, time: '09:30', reminder: '10' })))).toBe(true);
    expect(isTasksState({ tasks: [{ ...task(), repeat: 'hourly' }] })).toBe(false);
    expect(isTasksState({ tasks: [{ ...task(), every: 0 }] })).toBe(false);
    expect(isTasksState({ tasks: [{ ...task(), every: 1.5 }] })).toBe(false);
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

  it('keeps your own order, without done ones', () => {
    const first = task({ title: 'First', list: 'home' });
    const second = { ...task({ title: 'Second' }), done: 5 };
    const third = task({ title: 'Third', list: 'home', important: true });
    expect(titles(orderedTasks(stateOf(first, second, third), 'all'))).toEqual(['First', 'Third']);
    expect(titles(orderedTasks(stateOf(first, second, third), 'important'))).toEqual(['Third']);
    expect(isViewSettings({ order: 'mine' })).toBe(true);
    expect(isViewSettings({ order: 'random' })).toBe(false);
  });

  it('finds tasks by words in their title, notes or steps', () => {
    const trip = task({
      title: 'Prepare for the trip',
      notes: 'Flight on Friday',
      steps: [{ id: 's', title: 'Renew the passport', done: false }],
    });
    const café = task({ title: 'Café with Nino', list: 'home' });
    const old = { ...task({ title: 'Old trip photos' }), done: 5 };
    const found = (search: string) =>
      [
        ...openGroups(stateOf(trip, café, old), 'all', TODAY, search).flatMap(
          (group) => group.tasks,
        ),
        ...doneTasks(stateOf(trip, café, old), 'all', search),
      ].map((entry) => entry.title);
    expect(found('trip')).toEqual(['Prepare for the trip', 'Old trip photos']);
    expect(found('PASSPORT')).toEqual(['Prepare for the trip']);
    expect(found('friday trip')).toEqual(['Prepare for the trip']);
    // Accents don't matter.
    expect(found('cafe nino')).toEqual(['Café with Nino']);
    expect(found('nothing like this')).toEqual([]);
    expect(found('  ')).toHaveLength(3);
    // Only in what's shown.
    expect(titles(orderedTasks(stateOf(trip, café), { list: 'home' }, 'trip'))).toEqual([]);
    expect(matchesSearch(trip, searchWords(''))).toBe(true);
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
