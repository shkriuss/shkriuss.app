/**
 * A new day while an app is open, the same way in every app (audit 4 J-11):
 * looked for every minute, and when the page comes back on screen (a
 * phone's sleeping page runs its timers late, or not at all).
 *
 *   onNewDay((day, before) => { … draw "today" again … });
 *
 * `changed` gets the new date and the one before, once each time the date
 * changes.
 */
import { today, type IsoDate } from '@shkriuss/dates';

/** How often to look for a new day. */
export const NEW_DAY_CHECK_MS = 60_000;

export function onNewDay(
  changed: (day: IsoDate, before: IsoDate) => void,
  root: Document = document,
): void {
  let day = today();
  const check = (): void => {
    const now = today();
    if (now === day) return;
    const before = day;
    day = now;
    changed(now, before);
  };
  window.setInterval(check, NEW_DAY_CHECK_MS);
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') check();
  });
}
