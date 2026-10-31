/**
 * A list drawn again in the background keeps keyboard focus where it was
 * (audit G-3): after a change in another tab, which runs the same code as a
 * change synced from another device, and when a dialog opened from the list
 * closes. Each app here focuses a control in one of its lists, then another
 * tab changes something.
 */
import type { Locator, Page } from '@playwright/test';
import { forThisSite, type EverySite } from './every-site.ts';
import { expect, test } from './fixtures.ts';
import { jpeg, picture, withExif } from './photos.ts';

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

/** Photos: adds a photo taken at `taken` ("YYYY:MM:DD HH:MM:SS", as a camera writes it). */
async function addPhoto(page: Page, taken: string, color: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Add photos').click();
  const photo = withExif(await picture(page, { width: 400, height: 300, color }), taken);
  await (await chooser).setFiles([jpeg(`${color.slice(1)}.jpg`, photo)]);
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 photo.' })).toBeAttached();
}

/**
 * Photos looks for another tab's changes when it's switched back to (audit
 * J-3), so the first tab is: what the browser does then.
 */
async function switchBackFrom(other: Page): Promise<void> {
  const first = other
    .context()
    .pages()
    .find((open) => open !== other);
  await first?.evaluate(() => window.dispatchEvent(new Event('focus')));
}

const OCTOBER_PHOTO = 'Photo taken Oct 21, 2026, 2:03:22 PM';
const JULY_PHOTO = 'Photo taken Jul 4, 2019, 6:30:05 PM';

interface Case {
  /** Adds what's needed, and gives the control to focus. */
  setup: (page: Page) => Promise<Locator>;
  /** Something changed in another tab. */
  change: (other: Page) => Promise<void>;
  /** What the first tab shows once it has drawn that change. */
  shown: (page: Page) => Locator;
}

