/**
 * Water's reminders: a notification at each reminder time, until the day's
 * goal is reached.
 *
 * While Water is open it checks every few seconds and shows them (if the
 * person allowed notifications). When "Also remind me when Water is closed"
 * is on (@shkriuss/ui/push-controls, docs/adr/0009), the notification service
 * sends them instead, even when Water is closed. Its schedule is uploaded
 * again after every change, so once the goal is reached, there are no more
 * reminders that day.
 */
import { today } from '@shkriuss/dates';
import { mountLocalReminders, type LocalReminders } from '@shkriuss/ui/local-reminders';
import {
  REMINDER_BODY,
  REMINDER_TAG,
  REMINDER_TITLE,
  reminderDue,
  reminderNotices,
  type DrinksState,
  type SettingsState,
} from '../lib/water.ts';

export interface RemindersData {
  drinks: () => DrinksState;
  settings: () => SettingsState;
  announce: (message: string) => void;
}

export type Reminders = LocalReminders;

export function mountReminders(root: Document, data: RemindersData): Reminders {
  return mountLocalReminders(root, {
    app: 'Water',
    due: (from, to) =>
      reminderDue(data.drinks(), data.settings(), from, to)
        ? [{ title: REMINDER_TITLE, tag: REMINDER_TAG, body: REMINDER_BODY }]
        : [],
    notices: () => reminderNotices(data.drinks(), data.settings(), today()),
    announce: data.announce,
    spoken: () => `Reminder: ${REMINDER_TITLE.toLowerCase()}.`,
  });
}
