/**
 * Which local times an open page checks for due reminders
 * (@shkriuss/ui/local-reminders): those since its last check.
 *
 * Two things make the time on the clock jump between checks:
 * - The page was asleep (the screen was off, or the tab hidden). Then
 *   reminders more than a few minutes late aren't shown: the person is
 *   back, and a pile of old ones helps nobody.
 * - The clocks changed while it was open (summer time, or a new time zone),
 *   with little real time passing. Then every local time skipped counts: a
 *   reminder at 02:30 on the night clocks go from 02:00 to 03:00 goes off
 *   at 03:00, as in Calendar (the notification service sends it at 03:30).
 *
 * Telling them apart: the device's clock in milliseconds (Date.now()) runs
 * on through a summer-time change, while the time on the clock jumps (audit
 * F1-6). Setting the clock by hand moves both, like sleep.
 *
 * The clock going back: by up to two hours (summer time ending), the times
 * shown again were checked already. By more (a new time zone after flying
 * west, or a clock set back), checking starts again from now: otherwise
 * nothing would be checked until the clock caught up (audit 4 F1-1).
 */
import { addMinutes, stampMinutes, type Stamp } from '@shkriuss/dates';

/** A check: the local time it reached, and when it ran (ms since 1970). */
export interface ReminderCheck {
  stamp: Stamp;
  at: number;
}

/** After sleep, reminders later than this (minutes) aren't shown. */
export const LATE_MINUTES = 5;
/** Clocks moved further than this at once (minutes) count only this far, as Calendar does. */
export const MAX_CLOCK_CHANGE_MINUTES = 12 * 60;
/** Summer time never puts clocks back further than this (minutes); more is a new time zone. */
export const MAX_SUMMER_TIME_MINUTES = 2 * 60;

/** Whether the clock went back from `last` to `now` further than summer time ever does. */
export function wentBackFar(last: ReminderCheck, now: ReminderCheck): boolean {
  const back = stampMinutes(last.stamp) - stampMinutes(now.stamp);
  // Time that passed meanwhile (asleep, say) counts too; a clock set back by
  // hand moves Date.now() back as well, so then only the time shown counts.
  return back + Math.max(0, (now.at - last.at) / 60_000) > MAX_SUMMER_TIME_MINUTES;
}

/**
 * The local times to check for due reminders: after `from`, up to and
 * including `to` (the time now). Null when the time on the clock hasn't
 * moved on since `last`, or went back as clocks do in autumn (the hour
 * again was checked already). After the clock went back further, the
 * minute now (see above).
 */
export function reminderWindow(
  last: ReminderCheck,
  now: ReminderCheck,
): { from: Stamp; to: Stamp } | null {
  if (now.stamp <= last.stamp) {
    return wentBackFar(last, now) ? { from: addMinutes(now.stamp, -1), to: now.stamp } : null;
  }
  const onTheClock = stampMinutes(now.stamp) - stampMinutes(last.stamp);
  const passed = (now.at - last.at) / 60_000;
  // How far the clocks moved on their own (0 without a clock change).
  const changed = Math.min(Math.max(0, onTheClock - passed), MAX_CLOCK_CHANGE_MINUTES);
  const earliest = addMinutes(now.stamp, -Math.ceil(LATE_MINUTES + changed));
  return { from: last.stamp < earliest ? earliest : last.stamp, to: now.stamp };
}
