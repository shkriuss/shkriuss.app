import { describe, expect, it } from 'vitest';
import {
  addReminder,
  clearDone,
  draftOf,
  dueReminders,
  editReminder,
  emptyReminders,
  groups,
  inAnHour,
  isRemindersState,
  MAX_REMINDERS,
  MAX_TEXT_LENGTH,
  nextFullHour,
  nextTime,
  problems,
  putOff,
  REMINDER_BODY,
  reminderNotices,
  removeReminder,
  repeatLabel,
  secondVersion,
  setDone,
  timeLabel,
  tomorrowAt,
  updateReminder,
  whenInSentence,
  whenLabel,
  type Reminder,
  type RemindersState,
  type Repeat,
} from './reminders.ts';

// Wednesday 21 October 2026, 10:00.
const NOW = '2026-10-21T10:00';
const reminder = (
  id: string,
  date: string,
  time: string,
  repeat: Repeat = 'none',
  done: string | null = null,
): Reminder => ({ id, text: id, date, time, repeat, done });
const state = (...reminders: Reminder[]): RemindersState => ({ reminders });

describe('checking', () => {
  const draft = { text: 'Call Mum', date: '2026-10-21', time: '18:00', repeat: 'none' as const };

  it('needs some text and a time still to come', () => {
    expect(problems(draft, emptyReminders(), NOW)).toEqual({});
    expect(problems({ ...draft, text: '  ' }, emptyReminders(), NOW)).toEqual({
      text: 'Write what to be reminded of.',
    });
    expect(
      problems({ ...draft, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }, emptyReminders(), NOW).text,
    ).toBe(`Use ${MAX_TEXT_LENGTH} characters or fewer.`);
    // Text as long as its box lets in on an iPhone, which counts an emoji or
    // a flag once: fine, where it was refused as too long (audit 5 F1-5).
    expect(
      problems({ ...draft, text: '💊'.repeat(MAX_TEXT_LENGTH) }, emptyReminders(), NOW),
    ).toEqual({});
    expect(
      problems({ ...draft, text: '🇬🇪'.repeat(MAX_TEXT_LENGTH) }, emptyReminders(), NOW),
    ).toEqual({});
    expect(
      problems({ ...draft, text: '💊'.repeat(MAX_TEXT_LENGTH + 1) }, emptyReminders(), NOW).text,
    ).toBe(`Use ${MAX_TEXT_LENGTH} characters or fewer.`);
    expect(problems({ ...draft, date: '', time: '' }, emptyReminders(), NOW)).toEqual({
      date: 'Choose a day.',
      time: 'Choose a time.',
    });
    expect(problems({ ...draft, time: '10:00' }, emptyReminders(), NOW)).toEqual({
      time: 'Choose a time that’s still to come.',
    });
    // One that repeats can start in the past.
    expect(problems({ ...draft, time: '08:00', repeat: 'daily' }, emptyReminders(), NOW)).toEqual(
      {},
    );
  });

  it('lets an overdue reminder’s text be corrected without moving it (audit 4 F1-8)', () => {
    const overdue = reminder('r', '2026-10-21', '09:00');
    const saved = state(overdue);
    expect(problems({ ...draftOf(overdue), text: 'Call Mum' }, saved, NOW, overdue)).toEqual({});
    // Moved, or one that's done (saving sets it again): still to come.
    expect(problems({ ...draftOf(overdue), time: '09:30' }, saved, NOW, overdue)).toEqual({
      time: 'Choose a time that’s still to come.',
    });
    const done = { ...overdue, done: NOW };
    expect(problems({ ...draftOf(done), text: 'Call Mum' }, state(done), NOW, done)).toEqual({
      time: 'Choose a time that’s still to come.',
    });
  });

  it('corrects an overdue reminder’s text after another device ticked it or put it off', () => {
    // The form opened on an overdue reminder; meanwhile a sync (or another
    // tab) ticked it done, or put it off. Checked against the reminder as it
    // was then, the old time counted as set again, and Save was refused with
    // "Choose a time that’s still to come" (audit 5 F1-2).
    const overdue = { ...reminder('r', '2026-10-21', '09:00'), text: 'Call Mum' };
    const corrected = { ...draftOf(overdue), text: 'Call Mum back' };
    const ticked = setDone(state(overdue), 'r', NOW);
    expect(problems(corrected, ticked, NOW, overdue)).toEqual({});
    expect(editReminder(ticked, overdue, corrected).reminders[0]).toEqual({
      ...overdue,
      text: 'Call Mum back',
      done: NOW,
    });
    const moved = putOff(state(overdue), 'r', '2026-10-22T09:00');
    expect(problems(corrected, moved, NOW, overdue)).toEqual({});
    expect(editReminder(moved, overdue, corrected).reminders[0]).toEqual({
      ...overdue,
      text: 'Call Mum back',
      date: '2026-10-22',
    });
    // A time chosen here must still be to come, as before.
    expect(problems({ ...corrected, time: '09:30' }, ticked, NOW, overdue)).toEqual({
      time: 'Choose a time that’s still to come.',
    });
  });

  it(`allows up to ${MAX_REMINDERS} reminders`, () => {
    const full = state(
      ...Array.from({ length: MAX_REMINDERS }, (_, index) =>
        reminder(`r${index}`, '2026-11-01', '09:00'),
      ),
    );
    expect(problems(draft, full, NOW).text).toBe(`You can have up to ${MAX_REMINDERS} reminders.`);
    expect(problems(draft, full, NOW, full.reminders[0])).toEqual({});
  });

  it('checks saved reminders', () => {
    expect(isRemindersState(state(reminder('a', '2026-10-21', '09:00')))).toBe(true);
    expect(
      isRemindersState(state(reminder('a', '2026-10-21', '09:00', 'none', '2026-10-21T09:05'))),
    ).toBe(true);
    expect(
      isRemindersState(
        state({ ...reminder('a', '2026-10-21', '09:00'), repeat: 'hourly' as Repeat }),
      ),
    ).toBe(false);
    expect(isRemindersState(state({ ...reminder('a', '2026-10-21', '09:00'), done: 'yes' }))).toBe(
      false,
    );
    expect(isRemindersState({ reminders: {} })).toBe(false);
  });
});

