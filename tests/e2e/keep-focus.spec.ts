/**
 * A list drawn again in the background keeps keyboard focus where it was
 * (audit G-3): after a change in another tab, which runs the same code as a
 * change synced from another device, and when a dialog opened from the list
 * closes. Each app here focuses a control in one of its lists, then another
 * tab changes something.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/** Types into a text field and presses Enter (which adds it, in these apps). */
async function enter(page: Page, label: string, text: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true }).first();
  await field.fill(text);
  await field.press('Enter');
}

/** Fills in the open dialog's fields (by label) and presses its Save button. */
async function fillDialog(page: Page, fields: Record<string, string>): Promise<void> {
  const dialog = page.getByRole('dialog');
  for (const [label, value] of Object.entries(fields)) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

async function addExpense(page: Page, amount: string, note: string): Promise<void> {
  await button(page, 'Add expense').click();
  await fillDialog(page, { Amount: amount, 'Note (optional)': note });
}

async function openTrade(page: Page, symbol: string): Promise<void> {
  await button(page, 'New trade').click();
  const entry = page.getByRole('group', { name: 'Entry' });
  await page.getByLabel('Symbol').fill(symbol);
  await entry.getByLabel('Day').fill('2026-10-20');
  await entry.getByLabel('Price').fill('100');
  await entry.getByLabel('Quantity').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function addVehicle(page: Page, name: string): Promise<void> {
  await button(page, 'Add vehicle').click();
  await fillDialog(page, { 'Name or number': name });
}

async function addItem(page: Page, name: string): Promise<void> {
  await button(page, 'Add item').click();
  await fillDialog(page, { Name: name });
}

async function twoTasks(page: Page): Promise<Locator> {
  await enter(page, 'New task', 'Pay rent');
  await enter(page, 'New task', 'Call mum');
  return page.getByRole('checkbox', { name: 'Done: Pay rent', exact: true });
}

interface Case {
  /** Adds what's needed, and gives the control to focus. */
  setup: (page: Page) => Promise<Locator>;
  /** Something changed in another tab. */
  change: (other: Page) => Promise<void>;
  /** What the first tab shows once it has drawn that change. */
  shown: (page: Page) => Locator;
}

const cases: Record<string, Case> = {
  budget: {
    setup: async (page) => {
      await addExpense(page, '5', 'Lunch');
      return page.locator('[data-entries]').getByRole('button', { name: /Lunch/ });
    },
    change: async (other) => {
      await button(other, 'Add income').click();
      await fillDialog(other, { Amount: '50' });
    },
    shown: (page) => page.locator('[data-entries]').getByRole('button', { name: /^Income/ }),
  },
  calendar: {
    setup: async (page) => {
      // A day in the month, chosen with the arrow keys.
      await page.locator('[data-weeks] button[tabindex="0"]').focus();
      await page.keyboard.press('ArrowRight');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      return page.locator('[data-weeks]').getByRole('button', { name: label ?? '', exact: true });
    },
    change: async (other) => {
      await button(other, 'New event').click();
      await fillDialog(other, { Title: 'Dentist' });
    },
    shown: (page) => page.locator('[data-weeks]').getByRole('button', { name: /today, 1 event/ }),
  },
  habits: {
    setup: async (page) => {
      await enter(page, 'New habit', 'Read');
      return button(page, 'Read: done today');
    },
    change: (other) => enter(other, 'New habit', 'Walk'),
    shown: (page) => button(page, 'Walk: done today'),
  },
  meals: {
    setup: async (page) => {
      await enter(page, 'Add to the list', 'Milk');
      return page.getByRole('checkbox', { name: 'Milk', exact: true });
    },
    change: (other) => enter(other, 'Add to the list', 'Bread'),
    shown: (page) => page.getByRole('checkbox', { name: 'Bread', exact: true }),
  },
  notes: {
    setup: async (page) => {
      await button(page, 'New note').click();
      await page.getByLabel('Title').fill('Shopping');
      await button(page, 'All notes').click();
      return page.getByRole('link', { name: 'Shopping', exact: true });
    },
    change: async (other) => {
      await button(other, 'New note').click();
      await other.getByLabel('Title').fill('Holidays');
    },
    shown: (page) => page.getByRole('link', { name: 'Holidays', exact: true }),
  },
  reminders: {
    setup: async (page) => {
      await enter(page, 'Remind me to', 'Call the dentist');
      return page.getByRole('checkbox', { name: 'Call the dentist: done', exact: true });
    },
    change: (other) => enter(other, 'Remind me to', 'Water the plants'),
    shown: (page) => button(page, 'Water the plants'),
  },
  repairs: {
    setup: async (page) => {
      await addVehicle(page, 'Bus 105');
      return button(page, 'Edit Bus 105');
    },
    change: (other) => addVehicle(other, 'Bus 7'),
    shown: (page) => button(page, 'Edit Bus 7'),
  },
  shelf: {
    setup: async (page) => {
      await addItem(page, 'Olive oil');
      return button(page, 'Edit Olive oil');
    },
    change: (other) => addItem(other, 'Tea'),
    shown: (page) => button(page, 'Edit Tea'),
  },
  tally: {
    setup: async (page) => {
      await enter(page, 'New counter', 'Cups');
      return button(page, 'Add 1 to Cups');
    },
    change: (other) => enter(other, 'New counter', 'Steps'),
    shown: (page) => button(page, 'Add 1 to Steps'),
  },
  tasks: {
    setup: twoTasks,
    change: (other) => enter(other, 'New task', 'Buy milk'),
    shown: (page) => button(page, 'Edit Buy milk'),
  },
  trades: {
    setup: async (page) => {
      await openTrade(page, 'AAPL');
      return button(page, 'Close the AAPL trade');
    },
    change: (other) => openTrade(other, 'MSFT'),
    shown: (page) => button(page, 'Close the MSFT trade'),
  },
  water: {
    setup: async (page) => {
      await button(page, /^Glass/).click();
      return button(page, /^Remove 250 ml/);
    },
    change: (other) => button(other, /^Bottle/).click(),
    shown: (page) => button(page, /^Remove 500 ml/),
  },
};

/** Remembers the element that has focus now, to tell it from a new copy later. */
const markFocused = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { focusedBefore: Element | null }).focusedBefore = document.activeElement;
  });
