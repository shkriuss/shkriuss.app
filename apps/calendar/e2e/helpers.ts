// Helpers shared by Calendar's browser tests.
import type { Page } from '@playwright/test';
import { expect } from '../../../tests/e2e/fixtures.ts';
import type { CalendarEvent } from '../src/lib/events.ts';

/** An event with every field filled in; tests change only what matters to them. */
export const sampleEvent = (event: Partial<CalendarEvent>, index = 0): CalendarEvent => ({
  id: `seed-${index}`,
  title: 'Event',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  startTime: '09:00',
  endTime: '10:00',
  repeat: 'none',
  repeatUntil: null,
  reminder: null,
  notes: '',
  ...event,
});

/** Saves events straight into storage (optionally in an older format), then reloads. */
export async function seed(
  page: Page,
  events: Partial<CalendarEvent>[],
  storage: Record<string, unknown> = {},
): Promise<void> {
  const data = {
    'shkriuss:calendar': { v: 2, data: { events: events.map(sampleEvent) } },
    ...storage,
  };
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries))
      localStorage.setItem(key, JSON.stringify(value));
  }, data);
  await page.reload();
}

export const editor = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) event$/ });
export const dayList = (page: Page) => page.locator('[data-day-events]');
export const upcoming = (page: Page) => page.locator('[data-upcoming]');
export const day = (page: Page, label: string | RegExp) =>
  page.locator('[data-weeks]').getByRole('button', { name: label });
export const monthHeading = (page: Page) => page.locator('#month-heading');

export async function newEvent(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New event' }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByLabel('Title').fill(title);
}

export const save = (page: Page) => editor(page).getByRole('button', { name: 'Save' }).click();
