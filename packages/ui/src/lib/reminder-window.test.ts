import { nowStamp, toStamp, type Stamp } from '@shkriuss/dates';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reminderWindow, type ReminderCheck } from './reminder-window.ts';

const MINUTE = 60_000;
const T = Date.UTC(2026, 9, 21, 8);
const check = (stamp: Stamp, minutes = 0): ReminderCheck => ({ stamp, at: T + minutes * MINUTE });

describe('the times an open page checks for reminders', () => {
  it('are those since the last check', () => {
    expect(reminderWindow(check('2026-10-21T10:00'), check('2026-10-21T10:01', 1 / 3))).toEqual({
      from: '2026-10-21T10:00',
      to: '2026-10-21T10:01',
    });
    // Not a new minute yet.
    expect(reminderWindow(check('2026-10-21T10:01'), check('2026-10-21T10:01', 1 / 3))).toBeNull();
    // Clocks going back in autumn: the hour again was checked already.
    expect(reminderWindow(check('2026-10-25T02:59'), check('2026-10-25T02:00', 1 / 3))).toBeNull();
  });

  it('after sleep, are only the last few minutes', () => {
    expect(reminderWindow(check('2026-10-21T10:00'), check('2026-10-21T12:00', 120))).toEqual({
      from: '2026-10-21T11:55',
      to: '2026-10-21T12:00',
    });
  });

  // Audit F1-6: clocks went from 01:59 to 03:00 in 20 seconds, which isn't sleep.
  it('when the clocks change, include every time they skipped', () => {
    expect(reminderWindow(check('2026-03-29T01:59'), check('2026-03-29T03:00', 1 / 3))).toEqual({
      from: '2026-03-29T01:59',
      to: '2026-03-29T03:00',
    });
    // Asleep for 10 minutes across it: the skipped hour, and the few minutes before.
    expect(reminderWindow(check('2026-03-29T01:50'), check('2026-03-29T03:05', 10))).toEqual({
      from: '2026-03-29T01:55',
      to: '2026-03-29T03:05',
    });
    // Asleep for 2 hours across it, waking at 4:00: what was skipped is an hour late.
    expect(reminderWindow(check('2026-03-29T01:00'), check('2026-03-29T04:00', 120))).toEqual({
      from: '2026-03-29T02:55',
      to: '2026-03-29T04:00',
    });
    // A whole day at once (a trip across the date line): at most 12 hours of it.
    expect(reminderWindow(check('2026-03-29T10:00'), check('2026-03-30T10:00', 1 / 3))).toEqual({
      from: '2026-03-29T21:55',
      to: '2026-03-30T10:00',
    });
  });
});

/**
 * A page open through the night, checking every 20 seconds by the real clock
 * of the time zone in TZ: when a reminder at `time` each day goes off.
 */
function night(from: string, to: string, time: string): Stamp[] {
  const fired: Stamp[] = [];
  let last: ReminderCheck = { stamp: nowStamp(new Date(from)), at: Date.parse(from) };
  for (let at = Date.parse(from) + 20_000; at <= Date.parse(to); at += 20_000) {
    const now = { stamp: nowStamp(new Date(at)), at };
    const window = reminderWindow(last, now);
    if (!window) continue;
    last = now;
    const due = toStamp(window.to.slice(0, 10), time);
    if (window.from < due && due <= window.to) fired.push(window.to);
  }
  return fired;
}

for (const place of [
  // Clocks go from 02:00 to 03:00 on 29 March 2026.
  { zone: 'Europe/Berlin', night: '2026-03-29', utc: 'T00:50:00Z', time: '02:30', at: '03:00' },
  // Clocks go from 00:00 to 01:00 on 6 September 2026.
  { zone: 'America/Santiago', night: '2026-09-06', utc: 'T03:50:00Z', time: '00:30', at: '01:00' },
]) {
  describe(`in ${place.zone}`, () => {
    const before = process.env['TZ'];
    beforeAll(() => {
      process.env['TZ'] = place.zone;
    });
    afterAll(() => {
      if (before === undefined) delete process.env['TZ'];
      else process.env['TZ'] = before;
    });
    const from = (date: string) => `${date}${place.utc}`;
    const until = (date: string) => new Date(Date.parse(from(date)) + 130 * MINUTE).toISOString();

    it('a reminder in the hour the clocks skip goes off once, as they change', () => {
      expect(nowStamp(new Date(from(place.night)))).not.toContain(place.time);
      expect(night(from(place.night), until(place.night), place.time)).toEqual([
        `${place.night}T${place.at}`,
      ]);
    });

    it('and on a night without a change, on time', () => {
      const week = new Date(Date.parse(from(place.night)) - 7 * 24 * 60 * MINUTE);
      const date = week.toISOString().slice(0, 10);
      expect(night(from(date), until(date), place.time)).toEqual([`${date}T${place.time}`]);
    });
  });
}

// When clocks go back, a time in the hour that repeats is on the clock twice:
// the page shows its reminder once, the first time, the moment the
// notification service picks too (@shkriuss/push's zonedMoment, audit 3 F1-3).
for (const place of [
  { zone: 'Europe/Berlin', from: '2026-10-24T22:00:00Z', due: '2026-10-25T02:30' },
  { zone: 'Australia/Sydney', from: '2026-04-04T13:00:00Z', due: '2026-04-05T02:30' },
  { zone: 'America/New_York', from: '2026-11-01T03:00:00Z', due: '2026-11-01T01:30' },
]) {
  describe(`in ${place.zone}, as the clocks go back`, () => {
    const before = process.env['TZ'];
    beforeAll(() => {
      process.env['TZ'] = place.zone;
    });
    afterAll(() => {
      if (before === undefined) delete process.env['TZ'];
      else process.env['TZ'] = before;
    });

    it('a reminder in the hour that repeats goes off once, the first time', () => {
      const fired: string[] = [];
      const start = Date.parse(place.from);
      let last: ReminderCheck = { stamp: nowStamp(new Date(start)), at: start };
      for (let at = start + 20_000; at <= start + 5 * 60 * MINUTE; at += 20_000) {
        const now = { stamp: nowStamp(new Date(at)), at };
        const window = reminderWindow(last, now);
        if (!window) continue;
        last = now;
        if (window.from < place.due && place.due <= window.to) {
          fired.push(new Date(at).toISOString());
        }
      }
      // Its first time, in UTC: 02:30 CEST, 02:30 AEDT, 01:30 EDT.
      const first = new Date(Date.parse(place.from) + 150 * MINUTE).toISOString();
      expect(fired).toEqual([first]);
    });
  });
}
