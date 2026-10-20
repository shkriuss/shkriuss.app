// Shared by Tasks' browser tests: finding things on the page, and saving
// tasks and lists straight into storage.
import type { Page } from '@playwright/test';
import type { List } from '../src/lib/lists.ts';
import type { Task } from '../src/lib/tasks.ts';

/** Tuesday 20 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-20T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

export const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' });
export const row = (page: Page, title: string) =>
  page
    .locator('[data-id]')
    .filter({ has: page.getByRole('button', { name: `Edit ${title}`, exact: true }) });
export const titles = (page: Page) => page.locator('[data-groups] [data-action="edit"]');
export const doneTitles = (page: Page) => page.locator('[data-done-list] [data-action="edit"]');
export const box = (page: Page, title: string) =>
  page.getByRole('checkbox', { name: `Done: ${title}`, exact: true });
export const chip = (page: Page, name: string) =>
  page.locator('[data-views] button').filter({ hasText: new RegExp(`^${name}\\s*\\d+$`) });

export async function addTask(page: Page, title: string): Promise<void> {
  await page.getByLabel('New task').fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

/** A task with every field set; tests change only what matters to them. */
const sample = (task: Partial<Task>, index: number): Task => ({
  id: `seed-${index}`,
  title: 'Task',
  notes: '',
  list: '',
  important: false,
  date: null,
  time: null,
  repeat: 'none',
  reminder: null,
  done: null,
  created: 1_000 + index,
  updated: 1_000 + index,
  ...task,
});

/** Saves tasks (and lists) straight into storage, then reloads. */
export async function seed(page: Page, tasks: Partial<Task>[], lists: List[] = []): Promise<void> {
  await page.evaluate(
    ([data, listsData]) => {
      localStorage.setItem('shkriuss:tasks', JSON.stringify({ v: 1, data }));
      localStorage.setItem('shkriuss:task-lists', JSON.stringify({ v: 1, data: listsData }));
    },
    [{ tasks: tasks.map(sample) }, { lists }] as const,
  );
  await page.reload();
}
