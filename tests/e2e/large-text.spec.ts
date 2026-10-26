/**
 * Large text (audit G-4): on a 360px screen with text at 200%, the project's
 * standard, pages with things in them, and the dialogs they open, fit
 * without sideways scrolling, and no text is squeezed into a column of
 * letters. The shared accessibility test checks the pages empty.
 */
import type { Locator, Page } from '@playwright/test';
import { forThisSite, type EverySite } from './every-site.ts';
import { expect, test } from './fixtures.ts';
import { jpeg, picture } from './photos.ts';

/** A long word, as in a name in German or a pasted link. */
const LONG = 'Supercalifragilisticexpialidocious';

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
  page.getByRole('button', { name, exact: typeof name === 'string' }).first();

/** Opens a dialog with a button on the page, and gives the dialog. */
const opens = (name: string | RegExp) => async (page: Page) => {
  await button(page, name).click();
  return page.locator('dialog[open]');
};

interface Case {
  /** Puts things on the page (at the usual text size). */
  fill: (page: Page) => Promise<void>;
  /** Each opens a dialog, and gives it. */
  dialogs: ((page: Page) => Promise<Locator>)[];
}

/** Every site, and what to put on its page (null: nothing). */
const cases: EverySite<Case> = {
  budget: {
    fill: async (page) => {
      await button(page, 'Add expense').click();
      await fillDialog(page, { Amount: '1234567.89', 'Note (optional)': LONG });
      await button(page, 'New category').click();
      await fillDialog(page, { Name: LONG, 'Monthly limit (optional)': '99999999' });
    },
    dialogs: [opens('Add expense'), opens('New category')],
  },
  calendar: {
    fill: async (page) => {
      await button(page, 'New event').click();
      await fillDialog(page, { Title: LONG });
    },
    dialogs: [opens('New event')],
  },
  grammar: {
    fill: async (page) => {
      // The checker (20 MB) loads first.
      test.slow();
      await expect(page.locator('[data-status]')).toHaveText(/^Type or paste/, { timeout: 60_000 });
      await page.getByLabel('American (US)').check();
      // Suggestions, which quote their sentence, one with a long word in it.
      await page.getByLabel('Your text').fill(`I has a apple. The ${LONG} were here.`);
      await expect(page.locator('[data-status]')).toHaveText(/^\d+ suggestions?\.$/);
    },
    dialogs: [],
  },
  habits: {
    fill: (page) => enter(page, 'New habit', 'Read'),
    dialogs: [opens('Edit Read')],
  },
  // Nothing to put on its pages: the accessibility test checks them with text at 200%.
  hub: null,
  meals: {
    fill: async (page) => {
      await button(page, /^Add a meal/).click();
      await fillDialog(page, { Meal: 'Spaghetti bolognese' });
      await enter(page, 'Add to the list', LONG);
      await button(page, 'New meal').click();
      await fillDialog(page, { Name: LONG, 'Ingredients (optional)': `500 g ${LONG}` });
    },
    dialogs: [opens(/^Add a meal/), opens('New meal')],
  },
  notes: {
    fill: async (page) => {
      await button(page, 'New note').click();
      await page.getByLabel('Title').fill(LONG);
      await button(page, 'All notes').click();
    },
    dialogs: [],
  },
  photos: {
    fill: async (page) => {
      const chooser = page.waitForEvent('filechooser');
      await button(page, 'Add photos').click();
      await (
        await chooser
      ).setFiles([
        jpeg(`${LONG}.jpg`, await picture(page, { width: 400, height: 300 })),
        jpeg('IMG_0002.JPG', await picture(page, { width: 400, height: 300, color: '#36c' })),
      ]);
      await expect(page.locator('[data-months] .tile')).toHaveCount(2);
    },
    dialogs: [
      async (page) => {
        await page.locator('[data-months] .tile').first().click();
        return page.locator('dialog[open]');
      },
    ],
  },
  reminders: {
    fill: (page) => enter(page, 'Remind me to', LONG),
    dialogs: [opens(LONG)],
  },
  repairs: {
    fill: async (page) => {
      await button(page, 'New repair').click();
      await fillDialog(page, {
        Vehicle: LONG,
        'Mileage (km)': '1234567',
        'Damage found': LONG,
        'Labour and other costs (optional)': '1234567.89',
      });
    },
    dialogs: [
      async (page) => {
        await button(page, 'New repair').click();
        await button(page, 'Add a part').click();
        return page.locator('dialog[open]');
      },
      opens('Add vehicle'),
    ],
  },
  shelf: {
    fill: async (page) => {
      await button(page, 'Add item').click();
      await fillDialog(page, { Name: LONG, 'Brand (optional)': LONG });
    },
    dialogs: [opens('Add item')],
  },
  tally: {
    fill: (page) => enter(page, 'New counter', LONG),
    dialogs: [opens(`Delete ${LONG}`)],
  },
  tasks: {
    fill: (page) => enter(page, 'New task', LONG),
    dialogs: [opens(`Edit ${LONG}`)],
  },
  trades: {
    fill: async (page) => {
      await button(page, 'New trade').click();
      const entry = page.getByRole('group', { name: 'Entry' });
      const exit = page.getByRole('group', { name: 'Exit' });
      await page.getByLabel('Symbol').fill('BRK.A');
      await entry.getByLabel('Day').fill('2026-10-01');
      await entry.getByLabel('Price').fill('612345.67');
      await entry.getByLabel('Quantity').fill('100');
      await exit.getByLabel('Day').fill('2026-10-02');
      await exit.getByLabel('Price').fill('712345.67');
      await fillDialog(page, { 'Setup (optional)': LONG });
    },
    dialogs: [opens('New trade')],
  },
  water: {
    fill: async (page) => {
      await button(page, /^Glass/).click();
      await button(page, /^Bottle/).click();
    },
    dialogs: [opens('Other amount')],
  },
};

