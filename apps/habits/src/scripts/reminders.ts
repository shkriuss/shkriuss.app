/**
 * Habits' reminders: a notification at a habit's reminder time, on the days
 * it's planned for, unless it's already done.
 *
 * While Habits is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Habits is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends them instead, even when Habits is closed. Its schedule is uploaded
 * again after every change, so a habit ticked off today isn't reminded today.
 */
import { today } from '@shkriuss/dates';
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import {
  dueReminders,
  REMINDER_BODY,
  reminderNotices,
  type ChecksState,
  type HabitsState,
} from '../lib/habits.ts';

export interface RemindersData {
  habits: () => HabitsState;
  checks: () => ChecksState;
  announce: (message: string) => void;
}

export type Reminders = LocalReminders;

export function mountReminders(root: Document, data: RemindersData): Reminders {
  return mountLocalReminders(root, {
    app: 'Habits',
    due: (from, to) =>
      dueReminders(data.habits(), data.checks(), from, to).map((habit) => ({
        title: habit.name,
        tag: habit.id,
        body: REMINDER_BODY,
      })),
    notices: () => reminderNotices(data.habits(), data.checks(), today()),
    announce: data.announce,
  });
}
