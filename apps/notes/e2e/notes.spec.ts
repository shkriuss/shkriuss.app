// Notes: writing, finding, pinning and deleting notes, and the back button.
// Shared checks (accessibility, security headers, offline, privacy) run for
// every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { checkA11y, expect, failSaving, test } from '../../../tests/e2e/fixtures.ts';

const titleBox = (page: Page) => page.getByRole('textbox', { name: 'Title' });
const bodyBox = (page: Page) => page.getByRole('textbox', { name: 'Note' });
const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });
const links = (page: Page) => page.locator('[data-notes] [data-open]');
const titles = (page: Page) => links(page).allTextContents();

/** Writes a new note and goes back to the list. */
async function writeNote(page: Page, title: string, body = ''): Promise<void> {
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(titleBox(page)).toBeFocused();
  await titleBox(page).fill(title);
  if (body) await bodyBox(page).fill(body);
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('writes a note, lists its title, and keeps it after a reload', async ({ page }) => {
  await expect(page.getByText('No notes yet')).toBeVisible();
  await expect(page.getByLabel('Search notes')).toBeHidden();
  await checkA11y(page, 'no notes');

  await page.getByRole('button', { name: 'New note' }).click();
  await expect(titleBox(page)).toBeFocused();
  expect(page.url()).toMatch(/#note=[\w-]+$/);
  await checkA11y(page, 'editor (new note)');
  await titleBox(page).fill('Shopping list');
  // Enter in the title goes on to the note.
  await titleBox(page).press('Enter');
  await expect(bodyBox(page)).toBeFocused();
  await bodyBox(page).fill('Milk\nEggs and bread');
  await expect(page.getByText(/^Edited /)).toBeVisible();
  await expect(page).toHaveTitle('Shopping list · Notes');

  await page.getByRole('button', { name: 'All notes' }).click();
  const shopping = card(page, 'Shopping list');
  await expect(shopping).toHaveText('Shopping list');
  await expect(shopping.getByRole('link')).toBeFocused();
  await expect(page.getByText('No notes yet')).toBeHidden();

  await page.reload();
  await card(page, 'Shopping list').getByRole('link').click();
  await expect(titleBox(page)).toHaveValue('Shopping list');
  await expect(bodyBox(page)).toHaveValue('Milk\nEggs and bread');
  // Opening a note to read it doesn't jump into a text box (no keyboard on phones).
  await expect(page.getByRole('region', { name: 'Note' })).toBeFocused();
});

test('lists a note without a title by the start of its text', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click();
  await bodyBox(page).fill('Call the dentist\nTuesday morning');
  await page.getByRole('button', { name: 'All notes' }).click();
  expect(await titles(page)).toEqual(['Call the dentist']);
});

test('the back button returns to the list, and empty notes are dropped', async ({ page }) => {
  await writeNote(page, 'First');
  await card(page, 'First').getByRole('link').click();
  await expect(titleBox(page)).toBeVisible();
  await page.goBack();
  await expect(card(page, 'First')).toBeVisible();
  await page.goForward();
  await expect(titleBox(page)).toHaveValue('First');
  await page.goBack();

  // A note left empty isn't kept.
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('button', { name: 'All notes' }).click();
  expect(await titles(page)).toEqual(['First']);
  await expect(page.getByRole('button', { name: 'New note' })).toBeFocused();
});

test('saves typing straight away when leaving the page', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).pressSequentially('Typed fast');
  await page.reload();
  await expect(titleBox(page)).toHaveValue('Typed fast');
});

test('finds notes by title or text, ignoring case and accents', async ({ page }) => {
  await writeNote(page, 'Café ideas', 'Oat milk latte');
  await writeNote(page, 'Packing', 'Passport, charger');
  const searchBox = page.getByLabel('Search notes');
  await searchBox.fill('cafe');
  await expect(links(page)).toHaveText(['Café ideas']);
  await expect(page.getByRole('status').filter({ hasText: '1 note found.' })).toBeAttached();
  await searchBox.fill('passport');
  await expect(links(page)).toHaveText(['Packing']);
  await searchBox.fill('tea');
  await expect(page.getByText('No notes match “tea”.')).toBeVisible();
  await searchBox.fill('');
  await expect(links(page)).toHaveText(['Packing', 'Café ideas']);
});

test('long lists show 100 notes at a time', async ({ page }) => {
  await page.evaluate(() => {
    // Note 1 is the oldest, so it comes last.
    const notes = Array.from({ length: 105 }, (_, index) => ({
      id: `note-${index + 1}`,
      title: `Note ${index + 1}`,
      body: '',
      created: index + 1,
      updated: index + 1,
      pinned: false,
    }));
    localStorage.setItem('shkriuss:notes', JSON.stringify({ v: 2, data: { notes } }));
  });
  await page.reload();
  await expect(links(page)).toHaveCount(100);
  const more = page.getByRole('button', { name: 'Show more notes' });
  await more.click();
  await expect(links(page)).toHaveCount(105);
  // Focus goes to the first note just shown.
  await expect(links(page).nth(100)).toBeFocused();
  await expect(links(page).nth(100)).toHaveText('Note 5');
  await expect(more).toBeHidden();

  // Back from a note far down: it's still there, with focus on it.
  await card(page, 'Note 2').getByRole('link').click();
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(card(page, 'Note 2').getByRole('link')).toBeFocused();

  // A new search starts at the first page again.
  await page.getByLabel('Search notes').fill('note');
  await expect(links(page)).toHaveCount(100);
  await expect(more).toBeVisible();
});

