import type { DeviceState } from "@shkriuss/data";

const DAY = 24 * 60 * 60 * 1000;

/** How old the last backup is when the reminder comes: a week (architecture §8). */
export const REMIND_AFTER = 7 * DAY;

/** How long "Later" hides the reminder: a day. */
export const LATER = DAY;

/**
 * What the reminder says:
 *
 * - `first`: the device has data, and never made a backup.
 * - `due`: the device has changes since its last backup, which is a week old or more.
 */
export type Reminder =
  | { readonly kind: "first" }
  | { readonly kind: "due"; readonly lastBackup: number; readonly changes: number };

/**
 * Whether the device reminds the user to back up at `now` (architecture §8): when it has changes
 * that none of its backups has, and it never made a backup, or made its last one a week ago or
 * more. A last backup that the clock puts more than a day ahead is due as well, so that a clock
 * that was wrong when the backup was made does not silence the reminders.
 */
export function reminderFor(device: DeviceState, now: number): Reminder | undefined {
  const { lastBackup, changesSinceBackup: changes } = device;
  if (changes === 0) {
    return undefined;
  }
  if (lastBackup === null) {
    return { kind: "first" };
  }
  const age = now - lastBackup;
  return age >= REMIND_AFTER || age < -DAY ? { kind: "due", lastBackup, changes } : undefined;
}