const sameFocused = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement ===
      (window as unknown as { focusedBefore: Element | null }).focusedBefore,
  );

/** Opens a second tab of the same app, as on another device with sync. */
async function secondTab(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await other.goto('/');
  await page.bringToFront();
  return other;
}

test('a list drawn again after a change in another tab keeps keyboard focus', async ({ page }) => {
  const app = cases[test.info().project.name];
  test.skip(!app, 'This site has no list that changes in the background.');
  if (!app) return;
  await page.goto('/');
  const control = await app.setup(page);
  const other = await secondTab(page);
  await control.focus();
  await markFocused(page);

  await app.change(other);
  await expect(app.shown(page)).toBeAttached();
  // The list was drawn again, and focus is on the new copy of the same control.
  expect(await sameFocused(page)).toBe(false);
  await expect(control).toBeFocused();
});

/** Apps whose focused item can be taken away in another tab, and what then gets focus. */
const goneCases: Record<
  string,
  {
    setup: Case['setup'];
    change: Case['change'];
    next: (page: Page) => Locator;
  }
> = {
  tasks: {
    setup: twoTasks,
    // Ticked off on the other device: it leaves the tasks to do.
    change: (other) => other.getByRole('checkbox', { name: 'Done: Pay rent', exact: true }).click(),
    next: (page) => page.getByRole('checkbox', { name: 'Done: Call mum', exact: true }),
  },
  water: {
    setup: async (page) => {
      await button(page, /^Glass/).click();
      await button(page, /^Bottle/).click();
      // The latest first.
      return button(page, /^Remove 500 ml/);
    },
    change: (other) => button(other, /^Remove 500 ml/).click(),
    next: (page) => button(page, /^Remove 250 ml/),
  },
};

test('when the focused item is taken away in another tab, focus goes to the next one', async ({
  page,
}) => {
  const app = goneCases[test.info().project.name];
  test.skip(!app, 'Tested on a few apps.');
  if (!app) return;
  await page.goto('/');
  const control = await app.setup(page);
  const other = await secondTab(page);
  await control.focus();

  await app.change(other);
  await expect(control).toHaveCount(0);
  await expect(app.next(page)).toBeFocused();
});

/** Apps with a dialog opened from a list (and nothing of their own to put focus back). */
const dialogCases: Record<string, Case | undefined> = {
  budget: cases['budget'],
  meals: {
    // A day's "Add a meal".
    setup: (page) => Promise.resolve(button(page, /^Add a meal/).first()),
    change: (other) => enter(other, 'Add to the list', 'Bread'),
    shown: (page) => page.getByRole('checkbox', { name: 'Bread', exact: true }),
  },
  repairs: cases['repairs'],
  trades: cases['trades'],
};

test('a dialog opened from a list gives focus back after the list was drawn again', async ({
  page,
}) => {
  const app = dialogCases[test.info().project.name];
  test.skip(!app, 'This site has no dialog opened from a list that changes in the background.');
  if (!app) return;
  await page.goto('/');
  const control = await app.setup(page);
  const other = await secondTab(page);
  await control.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();

  await app.change(other);
  await expect(app.shown(page)).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(control).toBeFocused();
});

/** Apps that draw their lists again when the person comes back to them in a new month. */
const comingBack = ['budget', 'trades'];

test('coming back to the app draws its lists again only in a new month', async ({ page }) => {
  const name = test.info().project.name;
  const app = cases[name];
  test.skip(!app || !comingBack.includes(name), 'Only some apps do this.');
  if (!app) return;
  await page.clock.install({ time: new Date('2026-10-21T10:00:00') });
  await page.goto('/');
  const control = await app.setup(page);
  await control.focus();
  await markFocused(page);
  // What the browser does when the person switches back to the app.
  const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await comeBack();
  expect(await sameFocused(page)).toBe(true);

  await page.clock.setSystemTime(new Date('2026-11-02T10:00:00'));
  await comeBack();
  expect(await sameFocused(page)).toBe(false);
  await expect(control).toBeFocused();
});
