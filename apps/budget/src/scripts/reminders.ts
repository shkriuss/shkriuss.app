/**
 * Budget's monthly reminder to check the budget.
 *
 * While Budget is open it checks every few seconds and shows it (if the
 * person allowed notifications). When "Also remind me when Budget is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends it instead, even when Budget is closed. Its schedule is uploaded again
 * after every change.
 */
import { today } from '@shkriuss/dates';
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import {
  REMINDER_BODY,
  REMINDER_TAG,
  REMINDER_TITLE,
  reminderDue,
  reminderNotices,
  type SettingsState,
} from '../lib/budget.ts';

export interface RemindersData {
  settings: () => SettingsState;
  announce: (message: string) => void;
}

export type Reminders = LocalReminders;

export function mountReminders(root: Document, data: RemindersData): Reminders {
  return mountLocalReminders(root, {
    app: 'Budget',
    what: 'the reminder',
    due: (from, to) =>
      reminderDue(data.settings(), from, to)
        ? [{ title: REMINDER_TITLE, tag: REMINDER_TAG, body: REMINDER_BODY }]
        : [],
    notices: () => reminderNotices(data.settings(), today()),
    announce: data.announce,
    spoken: () => `Reminder: ${REMINDER_TITLE.toLowerCase()}.`,
  });
}
