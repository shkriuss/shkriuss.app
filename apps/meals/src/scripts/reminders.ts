/**
 * Meals' reminders: a notification at the time chosen for a meal of the day,
 * saying what's planned ("Dinner: Lentil soup"), on days something is.
 *
 * While Meals is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Meals is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends them instead, even when Meals is closed. Its schedule is uploaded
 * again after every change to the plan or the reminder times.
 */
import { nowStamp } from '@shkriuss/dates';
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import {
  dueReminders,
  REMINDER_BODY,
  reminderNotices,
  type PlanState,
  type RemindersState,
} from '../lib/meals.ts';

export interface RemindersData {
  plan: () => PlanState;
  reminders: () => RemindersState;
  announce: (message: string) => void;
}

export type Reminders = LocalReminders;

export function mountReminders(root: Document, data: RemindersData): Reminders {
  return mountLocalReminders(root, {
    app: 'Meals',
    due: (from, to) =>
      dueReminders(data.plan(), data.reminders(), from, to).map((reminder) => ({
        title: reminder.title,
        tag: reminder.id,
        body: REMINDER_BODY,
      })),
    notices: () => reminderNotices(data.plan(), data.reminders(), nowStamp()),
    announce: data.announce,
    // Titles like "Dinner: Lentil soup" read better one sentence each.
    spoken: (due) => `Reminder: ${due.map((reminder) => reminder.title).join('. ')}.`,
  });
}
