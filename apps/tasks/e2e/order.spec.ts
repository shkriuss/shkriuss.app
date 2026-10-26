// "My order": tasks in your own order, moved by dragging their handle, by
// Move up / Move down (tap the handle), or by the arrow keys on the handle.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { row, seed, titles } from './helpers.ts';

const handle = (page: Page, title: string) =>
  page.getByRole('button', { name: `Move ${title}`, exact: true });
const order = (page: Page) => page.getByLabel('Order', { exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { title: 'Write report' },
    { title: 'Call mum' },
    { title: 'Buy bread' },
    { title: 'Pay rent' },
    { title: 'Old thing', done: 5 },
  ]);
});

test('moves tasks with the arrow keys and Move up / Move down, and remembers', async ({ page }) => {
  // By date: no handles.
  await expect(order(page)).toHaveValue('date');
  await expect(handle(page, 'Pay rent')).toBeHidden();
  await order(page).selectOption({ label: 'My order' });
  await expect(page.locator('[data-move-hint]')).toBeVisible();
  await expect(page.locator('[data-group-title]')).toHaveCount(0);
  await expect(titles(page)).toHaveText(['Write report', 'Call mum', 'Buy bread', 'Pay rent']);
  // Done tasks don't move.
  await page.locator('[data-done-summary]').click();
  await expect(handle(page, 'Old thing')).toBeHidden();

  // Arrow keys on the handle.
  await handle(page, 'Buy bread').focus();
  await page.keyboard.press('ArrowUp');
  await expect(titles(page)).toHaveText(['Write report', 'Buy bread', 'Call mum', 'Pay rent']);
  await expect(handle(page, 'Buy bread')).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Buy bread: 2 of 4.' })).toBeAttached();
  await handle(page, 'Write report').focus();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByRole('status').filter({ hasText: 'Write report is first already.' }),
  ).toBeAttached();

  // A tap on the handle shows Move up and Move down.
  await handle(page, 'Pay rent').click();
  await expect(handle(page, 'Pay rent')).toHaveAttribute('aria-expanded', 'true');
  const up = page.getByRole('button', { name: 'Move Pay rent up' });
  await expect(up).toBeFocused();
  await up.click();
  await up.click();
  await expect(titles(page)).toHaveText(['Write report', 'Pay rent', 'Buy bread', 'Call mum']);
  await expect(up).toBeFocused();
  await page.getByRole('button', { name: 'Move Pay rent down' }).click();
  await expect(titles(page)).toHaveText(['Write report', 'Buy bread', 'Pay rent', 'Call mum']);
  await handle(page, 'Pay rent').click();
  await expect(up).toBeHidden();

  // Kept, with the choice of order, after a reload.
  await page.reload();
  await expect(order(page)).toHaveValue('mine');
  await expect(titles(page)).toHaveText(['Write report', 'Buy bread', 'Pay rent', 'Call mum']);
  // New tasks come first.
  await page.getByLabel('New task').fill('Book flights');
  await page.getByLabel('New task').press('Enter');
  await expect(titles(page).first()).toHaveText('Book flights');

  await order(page).selectOption({ label: 'By date' });
  await expect(page.locator('[data-group-title]')).toHaveText(['No date']);
  await expect(handle(page, 'Pay rent')).toBeHidden();
});

test('drags a task by its handle', async ({ page }) => {
  await order(page).selectOption({ label: 'My order' });
  // In the middle of the screen, and still (pages scroll smoothly).
  await page
    .locator('[data-ordered]')
    .evaluate((list) => list.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const from = await handle(page, 'Pay rent').boundingBox();
  const to = await row(page, 'Write report').boundingBox();
  if (!from || !to) throw new Error('Not on the page');
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, to.y + 4, { steps: 12 });
  await expect(row(page, 'Pay rent')).toHaveClass(/task--dragging/);
  await page.mouse.up();

  await expect(titles(page)).toHaveText(['Pay rent', 'Write report', 'Call mum', 'Buy bread']);
  await expect(row(page, 'Pay rent')).not.toHaveClass(/task--dragging/);
  await expect(handle(page, 'Pay rent')).toBeFocused();
  // A drag isn't a tap: no Move up / Move down.
  await expect(handle(page, 'Pay rent')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'Pay rent: 1 of 4.' })).toBeAttached();
  await page.reload();
  await expect(titles(page)).toHaveText(['Pay rent', 'Write report', 'Call mum', 'Buy bread']);
});

test('drags with a finger too', async ({ page }) => {
  await order(page).selectOption({ label: 'My order' });
  await page
    .locator('[data-ordered]')
    .evaluate((list) => list.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const from = await handle(page, 'Write report').boundingBox();
  const to = await row(page, 'Buy bread').boundingBox();
  if (!from || !to) throw new Error('Not on the page');
  // A real touch, through the browser's own touch input.
  const touch = await page.context().newCDPSession(page);
  const x = from.x + from.width / 2;
  const point = (y: number) => [{ x, y }];
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.y + from.height / 2),
  });
  for (let step = 1; step <= 12; step += 1) {
    const y =
      from.y + from.height / 2 + ((to.y + to.height - 4 - from.y - from.height / 2) * step) / 12;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y) });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(titles(page)).toHaveText(['Call mum', 'Buy bread', 'Write report', 'Pay rent']);
  // A drag, not a tap: no Move up / Move down.
  await expect(handle(page, 'Write report')).toHaveAttribute('aria-expanded', 'false');
});

test('says which tasks are overdue, as By date does with its heading', async ({ page }) => {
  // My order has no "Overdue" heading: only red, bold text said so (audit 3 G-11).
  await seed(page, [{ title: 'Renew passport', date: '2020-01-06' }, { title: 'Water plants' }]);
  const due = row(page, 'Renew passport').locator('[data-due]');
  await expect(page.locator('[data-group-title]').first()).toHaveText('Overdue');
  await expect(due).toHaveText('Mon, Jan 6, 2020');
  await order(page).selectOption({ label: 'My order' });
  await expect(due).toHaveText('Mon, Jan 6, 2020, overdue');
  await expect(due.locator('.visually-hidden')).toHaveText(', overdue');
});

test('My order is accessible, in both themes', async ({ page }) => {
  await order(page).selectOption({ label: 'My order' });
  await handle(page, 'Call mum').click();
  await checkA11y(page, 'my order');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'my order (dark)');
});
