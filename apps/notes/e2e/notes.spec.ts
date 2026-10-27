// Notes: writing, finding, pinning and deleting notes, and the back button.
// Shared checks (accessibility, security headers, offline, privacy) run for
// every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { paste } from '../../../tests/e2e/clipboard.ts';
import { checkA11y, expect, failedSaves, failSaving, test } from '../../../tests/e2e/fixtures.ts';
import { fillStorage } from '../../../tests/e2e/storage.ts';

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

test('says when a pasted title or note doesn’t all fit', async ({ page }) => {
  // Each box takes so much; the browser keeps the start of a longer paste,
  // and nothing said so (audit F3-3).
  await page.getByRole('button', { name: 'New note' }).click();
  const title = 'A long title. '.repeat(20);
  await paste(titleBox(page), title);
  await expect(titleBox(page)).toHaveValue(title.slice(0, 200));
  const titleCut =
    'Only part of that fit. This box takes up to 200 characters, so the rest wasn’t added.';
  await expect(page.getByText(titleCut, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: `Title: ${titleCut}` })).toBeAttached();

  await expect(bodyBox(page)).toHaveAccessibleDescription(
    'Up to 100,000 characters, about 50 pages.',
  );
  await paste(bodyBox(page), 'Some words. '.repeat(9_000));
  const bodyCut =
    'Only part of that fit. This box takes up to 100,000 characters, so the rest wasn’t added.';
  await expect(page.getByText(bodyCut, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: `Note: ${bodyCut}` })).toBeAttached();
  await checkA11y(page, 'editor: pastes that didn’t all fit');

  // Another note opens without them.
  await page.getByRole('button', { name: 'All notes' }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByText(titleCut, { exact: true })).toBeHidden();
  await expect(page.getByText(bodyCut, { exact: true })).toBeHidden();
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

test('the Pin button shows a pin made elsewhere while typing', async ({ page }) => {
  // Typing here waits a moment before it's saved: that moment is held still below.
  await page.clock.install();
  await page.reload();
  await writeNote(page, 'Trip', 'Pack bags');
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  // Typing here, not saved yet, when the other tab pins the note.
  await bodyBox(page).pressSequentially(' and tickets');
  await other.getByRole('button', { name: 'Pin' }).click();
  const pin = page.getByRole('button', { name: 'Pin' });
  // The button shows it, so a tap unpins it, as it says (audit F3-9).
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(card(page, 'Trip').locator('[data-pinned]')).toBeHidden();
});

test('a new note left empty goes with the page', async ({ page }) => {
  // Closed or reloaded in a new note: it was left in the list, and synced
  // (audit F3-9).
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(titleBox(page)).toBeFocused();
  await page.reload();
  await expect(page.getByText('No notes yet')).toBeVisible();
  // Not said to be missing: it was only empty.
  await expect(page.getByRole('alert')).toHaveCount(0);

  // One left behind by a page that couldn't drop it (closed by the system,
  // or by an older version) goes the next time Notes opens, once it's had a while.
  await page.evaluate(() => {
    const note = (id: string, title: string, updated: number) => ({
      id,
      title,
      body: '',
      created: updated,
      updated,
      pinned: false,
    });
    const old = Date.now() - 60 * 60 * 1000;
    const notes = [note('a', '', old), note('b', 'Kept', old), note('c', '', Date.now())];
    localStorage.setItem('shkriuss:notes', JSON.stringify({ v: 2, data: { notes } }));
  });
  await page.reload();
  expect(await titles(page)).toEqual(['New note', 'Kept']);
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

  // More typing doesn't read it out again at every pause: it's the same
  // notice, once Notes has tried to save that too.
  await problem.evaluate((element) => element.setAttribute('data-first', ''));
  const tries = await failedSaves(page);
  await bodyBox(page).pressSequentially(', tea');
  await expect.poll(() => failedSaves(page)).toBeGreaterThan(tries);
  await expect(page.locator('[data-edited]')).toHaveText('Not saved');
  await expect(problem).toHaveAttribute('data-first', '');

  // Still shown on the list.
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(problem).toBeVisible();
  await page.reload();
  await card(page, 'Shopping').getByRole('link').click();
  await expect(bodyBox(page)).toHaveValue('');
});

