/**
 * The last check for due reminders, shared by an app's open tabs so a
 * reminder rings once, not once in each (audit 4 F1-6), as in Calendar. On
 * this device only, under a key backups leave out (it says roughly when the
 * app was last used), and one "Delete all data" removes (audit 5 D-1).
 * ./local-reminders.ts reads and writes it; it's kept apart so "Your data"
 * (./data-controls.ts) can forget it without loading the reminders code
 * into every app.
 */
import type { ReminderCheck } from '../lib/reminder-window.ts';

export const CHECKED_KEY = 'shkriuss-device:reminders-checked';
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function loadChecked(): ReminderCheck | null {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? 'null') as {
      stamp?: unknown;
      at?: unknown;
    } | null;
    const { stamp, at } = value ?? {};
    return typeof stamp === 'string' && STAMP_PATTERN.test(stamp) && typeof at === 'number'
      ? { stamp, at }
      : null;
  } catch {
    return null;
  }
}

export function saveChecked(check: ReminderCheck): void {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(check));
  } catch {
    // Storage blocked or full: each tab goes by its own checks.
  }
}

/** "Delete all data": nothing of the app stays, not even when it last checked (audit 5 D-1). */
export function forgetReminderChecks(): void {
  try {
    localStorage.removeItem(CHECKED_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
