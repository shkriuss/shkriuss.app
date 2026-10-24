// Shared by Reminders' browser tests: the day it is, finding things on the
// page, and saving reminders straight into storage.
import type { Page } from '@playwright/test';
import { seedStores } from '../../../tests/e2e/storage.ts';
import { REMINDERS_VERSION, type Reminder, type Repeat } from '../src/lib/reminders.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

/** A group of reminders by its heading ("Overdue", "Today", "Tomorrow", "Later"). */
export const group = (page: Page, title: string) =>
  page.locator('[data-groups] > div').filter({ has: page.getByRole('heading', { name: title }) });
/** A reminder in the list, by its text. */
export const row = (page: Page, text: string) =>
  page
    .locator('li[data-id]')
    .filter({ has: page.getByRole('button', { name: text, exact: true }) });
export const editDialog = (page: Page) => page.locator('[data-edit-dialog]');

/** Fills in "New reminder" and adds it. */
export async function addReminder(
  page: Page,
  text: string,
  options: { date?: string; time?: string; repeat?: string } = {},
): Promise<void> {
  const form = page.locator('[data-add-form]');
  await form.getByLabel('Remind me to').fill(text);
  if (options.date) await form.getByLabel('Day').fill(options.date);
  if (options.time) await form.getByLabel('Time').fill(options.time);
  if (options.repeat) await form.getByLabel('Repeats').selectOption({ label: options.repeat });
  await form.getByRole('button', { name: 'Add reminder' }).click();
}

/** A reminder, as saved. */
export const reminder = (
  id: string,
  text: string,
  date: string,
  time: string,
  repeat: Repeat = 'none',
  done: string | null = null,
): Reminder => ({ id, text, date, time, repeat, done });

/** Saves reminders straight into storage, then reloads. */
export async function seed(page: Page, reminders: Reminder[]): Promise<void> {
  await seedStores(page, { reminders: { version: REMINDERS_VERSION, data: { reminders } } });
}