describe('changing', () => {
  const start = state(
    reminder('a', '2026-10-21', '18:00'),
    reminder('b', '2026-10-22', '09:00', 'daily'),
  );

  it('adds, changes and removes reminders', () => {
    const added = addReminder(start, reminder('c', '2026-10-23', '12:00'));
    expect(added.reminders.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    const changed = updateReminder(added, 'a', {
      text: ' Call Dad ',
      date: '2026-10-24',
      time: '19:00',
      repeat: 'weekly',
    });
    expect(changed.reminders[0]).toEqual({
      id: 'a',
      text: 'Call Dad',
      date: '2026-10-24',
      time: '19:00',
      repeat: 'weekly',
      done: null,
    });
    expect(removeReminder(changed, 'b').reminders.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('ticks done, puts off and clears done ones that don’t repeat', () => {
    const done = setDone(start, 'a', NOW);
    expect(done.reminders[0]?.done).toBe(NOW);
    // One that repeats can't be done.
    expect(setDone(start, 'b', NOW)).toEqual(start);
    expect(setDone(done, 'a', null)).toEqual(start);
    expect(clearDone(done).reminders.map((entry) => entry.id)).toEqual(['b']);
    // Changing a done one sets it again.
    expect(
      updateReminder(done, 'a', { text: 'a', date: '2026-10-25', time: '09:00', repeat: 'none' })
        .reminders[0]?.done,
    ).toBeNull();

    const later = putOff(done, 'a', inAnHour(NOW));
    expect(later.reminders[0]).toMatchObject({ date: '2026-10-21', time: '11:00', done: null });
    expect(tomorrowAt(reminder('x', '2026-10-20', '08:30'), '2026-10-21')).toBe('2026-10-22T08:30');
  });

  // While the change form is open, a sync (or another tab) may change the
  // reminder (audit F1-2): saving puts on only what was changed in the form.
  it('saves the change form on top of a change made elsewhere meanwhile', () => {
    const opened = { ...reminder('a', '2026-10-21', '18:00'), text: 'Call Mum' };
    const before = draftOf(opened);
    // Ticked done on the other device.
    const ticked = setDone(state(opened), 'a', NOW);
    const text = editReminder(ticked, opened, { ...before, text: 'Call Mum back' });
    expect(text.reminders).toEqual([{ ...opened, text: 'Call Mum back', done: NOW }]);
    // A new time here sets it again.
    const time = editReminder(ticked, opened, { ...before, time: '19:00' });
    expect(time.reminders).toEqual([{ ...opened, time: '19:00', done: null }]);
    // Moved there, text changed here: both stay.
    const moved = putOff(state(opened), 'a', '2026-10-22T08:00');
    expect(editReminder(moved, opened, { ...before, text: 'Call Mum back' }).reminders).toEqual([
      { ...opened, text: 'Call Mum back', date: '2026-10-22', time: '08:00' },
    ]);
    // One done when the form opened is set again, as before.
    const done = { ...opened, done: NOW };
    expect(editReminder(state(done), done, draftOf(done)).reminders[0]?.done).toBeNull();
    // Deleted meanwhile: nothing to change.
    expect(editReminder(emptyReminders(), opened, before)).toEqual(emptyReminders());
  });

  it('keeps both versions of one changed on two devices', () => {
    expect(
      secondVersion({ ...reminder('a', '2026-10-21', '18:00'), text: 'Call Mum' }, 'z'),
    ).toEqual({
      ...reminder('z', '2026-10-21', '18:00'),
      text: 'Call Mum (second version)',
    });
    // A long text is cut between whole characters: cut inside a family emoji,
    // it ended in a smaller family and a lone joiner (audit 6 F1-3).
    const family = '👨‍👩‍👧‍👦';
    const copy = secondVersion(
      { ...reminder('a', '2026-10-21', '18:00'), text: `Call ${family.repeat(10)}` },
      'z',
    );
    expect(copy.text).toBe(`Call ${family.repeat(8)} (second version)`);
    expect(copy.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(isRemindersState({ reminders: [copy] })).toBe(true);
  });

  it('suggests the next full hour', () => {
    expect(nextFullHour('2026-10-21T10:20')).toEqual({ date: '2026-10-21', time: '11:00' });
    expect(nextFullHour('2026-10-21T23:30')).toEqual({ date: '2026-10-22', time: '00:00' });
  });
});

describe('next times', () => {
  it('for one that doesn’t repeat: its time, until it has passed', () => {
    expect(nextTime(reminder('a', '2026-10-21', '18:00'), NOW)).toBe('2026-10-21T18:00');
    expect(nextTime(reminder('a', '2026-10-21', '09:00'), NOW)).toBeNull();
  });

  it('every day and every week', () => {
    expect(nextTime(reminder('a', '2026-10-01', '09:00', 'daily'), NOW)).toBe('2026-10-22T09:00');
    expect(nextTime(reminder('a', '2026-10-01', '11:00', 'daily'), NOW)).toBe('2026-10-21T11:00');
    expect(nextTime(reminder('a', '2026-12-01', '09:00', 'daily'), NOW)).toBe('2026-12-01T09:00');
    // 1 October 2026 was a Thursday.
    expect(nextTime(reminder('a', '2026-10-01', '09:00', 'weekly'), NOW)).toBe('2026-10-22T09:00');
    expect(nextTime(reminder('a', '2026-10-14', '12:00', 'weekly'), NOW)).toBe('2026-10-21T12:00');
    expect(nextTime(reminder('a', '2026-10-14', '09:00', 'weekly'), NOW)).toBe('2026-10-28T09:00');
  });

  it('every weekday', () => {
    expect(nextTime(reminder('a', '2026-10-01', '09:00', 'weekdays'), NOW)).toBe(
      '2026-10-22T09:00',
    );
    // Friday evening: next on Monday.
    expect(nextTime(reminder('a', '2026-10-01', '09:00', 'weekdays'), '2026-10-23T18:00')).toBe(
      '2026-10-26T09:00',
    );
    // Starting on a Saturday: the first is on Monday.
    expect(nextTime(reminder('a', '2026-10-24', '09:00', 'weekdays'), NOW)).toBe(
      '2026-10-26T09:00',
    );
  });

  it('every month, skipping months without the day', () => {
    expect(nextTime(reminder('a', '2026-01-15', '09:00', 'monthly'), NOW)).toBe('2026-11-15T09:00');
    expect(nextTime(reminder('a', '2026-01-21', '12:00', 'monthly'), NOW)).toBe('2026-10-21T12:00');
    expect(nextTime(reminder('a', '2026-08-31', '09:00', 'monthly'), NOW)).toBe('2026-10-31T09:00');
    expect(nextTime(reminder('a', '2026-08-31', '09:00', 'monthly'), '2026-11-01T00:00')).toBe(
      '2026-12-31T09:00',
    );
  });

  it('every year, 29 February only in leap years', () => {
    expect(nextTime(reminder('a', '2020-03-05', '09:00', 'yearly'), NOW)).toBe('2027-03-05T09:00');
    expect(nextTime(reminder('a', '2020-10-21', '12:00', 'yearly'), NOW)).toBe('2026-10-21T12:00');
    expect(nextTime(reminder('a', '2024-02-29', '09:00', 'yearly'), NOW)).toBe('2028-02-29T09:00');
  });
});

describe('groups', () => {
  it('sorts reminders by when they come next', () => {
    const result = groups(
      state(
        reminder('later', '2026-10-30', '09:00'),
        reminder('missed', '2026-10-20', '09:00'),
        reminder('pills', '2026-10-01', '09:00', 'daily'),
        reminder('lunch', '2026-10-21', '12:30'),
        reminder('early', '2026-10-21', '10:30'),
        reminder('old', '2026-10-19', '09:00', 'none', '2026-10-19T09:10'),
        reminder('older', '2026-10-18', '09:00', 'none', '2026-10-18T09:10'),
      ),
      NOW,
    );
    const ids = (items: { reminder: Reminder }[]) => items.map((item) => item.reminder.id);
    expect(ids(result.overdue)).toEqual(['missed']);
    expect(ids(result.today)).toEqual(['early', 'lunch']);
    expect(ids(result.tomorrow)).toEqual(['pills']);
    expect(result.tomorrow[0]?.at).toBe('2026-10-22T09:00');
    expect(ids(result.later)).toEqual(['later']);
    expect(ids(result.done)).toEqual(['old', 'older']);
  });
});

describe('notifications', () => {
  it('go to the notification service, until done', () => {
    const notices = reminderNotices(
      state(
        { ...reminder('a', '2026-10-21', '18:00'), text: 'Call Mum' },
        reminder('b', '2026-10-01', '09:00', 'monthly'),
        reminder('c', '2026-10-20', '09:00', 'none', '2026-10-20T09:01'),
      ),
    );
    expect(notices).toEqual([
      {
        id: 'a',
        start: '2026-10-21T18:00',
        repeat: 'none',
        until: null,
        offset: 0,
        title: 'Call Mum',
        body: REMINDER_BODY,
        tag: 'a',
        url: '/',
      },
      expect.objectContaining({ id: 'b', start: '2026-10-01T09:00', repeat: 'monthly' }),
    ]);
  });

  it('every weekday is a weekly one for each day from Monday to Friday', () => {
    // Starts on Wednesday 21 October.
    const notices = reminderNotices(state(reminder('w', '2026-10-21', '08:00', 'weekdays')));
    expect(notices.map(({ id, start, repeat, tag }) => ({ id, start, repeat, tag }))).toEqual([
      { id: 'w~1', start: '2026-10-26T08:00', repeat: 'weekly', tag: 'w' },
      { id: 'w~2', start: '2026-10-27T08:00', repeat: 'weekly', tag: 'w' },
      { id: 'w~3', start: '2026-10-21T08:00', repeat: 'weekly', tag: 'w' },
      { id: 'w~4', start: '2026-10-22T08:00', repeat: 'weekly', tag: 'w' },
      { id: 'w~5', start: '2026-10-23T08:00', repeat: 'weekly', tag: 'w' },
    ]);
  });

  it('are due while the app is open', () => {
    const reminders = state(
      reminder('a', '2026-10-21', '10:05'),
      reminder('b', '2026-10-01', '10:05', 'daily'),
      reminder('c', '2026-10-21', '10:05', 'none', '2026-10-21T09:00'),
      reminder('d', '2026-10-21', '10:10'),
    );
    expect(
      dueReminders(reminders, '2026-10-21T10:00', '2026-10-21T10:05').map((r) => r.id),
    ).toEqual(['a', 'b']);
    expect(dueReminders(reminders, '2026-10-21T10:05', '2026-10-21T10:06')).toEqual([]);
  });
});

describe('words', () => {
  it('says when', () => {
    expect(whenLabel('2026-10-21T15:00', NOW, 'en-US')).toMatch(/^Today at 3:00\sPM$/);
    expect(whenLabel('2026-10-22T09:00', NOW, 'en-GB')).toBe('Tomorrow at 9:00');
    expect(whenLabel('2026-10-20T09:00', NOW, 'en-GB')).toBe('Yesterday at 9:00');
    expect(whenLabel('2026-10-30T09:00', NOW, 'en-GB')).toBe('Friday 30 October at 9:00');
    expect(whenLabel('2027-01-04T09:00', NOW, 'en-GB')).toBe('Monday, 4 January 2027 at 9:00');
    expect(timeLabel('20:00', 'en-GB')).toBe('20:00');
    expect(whenInSentence('2026-10-22T09:00', NOW, 'en-GB')).toBe('tomorrow at 9:00');
    expect(whenInSentence('2026-10-30T09:00', NOW, 'en-GB')).toBe('Friday 30 October at 9:00');
  });

  it('says how often', () => {
    const on = (repeat: Repeat, date = '2026-10-23') =>
      repeatLabel(reminder('a', date, '09:00', repeat), 'en-US');
    expect(on('none')).toBe('');
    expect(on('daily')).toBe('Every day');
    expect(on('weekdays')).toBe('Every weekday');
    expect(on('weekly')).toBe('Every Friday');
    expect(on('monthly')).toBe('Every month on the 23rd');
    expect(on('monthly', '2026-10-01')).toBe('Every month on the 1st');
    expect(on('monthly', '2026-10-12')).toBe('Every month on the 12th');
    expect(on('yearly')).toBe('Every year on October 23');
  });
});