test('shows Hebrew or Arabic the right way round, and English as before', async ({ page }) => {
  const rightToLeft = (element: HTMLElement | SVGElement) => element.matches(':dir(rtl)');
  await writeNote(page, 'שלום עולם!', 'Hello world!');
  const link = card(page, 'שלום עולם!').getByRole('link');
  expect(await link.evaluate(rightToLeft)).toBe(true);
  await link.click();
  expect(await titleBox(page).evaluate(rightToLeft)).toBe(true);
  expect(await bodyBox(page).evaluate(rightToLeft)).toBe(false);
});

test('pinned notes come first', async ({ page }) => {
  await writeNote(page, 'Older');
  await writeNote(page, 'Newer');
  expect(await titles(page)).toEqual(['Newer', 'Older']);

  await card(page, 'Older').getByRole('link').click();
  const pin = page.getByRole('button', { name: 'Pin' });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All notes' }).click();
  expect(await titles(page)).toEqual(['Older', 'Newer']);
  await expect(card(page, 'Older').getByRole('img', { name: 'Pinned' })).toBeVisible();
  await expect(card(page, 'Newer').getByRole('img', { name: 'Pinned' })).toBeHidden();
  await checkA11y(page, 'with notes');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with notes (dark)');
  await card(page, 'Older').getByRole('link').click();
  await checkA11y(page, 'editor (dark, pinned)');
});

test('deletes a note after asking', async ({ page }) => {
  await writeNote(page, 'Keep me');
  await writeNote(page, 'Delete me', 'Old stuff');
  await card(page, 'Delete me').getByRole('link').click();
  await expect(titleBox(page)).toHaveValue('Delete me');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this note?' });
  await expect(dialog).toContainText('“Delete me” will be removed.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(bodyBox(page)).toHaveValue('Old stuff');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Delete me')).toBeHidden();
  expect(await titles(page)).toEqual(['Keep me']);
  await expect(page.getByRole('status').filter({ hasText: 'Note deleted.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'New note' })).toBeFocused();
  expect(page.url()).not.toContain('#note=');
});

test('says when a note link is for a note that isn’t here', async ({ page }) => {
  await page.goto('/#note=not-here');
  await expect(page.getByText('That note isn’t on this device.')).toBeVisible();
  expect(page.url()).not.toContain('#note=');
});

test('opens a note from its address, and "All notes" stays in the app', async ({ page }) => {
  await writeNote(page, 'Linked');
  await card(page, 'Linked').getByRole('link').click();
  const address = page.url();
  await page.goto('about:blank');
  await page.goto(address);
  await expect(titleBox(page)).toHaveValue('Linked');
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(card(page, 'Linked')).toBeVisible();
  expect(page.url()).not.toContain('#note=');
});

test('keeps notes saved by the first version, splitting off their titles', async ({ page }) => {
  await page.evaluate(() => {
    const note = (id: string, text: string) => ({
      id,
      text,
      created: 1,
      updated: Date.now(),
      pinned: false,
    });
    localStorage.setItem(
      'shkriuss:notes',
      JSON.stringify({ v: 1, data: { notes: [note('a', 'Groceries\nMilk\nEggs')] } }),
    );
  });
  await page.reload();
  expect(await titles(page)).toEqual(['Groceries']);
  await card(page, 'Groceries').getByRole('link').click();
  await expect(titleBox(page)).toHaveValue('Groceries');
  await expect(bodyBox(page)).toHaveValue('Milk\nEggs');
});

test('typing doesn’t overwrite a change made elsewhere: that version is kept too', async ({
  page,
}) => {
  // Typing here waits a moment before it's saved: that moment is held still below.
  await page.clock.install();
  await page.reload();
  await writeNote(page, 'Trip', 'Pack bags');
  // The same note open in a second tab (the same as a sync bringing a change).
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  // install() lets time run on: stop it, or on a busy machine typing here
  // can be saved before the other tab's change.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  // Typing here, not saved yet, when the other tab saves its change.
  await bodyBox(page).pressSequentially(' and tickets');
  await bodyBox(other).fill('Pack bags and passports');
  await other.getByRole('button', { name: 'All notes' }).click();

  await page.getByRole('button', { name: 'All notes' }).click();
  await expect
    .poll(async () => (await titles(page)).sort())
    .toEqual(['Trip', 'Trip (second version)']);
  await card(page, 'Trip').getByRole('link').click();
  await expect(bodyBox(page)).toHaveValue('Pack bags and tickets');
  await page.getByRole('button', { name: 'All notes' }).click();
  await card(page, 'Trip (second version)').getByRole('link').click();
  await expect(bodyBox(page)).toHaveValue('Pack bags and passports');
});

test('says so in the editor when typing can’t be saved', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Shopping');
  await expect(page.locator('[data-edited]')).toHaveText(/^Edited /);
  await failSaving(page);
  await bodyBox(page).fill('Milk, eggs, bread');

  // Seen in the editor, read out, and not "Edited" as if it were kept (audit G-1).
  const problem = page.getByRole('alert');
  await expect(problem).toBeVisible();
  await expect(problem).toHaveText(/^Couldn’t save/);
  await expect(page.locator('[data-edited]')).toHaveText('Not saved');
  await expect(bodyBox(page)).toBeFocused();

  // More typing doesn't read it out again at every pause: it's the same notice.
  await problem.evaluate((element) => element.setAttribute('data-first', ''));
  await bodyBox(page).pressSequentially(', tea');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-edited]')).toHaveText('Not saved');
  await expect(problem).toHaveAttribute('data-first', '');

  // Still shown on the list.
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(problem).toBeVisible();
  await page.reload();
  await card(page, 'Shopping').getByRole('link').click();
  await expect(bodyBox(page)).toHaveValue('');
});
