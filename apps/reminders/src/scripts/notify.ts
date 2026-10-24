/**
 * Notifications: one for each reminder, at its time.
 *
 * While Reminders is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Reminders is
 * closed" is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification
 * service sends them instead, even when Reminders is closed. Its schedule is
 * uploaded again after every change.
 */
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import {
  dueReminders,
  REMINDER_BODY,
  reminderNotices,
  type RemindersState,
} from '../lib/reminders.ts';

export interface NotifyData {
  state: () => RemindersState;
  announce: (message: string) => void;
}

export type Notify = LocalReminders;

export function mountNotify(root: Document, data: NotifyData): Notify {
  return mountLocalReminders(root, {
    app: 'Reminders',
    due: (from, to) =>
      dueReminders(data.state(), from, to).map((reminder) => ({
        title: reminder.text,
        tag: reminder.id,
        body: REMINDER_BODY,
      })),
    notices: () => reminderNotices(data.state()),
    announce: data.announce,
  });
}