test.describe('with the device full (audit 4 F3-1)', () => {
  const edited = (page: Page) => page.locator('[data-edited]');
  const savedNotes = (page: Page) =>
    page.evaluate(() =>
      (
        JSON.parse(localStorage.getItem('shkriuss:notes') ?? 'null') as {
          data: { notes: { title: string; body: string }[] };
        }
      ).data.notes.map((note) => `${note.title} | ${note.body}`),
    );

  /** Deletes a note in another tab (what a sync from another device does too). */
  async function deleteElsewhere(page: Page, title: string): Promise<void> {
    const other = await page.context().newPage();
    await other.goto('/');
    await other.getByRole('link', { name: title, exact: true }).click();
    await other.getByRole('button', { name: 'Delete', exact: true }).click();
    await other
      .getByRole('dialog', { name: 'Delete this note?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(other.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    await other.close();
  }

  test('typing that couldn’t be saved stays, through a change saved elsewhere', async ({
    page,
  }) => {
    // Before, the note's saved text came back into the box, and the typing was lost.
    await writeNote(page, 'Keep', 'A short note.');
    await writeNote(page, 'Old', 'x'.repeat(2000));
    await writeNote(page, 'Diary', 'Start');
    await fillStorage(page, 10);
    await page.getByRole('link', { name: 'Diary', exact: true }).click();
    await bodyBox(page).press('End');
    await bodyBox(page).pressSequentially(' — what I wrote today.');
    await expect(edited(page)).toHaveText('Not saved');

    // Another tab shortens another note: that saves, as it takes less room,
    // but leaves too little for the typing.
    const other = await page.context().newPage();
    await other.goto('/');
    await other.getByRole('link', { name: 'Keep', exact: true }).click();
    await bodyBox(other).fill('Short.');
    await other.getByRole('button', { name: 'All notes' }).click();
    await expect.poll(() => savedNotes(page)).toContain('Keep | Short.');
    await other.close();
    await expect(bodyBox(page)).toHaveValue('Start — what I wrote today.');
    await expect(edited(page)).toHaveText('Not saved');

    // Room again (a big note deleted elsewhere): the typing is saved.
    await deleteElsewhere(page, 'Old');
    await expect(edited(page)).toHaveText(/^Edited /);
    await expect(bodyBox(page)).toHaveValue('Start — what I wrote today.');
    expect(await savedNotes(page)).toContain('Diary | Start — what I wrote today.');
  });

  test('typing on after a save that failed isn’t taken for a change made elsewhere', async ({
    page,
  }) => {
    // Before, the typing that wasn't saved was taken for the note as it was,
    // and the saved note for another device's version: a false second version.
    await page.clock.install();
    await page.reload();
    await writeNote(page, 'Old', 'x'.repeat(2000));
    await writeNote(page, 'Diary', 'Start');
    await fillStorage(page, 10);
    await page.getByRole('link', { name: 'Diary', exact: true }).click();
    await bodyBox(page).press('End');
    await bodyBox(page).pressSequentially(' first part');
    // The save after the pause: it fails.
    await page.clock.runFor(600);
    await expect(edited(page)).toHaveText('Not saved');
    // Typing on, not saved yet, when another tab makes room.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 10_000);
    await bodyBox(page).pressSequentially(' second part');
    await deleteElsewhere(page, 'Old');

    await expect.poll(() => savedNotes(page)).toEqual(['Diary | Start first part second part']);
    await expect(page.locator('[data-announcer]')).not.toHaveText(/changed on another device/);
  });

  test('typing that still can’t be saved when its note is left is said to be gone', async ({
    page,
  }) => {
    // Before, it stayed in memory only: the note opened again showed it as if
    // saved, typing on took it for the saved note (a false second version
    // came next), and a change from elsewhere put the saved text back.
    await writeNote(page, 'Old', 'x'.repeat(2000));
    await writeNote(page, 'Diary', 'Start');
    await fillStorage(page, 10);
    await page.getByRole('link', { name: 'Diary', exact: true }).click();
    await bodyBox(page).press('End');
    await bodyBox(page).pressSequentially(' — what I wrote today.');
    await expect(edited(page)).toHaveText('Not saved');
    await page.getByRole('button', { name: 'All notes' }).click();
    await expect(page.locator('[data-problem]')).toContainText(
      'Your last changes to “Diary” are gone. Couldn’t save: there’s no room left',
    );

    // Opened again: as the device has it.
    await page.getByRole('link', { name: 'Diary', exact: true }).click();
    await expect(bodyBox(page)).toHaveValue('Start');
    await bodyBox(page).press('End');
    await bodyBox(page).pressSequentially(' — and some more.');
    await expect(edited(page)).toHaveText('Not saved');
    // Room again: the typing is saved, and no second version is made.
    await deleteElsewhere(page, 'Old');
    await expect(edited(page)).toHaveText(/^Edited /);
    expect(await savedNotes(page)).toEqual(['Diary | Start — and some more.']);
    await expect(page.locator('[data-announcer]')).not.toHaveText(/changed on another device/);
  });
});
