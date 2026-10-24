/**
 * Tasks' reminders: a notification at the time chosen in "Remind me", for
 * tasks still to do.
 *
 * While Tasks is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Tasks is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends them instead, even when Tasks is closed. Its schedule is uploaded
 * again after every change, so a task that's done isn't reminded.
 */
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import { dueReminders, REMINDER_BODY, reminderNotices, type TasksState } from '../lib/tasks.ts';

export interface RemindersData {
  tasks: () => TasksState;
  announce: (message: string) => void;
}

export type Reminders = LocalReminders;

export function mountReminders(root: Document, data: RemindersData): Reminders {
  return mountLocalReminders(root, {
    app: 'Tasks',
    due: (from, to) =>
      dueReminders(data.tasks(), from, to).map((task) => ({
        title: task.title,
        tag: task.id,
        body: REMINDER_BODY,
      })),
    notices: () => reminderNotices(data.tasks()),
    announce: data.announce,
  });
}
