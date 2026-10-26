// Notes syncing between two devices through the account (packages/sync,
// docs/adr/0010). The connect flow itself is tested for every app in
// tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  expectSealed,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const titleBox = (page: Page) => page.getByRole('textbox', { name: 'Title' });
const bodyBox = (page: Page) => page.getByRole('textbox', { name: 'Note' });
const link = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true });
const titles = (page: Page) => page.locator('[data-notes] [data-open]').allTextContents();
const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
/** The notes saved on this device, as "title | text", sorted. */
const savedNotes = (page: Page) =>
  page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('shkriuss:notes') ?? 'null') as {
      data: { notes: { title: string; body: string }[] };
    } | null;
    return (saved?.data.notes ?? []).map((note) => `${note.title} | ${note.body}`).sort();
  });

/** Two devices on one account, both syncing Notes. */
async function twoDevices(page: Page, browser: Parameters<typeof otherDevice>[0]) {
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Notes');
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Notes');
  return tablet;
}

/** Opens a note, changes its text, and goes back once it's uploaded. */
async function editBody(page: Page, title: string, body: string): Promise<void> {
  await link(page, title).click();
  const upload = uploaded(page);
  await bodyBox(page).fill(body);
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
}

test('notes, edits and deletions reach the other device', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const tablet = await twoDevices(page, browser);

  let upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Trip plan');
  await bodyBox(page).fill('Book the train');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await link(tablet, 'Trip plan').click();
  await expect(bodyBox(tablet)).toHaveValue('Book the train');
  await tablet.getByRole('button', { name: 'All notes' }).click();

  // Edited on the tablet, while the phone shows the list.
  await editBody(tablet, 'Trip plan', 'Book the train\nPack snacks');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await link(page, 'Trip plan').click();
  await expect(bodyBox(page)).toHaveValue('Book the train\nPack snacks');

  // Deleted on the phone: gone from the tablet too.
  upload = uploaded(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete this note?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Trip plan')).toBeHidden();
  await expect(tablet.getByText('No notes yet')).toBeVisible();

  // The text never reaches the server readable.
  upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Secret diary');
  await expectSealed(page, 'notes', await upload, 'Secret diary');
  await tablet.context().close();
});

test('keeps both versions of a note changed on two devices at once', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const tablet = await twoDevices(page, browser);
  const upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Groceries');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Groceries')).toBeVisible();

  // The phone goes offline and changes the note; so does the tablet.
  await page.context().setOffline(true);
  await link(page, 'Groceries').click();
  await bodyBox(page).fill('Milk');
  await page.getByRole('button', { name: 'All notes' }).click();
  await editBody(tablet, 'Groceries', 'Bread');

  // Back online, the phone syncs and keeps its version as a second note.
  await page.context().setOffline(false);
  await expect(page.locator('[data-sync-status]')).toHaveText(/both versions are kept/);
  expect(await titles(page)).toEqual(
    expect.arrayContaining(['Groceries', 'Groceries (second version)']),
  );
  await link(page, 'Groceries').click();
  await expect(bodyBox(page)).toHaveValue('Bread');
  await page.getByRole('button', { name: 'All notes' }).click();
  await link(page, 'Groceries (second version)').click();
  await expect(bodyBox(page)).toHaveValue('Milk');

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Groceries (second version)')).toBeVisible();
  await tablet.context().close();
});

test('says so in the open note when a sync keeps both versions of it', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const tablet = await twoDevices(page, browser);
  const upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Groceries');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Groceries')).toBeVisible();

  // The phone, offline, changes the note and stays in it (saved once typing pauses).
  await page.context().setOffline(true);
  await link(page, 'Groceries').click();
  await bodyBox(page).fill('Milk');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('shkriuss:notes')))
    .toContain('Milk');
  await editBody(tablet, 'Groceries', 'Bread');

  // Back online, the phone syncs with the note still open: it shows the
  // tablet's text now, and says where the phone's went (audit F3-6).
  await page.context().setOffline(false);
  await expect(bodyBox(page)).toHaveValue('Bread', { timeout: 15_000 });
  await expect(
    page.getByRole('alert').filter({
      hasText:
        'This note was also changed on another device. You’re now seeing that version. Yours is kept as a separate note: “Groceries (second version)”.',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All notes' }).click();
  await link(page, 'Groceries (second version)').click();
  await expect(bodyBox(page)).toHaveValue('Milk');
  // Gone once another note is open.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tablet.context().close();
});

test('typing while a sync keeps both versions leaves one second version: the other device’s', async ({
  page,
  browser,
  guard,
}) => {
  // The sync kept the phone's saved text as a second note, then the typing
  // waiting to be saved kept the tablet's as another one (audit 3 F3-4).
  test.slow();
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const tablet = await twoDevices(page, browser);
  let upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Trip');
  await bodyBox(page).fill('Pack bags');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Trip')).toBeVisible();

  // The phone's timers run on a clock the test moves; the phone goes offline.
  await page.clock.install();
  await page.reload();
  await expect(link(page, 'Trip')).toBeVisible();
  await page.context().setOffline(true);

  // The tablet changes the note.
  upload = uploaded(tablet);
  await link(tablet, 'Trip').click();
  await bodyBox(tablet).fill('Pack bags and passports');
  await tablet.getByRole('button', { name: 'All notes' }).click();
  await upload;

  // The phone changes it too (saved once the typing pauses)…
  await link(page, 'Trip').click();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await bodyBox(page).press('End');
  await bodyBox(page).pressSequentially(' and tickets');
  await page.clock.runFor(500);
  await expect.poll(() => savedNotes(page)).toEqual(['Trip | Pack bags and tickets']);
  // …and goes on typing, which isn't saved yet when the sync below ends.
  await page.clock.runFor(1_000);
  await bodyBox(page).pressSequentially('!');

  // Back online: the sync starts at once, and ends while the typing waits.
  // It starts from a timer set when the page hears it's online, which can
  // come a moment after going online here: the clock moves on once it has.
  await page.evaluate(() => {
    const target = window as unknown as Record<string, unknown>;
    target['backOnline'] = new Promise<void>((resolve) => {
      window.addEventListener('online', () => resolve(), { once: true });
    });
  });
  await page.context().setOffline(false);
  await page.evaluate(() => (window as unknown as Record<string, unknown>)['backOnline']);
  await page.clock.runFor(10);
  await expect
    .poll(() => savedNotes(page), { timeout: 15_000 })
    .toContain('Trip | Pack bags and tickets!');
  expect(await savedNotes(page)).toEqual([
    'Trip (second version) | Pack bags and passports',
    'Trip | Pack bags and tickets!',
  ]);
  await tablet.context().close();
});