/** What doesn't fit on the page: sideways scrolling, things past its edge, squeezed text. */
const pageProblems = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    const width = document.documentElement.clientWidth;
    const sideways = document.documentElement.scrollWidth - width;
    if (sideways > 0) found.push(`The page scrolls sideways by ${sideways}px`);
    const name = (element: Element) =>
      `${element.localName}.${String(element.className).split(' ')[0]} "${(element.textContent ?? '').trim().slice(0, 30)}"`;
    for (const element of document.querySelectorAll('main *')) {
      if (element.closest('dialog, .visually-hidden')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > width + 1) found.push(`${name(element)} goes past the edge`);
      // Text squeezed into a column of letters: narrower than two letters, three lines tall.
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim())
        .join('');
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (text.length >= 4 && box.width < size * 1.6 && box.height > size * 3) {
        found.push(`${name(element)} is squeezed into ${Math.round(box.width)}px`);
      }
    }
    return found;
  });

/** What doesn't fit in a dialog: sideways scrolling, or things sticking out of it. */
const dialogProblems = (dialog: Locator) =>
  dialog.evaluate((element) => {
    const found: string[] = [];
    const sideways = element.scrollWidth - element.clientWidth;
    if (sideways > 0) found.push(`The dialog scrolls sideways by ${sideways}px`);
    const outer = element.getBoundingClientRect();
    for (const inner of element.querySelectorAll('*')) {
      if (inner.closest('.visually-hidden')) continue;
      const box = inner.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > outer.right + 1 || box.left < outer.left - 1) {
        found.push(
          `${inner.localName} "${(inner.textContent ?? '').trim().slice(0, 30)}" sticks out`,
        );
      }
    }
    return found;
  });

/** Calendar: each day's number inside its day, and each weekday's name inside its column. */
const calendarOverlaps = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    const inside = (inner: Element, outer: Element) => {
      const a = inner.getBoundingClientRect();
      const b = outer.getBoundingClientRect();
      return a.width === 0 || (a.left >= b.left - 0.5 && a.right <= b.right + 0.5);
    };
    for (const day of document.querySelectorAll('[data-weeks] button')) {
      const number = day.querySelector('.day-cell__number');
      if (number && !inside(number, day)) found.push(`Day ${number.textContent} spills out`);
    }
    for (const heading of document.querySelectorAll('[data-weekdays] th')) {
      for (const name of heading.querySelectorAll('[aria-hidden="true"]')) {
        if (!inside(name, heading)) found.push(`Weekday ${name.textContent} spills out`);
      }
    }
    return found;
  });

test('with text at 200%, pages with things in them, and their dialogs, fit a phone', async ({
  page,
}) => {
  const app = forThisSite(cases);
  test.skip(!app, 'Nothing to put on this page.');
  if (!app) return;
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await app.fill(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  expect(await pageProblems(page), 'The page').toEqual([]);
  if (test.info().project.name === 'calendar') expect(await calendarOverlaps(page)).toEqual([]);
  for (const open of app.dialogs) {
    const dialog = await open(page);
    await expect(dialog).toBeVisible();
    const name = (await dialog.getAttribute('aria-labelledby')) ?? 'a dialog';
    expect(await dialogProblems(dialog), name).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

test('with large text, Tasks’ own order with Move up / Move down open fits', async ({ page }) => {
  // The box, the handle and the two buttons left the title a letter's width,
  // and the page scrolled sideways (audit 3 G-2).
  test.skip(test.info().project.name !== 'tasks', 'Only Tasks has its own order.');
  await page.goto('/');
  await enter(page, 'New task', LONG);
  await enter(page, 'New task', 'Call mum');
  await page.getByLabel('Order').selectOption('mine');
  await button(page, `Move ${LONG}`).click();
  await expect(button(page, `Move ${LONG} up`)).toBeVisible();
  for (const [width, size] of [
    [360, '200%'],
    [360, '150%'],
    [412, '200%'],
    [412, '175%'],
    [320, '100%'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((textSize) => {
      document.documentElement.style.fontSize = textSize;
    }, size);
    expect(await pageProblems(page), `${width}px, text ${size}`).toEqual([]);
  }
});

test('with text at 175% on a 412px screen, Calendar’s weekdays and days fit', async ({ page }) => {
  // Weekday names ran together from 175% on ordinary phones (audit G-4).
  test.skip(test.info().project.name !== 'calendar', 'Only Calendar has a month grid.');
  for (const [width, size] of [
    [412, '175%'],
    [360, '150%'],
    [320, '100%'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.evaluate((textSize) => {
      document.documentElement.style.fontSize = textSize;
    }, size);
    expect(await calendarOverlaps(page), `${width}px, text ${size}`).toEqual([]);
  }
});