/** Every site, and how its list is drawn again by a change in another tab (null: none is). */
const cases: EverySite<Case> = {
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
      // Choose another day without leaving the current month.
      const focused = page.locator('[data-weeks] button[tabindex="0"]');
      await focused.focus();
      const date = await focused.getAttribute('data-date');
      if (!date) throw new Error('Calendar selected day missing');
      await page.keyboard.press(date.endsWith('-01') ? 'ArrowRight' : 'ArrowLeft');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      return page.locator('[data-weeks]').getByRole('button', { name: label ?? '', exact: true });
    },
    change: async (other) => {
      await button(other, 'New event').click();
      await fillDialog(other, { Title: 'Dentist' });
    },
    shown: (page) => page.locator('[data-weeks]').getByRole('button', { name: /today, 1 event/ }),
  },
  grammar: {
    setup: async (page) => {
      // The checker (20 MB) loads first: two tabs loading it at once, or a
      // reload meanwhile, can make one fail.
      test.slow();
      await expect(page.locator('[data-status]')).toHaveText(/^Type or paste/, { timeout: 60_000 });
      // Two words in the dictionary, put there as another tab would.
      await page.evaluate(() => {
        const key = 'shkriuss:grammar';
        const data = { text: '', english: 'american', words: ['Mtskheta', 'Tbilisi'] };
        localStorage.setItem(key, JSON.stringify({ v: 1, data }));
        window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
      });
      return button(page, 'Remove “Mtskheta” from my dictionary');
    },
    // The dictionary is drawn again when the English changes elsewhere (audit 3 G-1).
    change: (other) => other.getByLabel('British (UK)').check(),
    shown: (page) => page.locator('input[name="english"][value="british"]:checked'),
  },
  habits: {
    setup: async (page) => {
      await enter(page, 'New habit', 'Read');
      return button(page, 'Read: done today');
    },
    change: (other) => enter(other, 'New habit', 'Walk'),
    shown: (page) => button(page, 'Walk: done today'),
  },
  // The account and privacy pages have no list that another tab changes.
  hub: null,
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
  // The grid is drawn again the same way after each photo of this device goes
  // online, and after changes from other devices (audit 3 G-1).
  photos: {
    setup: async (page) => {
      await addPhoto(page, '2026:10:21 14:03:22', '#c33');
      return button(page, OCTOBER_PHOTO);
    },
    change: async (other) => {
      await addPhoto(other, '2019:07:04 18:30:05', '#36c');
      await switchBackFrom(other);
    },
    shown: (page) => button(page, JULY_PHOTO),
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
  const app = forThisSite(cases);
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

/** How a site's focused item is taken away in another tab, and what then gets focus. */
interface GoneCase {
  setup: Case['setup'];
  change: Case['change'];
  next: (page: Page) => Locator;
}

/**
 * Every site (null: not scripted here; the test above covers its redraw, and
 * the code that moves focus on is shared), so a new app isn't left out
 * without a word (audit 5 J-10).
 */
const goneCases: EverySite<GoneCase> = {
  budget: null,
  calendar: null,
  grammar: {
    setup: async (page) => {
      test.slow();
      await expect(page.locator('[data-status]')).toHaveText(/^Type or paste/, { timeout: 60_000 });
      await page.evaluate(() => {
        const key = 'shkriuss:grammar';
        const data = { text: '', english: 'american', words: ['Alpha', 'Beta', 'Gamma'] };
        localStorage.setItem(key, JSON.stringify({ v: 1, data }));
        window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
      });
      return button(page, 'Remove “Beta” from my dictionary');
    },
    // Removed from the dictionary in the other tab (or on another device).
    change: (other) => button(other, 'Remove “Beta” from my dictionary').click(),
    next: (page) => button(page, 'Remove “Gamma” from my dictionary'),
  },
  hub: null,
  meals: null,
  notes: null,
  photos: {
    setup: async (page) => {
      await addPhoto(page, '2026:10:21 14:03:22', '#c33');
      await addPhoto(page, '2019:07:04 18:30:05', '#36c');
      return button(page, OCTOBER_PHOTO);
    },
    // Deleted in the other tab, from its viewer.
    change: async (other) => {
      await button(other, OCTOBER_PHOTO).click();
      await other.locator('[data-viewer]').getByRole('button', { name: 'Delete' }).click();
      await other
        .getByRole('dialog', { name: 'Delete this photo?' })
        .getByRole('button', { name: 'Delete' })
        .click();
      await expect(other.locator('[data-viewer-announcer]')).toHaveText(/^Deleted the photo\./);
      await switchBackFrom(other);
    },
    next: (page) => button(page, JULY_PHOTO),
  },
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
  repairs: null,
  shelf: null,
  trades: null,
  // Audit 3 G-3: focus fell to the top of the page.
  tally: {
    setup: async (page) => {
      await enter(page, 'New counter', 'Cups');
      await enter(page, 'New counter', 'Steps');
      return button(page, 'Add 1 to Cups');
    },
    change: async (other) => {
      await button(other, 'Delete Cups').click();
      await other.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    },
    next: (page) => button(page, 'Add 1 to Steps'),
  },
  // These two looked only for the same item again (audit 3 G-3).
  habits: {
    setup: async (page) => {
      await enter(page, 'New habit', 'Read');
      await enter(page, 'New habit', 'Walk');
      return button(page, 'Read: done today');
    },
    // Deleted on the other device.
    change: async (other) => {
      await button(other, 'Edit Read').click();
      await other
        .getByRole('dialog', { name: 'Edit habit' })
        .getByRole('button', { name: 'Delete' })
        .click();
      await other
        .getByRole('dialog', { name: 'Delete this habit?' })
        .getByRole('button', { name: 'Delete' })
        .click();
    },
    next: (page) => button(page, 'Walk: done today'),
  },
  reminders: {
    setup: async (page) => {
      await enter(page, 'Remind me to', 'Call the dentist');
      await enter(page, 'Remind me to', 'Water the plants');
      return page.getByRole('checkbox', { name: 'Call the dentist: done', exact: true });
    },
    change: async (other) => {
      await button(other, 'Call the dentist').click();
      await other
        .getByRole('dialog', { name: 'Change reminder' })
        .getByRole('button', { name: 'Delete' })
        .click();
      await other
        .getByRole('dialog', { name: 'Delete this reminder?' })
        .getByRole('button', { name: 'Delete' })
        .click();
    },
    next: (page) => page.getByRole('checkbox', { name: 'Water the plants: done', exact: true }),
  },
};

test('when the focused item is taken away in another tab, focus goes to the next one', async ({
  page,
}) => {
  const app = forThisSite(goneCases);
  test.skip(!app, 'Not scripted for this site: the test above covers its redraw.');
  if (!app) return;
  await page.goto('/');
  const control = await app.setup(page);
  const other = await secondTab(page);
  await control.focus();

  await app.change(other);
  await expect(control).toHaveCount(0);
  await expect(app.next(page)).toBeFocused();
});

/**
 * Every site's dialog opened from a list (their own close handlers, if any,
 * use returnFocus), or null: no such dialog, or one like another app's that
 * isn't scripted here (audit 5 J-10).
 */
const dialogCases: EverySite<Case> = {
  budget: cases['budget'] ?? null,
  // Its dialogs ("Clear the text?", "Remove Deep check?") aren't opened from a list.
  grammar: null,
  // "Edit habit" opens from its list, like Tasks' editor: not scripted here.
  habits: null,
  // No list, and no dialog opened from one.
  hub: null,
  meals: {
    // A day's "Add a meal".
    setup: (page) => Promise.resolve(button(page, /^Add a meal/).first()),
    change: (other) => enter(other, 'Add to the list', 'Bread'),
    shown: (page) => page.getByRole('checkbox', { name: 'Bread', exact: true }),
  },
  // "Delete this note?" opens from the note, not from the list: not scripted here.
  notes: null,
  // Its dialogs open from the viewer, which the grid opens: not scripted here.
  photos: null,
  // "Change reminder" opens from its list, like Tasks' editor: not scripted here.
  reminders: null,
  repairs: cases['repairs'] ?? null,
  // Its own close handler sent focus to "Add item" after a redraw (audit 3 G-3).
  shelf: cases['shelf'] ?? null,
  // "Delete this counter?" opens from its list, like Tasks' editor: not scripted here.
  tally: null,
  trades: cases['trades'] ?? null,
  // Its only dialog, "Add a drink", isn't opened from a list.
  water: null,
  // These two put focus back themselves, and sent it to a fallback (audit 3 G-3).
  calendar: {
    setup: async (page) => {
      await button(page, 'New event').click();
      await fillDialog(page, { Title: 'Dentist' });
      return page.locator('[data-day-events]').getByRole('button', { name: /Dentist/ });
    },
    change: async (other) => {
      await button(other, 'New event').click();
      await fillDialog(other, { Title: 'Gym' });
    },
    shown: (page) => page.locator('[data-day-events]').getByRole('button', { name: /Gym/ }),
  },
  tasks: {
    setup: async (page) => {
      await enter(page, 'New task', 'Pay rent');
      return button(page, 'Edit Pay rent');
    },
    change: (other) => enter(other, 'New task', 'Buy milk'),
    shown: (page) => button(page, 'Edit Buy milk'),
  },
};

test('a dialog opened from a list gives focus back after the list was drawn again', async ({
  page,
}) => {
  const app = forThisSite(dialogCases);
  test.skip(!app, 'This site has no dialog opened from a list, or one isn’t scripted here.');
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

/**
 * Every site: the apps that draw their lists again when the person comes
 * back to them in a new month (their lists are the month's), or null
 * (audit 5 J-10).
 */
const comingBack: EverySite<Case> = {
  budget: cases['budget'] ?? null,
  trades: cases['trades'] ?? null,
  // The others don't redraw by the month on coming back.
  calendar: null,
  grammar: null,
  habits: null,
  hub: null,
  meals: null,
  notes: null,
  photos: null,
  reminders: null,
  repairs: null,
  shelf: null,
  tally: null,
  tasks: null,
  water: null,
};

test('coming back to the app draws its lists again only in a new month', async ({ page }) => {
  const app = forThisSite(comingBack);
  test.skip(!app, 'This site doesn’t draw its lists again by the month.');
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

test('a control hidden by a change in another tab gives focus to what takes its place', async ({
  page,
}) => {
  // A control still on the page but hidden by the redraw dropped focus to the
  // top of the page (audit 5 G-1). Scripted for Tasks, whose "Rename or
  // delete this list" is hidden once the shown list is deleted elsewhere;
  // the code that moves focus on (keepFocus) is the same in every app.
  test.skip(test.info().project.name !== 'tasks', 'Scripted for Tasks; the code is shared.');
  await page.goto('/');
  await button(page, 'New list').click();
  await fillDialog(page, { Name: 'Work' });
  const editList = button(page, 'Rename or delete this list');
  await expect(editList).toBeVisible();
  const other = await secondTab(page);
  await editList.focus();

  // The other tab (or another device) deletes the list.
  await other.locator('[data-views]').getByRole('button', { name: /^Work/ }).click();
  await button(other, 'Rename or delete this list').click();
  await other
    .getByRole('dialog', { name: 'Edit list' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await other
    .getByRole('dialog', { name: 'Delete this list?' })
    .getByRole('button', { name: 'Delete' })
    .click();

  // The first tab shows every task again and hides the button; focus goes to
  // the heading it gives as the fallback, not to the top of the page.
  await expect(editList).toBeHidden();
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeFocused();
});
