// Photos open in two tabs of one browser: each tab keeps its own list of the
// photos, and loads it again only when it gets focus and another tab changed
// something. The online library's work in a tab whose list is older than
// what's on the device mustn't lose the other tab's photos, or leave them
// marked as online in a library that was deleted (audit 6 F3-1).
import type { Page, Route } from '@playwright/test';
import { createAccount, hubURL, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { TEST_STORAGE_CODE } from '../../../tests/e2e/sites.ts';
import {
  addPhotos,
  jpeg,
  markedHere,
  markedOnline,
  onlinePlace,
  originalsHere,
  picture,
  stored,
  withExif,
} from './helpers.ts';

// An account, the hub, uploads and two tabs: more than the usual 30 seconds.
test.slow();

test.beforeEach(({ guard }) => {
  guard.allowOrigin(hubURL);
  // Each test deletes the online copy: a tab learns it's gone from the server's answer, 410 Gone.
  guard.allowConsole('status of 410');
});

const ONLINE = { timeout: 15_000 };
const onlineStatus = (page: Page) => page.locator('[data-online-status]');
const tiles = (page: Page) => page.locator('[data-months] .tile');

async function unlock(page: Page): Promise<void> {
  await page.getByLabel('Storage code').fill(TEST_STORAGE_CODE);
  await page.getByRole('button', { name: 'Unlock online storage' }).click();
}

/** Sync on and the storage code given, with no photos yet; then Photos open in a second tab too. */
async function twoTabs(page: Page): Promise<Page> {
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Photos');
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 0 photos · /, ONLINE);
  const other = await page.context().newPage();
  await other.goto('/');
  await expect(onlineStatus(other)).toHaveText(/^Online: 0 photos · /, ONLINE);
  return other;
}

/** Adds a photo in `page`, and waits until it's online. */
async function addOnline(page: Page, name: string): Promise<void> {
  const taken = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg(name, taken)]);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
}

/**
 * A look at the online library in `page`, started the way its check every
 * minute starts one: without the window getting focus (two windows side by
 * side, or Split View on an iPad), so its list isn't loaded again.
 */
async function lookWithoutFocus(page: Page): Promise<void> {
  const asked = page.waitForResponse((response) => response.url().includes('/api/library/changes'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await asked;
}

/** "Delete the online copy", from Photos' own sync controls. */
async function deleteOnlineCopy(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete the online copy' }).click();
  await page
    .getByRole('dialog', { name: 'Delete the online copy?' })
    .getByRole('button', { name: 'Delete the online copy' })
    .click();
  await expect(page.locator('[data-sync-status]')).toHaveText(
    'The online copy is deleted, and sync is off on this device.',
    ONLINE,
  );
}

test('a tab with an old list doesn’t take the other tab’s photo for one that’s only online', async ({
  page,
}) => {
  // It was saved as only online over the real one, and deleting the online
  // copy then deleted it from the device, original and all.
  const other = await twoTabs(page);
  // The other tab, whose list doesn't have the photo, is the one to bring in
  // its change: this tab's looks at the library wait, once it's going up.
  const held: Route[] = [];
  let uploading = false;
  await page.route('**/api/library/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'PUT' && url.includes('/api/library/items/')) uploading = true;
    if (uploading && url.includes('/api/library/changes')) held.push(route);
    else await route.fallback();
  });
  await addOnline(page, 'IMG_0100.JPG');
  expect(await markedHere(page, 'IMG_0100.JPG')).toBe(true);
  expect((await onlinePlace(page))?.since).toBe(0);
  await lookWithoutFocus(other);
  await expect.poll(async () => (await onlinePlace(other))?.since).toBe(1);
  expect(await markedHere(page, 'IMG_0100.JPG')).toBe(true);
  expect(await originalsHere(page)).toBe(1);

  // Photos on this device stay, as the dialog says.
  await deleteOnlineCopy(other);
  expect(await stored(page)).toEqual({ photos: 1, files: 1 });
  expect(await originalsHere(page)).toBe(1);
  expect(await markedHere(page, 'IMG_0100.JPG')).toBe(true);
  expect(await markedOnline(page, 'IMG_0100.JPG')).toBe(false);

  await page.unroute('**/api/library/**');
  for (const route of held) await route.continue().catch(() => undefined);
  await page.reload();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await expect(page.locator('[data-viewer] [data-detail="where"]')).toHaveText('On this device');
});

test('a tab with an old list that deletes the online copy marks every photo here as not online, so they go up again', async ({
  page,
}) => {
  // The other tab's photo kept its mark for the deleted library: it never
  // went up to the new one, and "Free up space" removed its only original.
  const other = await twoTabs(page);
  await addOnline(page, 'IMG_0200.JPG');

  await deleteOnlineCopy(other);
  expect(await markedOnline(page, 'IMG_0200.JPG')).toBe(false);
  expect(await originalsHere(page)).toBe(1);

  // Sync on again in the other tab (opened again, so its list is new), with the storage code.
  await turnOnSync(other, 'Photos');
  await expect(onlineStatus(other)).toHaveText(
    'To keep photos online, enter the storage code.',
    ONLINE,
  );

  // The first tab's list still says the photo is online. "Free up space"
  // there looks at what's on the device first, and removes nothing.
  await lookWithoutFocus(page);
  const freeUp = page.getByRole('button', { name: 'Free up space on this device' });
  await expect(freeUp).toBeVisible(ONLINE);
  await freeUp.click();
  await page
    .getByRole('dialog', { name: 'Free up space on this device?' })
    .getByRole('button', { name: 'Free up space' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Couldn’t free up space. Please try again.' }),
  ).toBeVisible();
  expect(await originalsHere(page)).toBe(1);
  await expect(freeUp).toBeHidden();

  // Unlocked: it goes up to the new library.
  await unlock(other);
  await expect(onlineStatus(other)).toHaveText(/^Online: 1 photo · /, ONLINE);
  expect(await markedOnline(page, 'IMG_0200.JPG')).toBe(true);
});

test('a tab with an old list that turns sync off keeps a photo the other tab put back on this device', async ({
  page,
}) => {
  const other = await twoTabs(page);
  const taken = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0400.JPG', taken)]);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
  await page.getByRole('button', { name: 'Free up space on this device' }).click();
  await page
    .getByRole('dialog', { name: 'Free up space on this device?' })
    .getByRole('button', { name: 'Free up space' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: /^Freed up / })).toBeAttached();

  // The other tab has it as only online; then this tab puts its original back.
  await other.reload();
  await expect(tiles(other)).toHaveCount(1);
  await addPhotos(page, [jpeg('IMG_0400.JPG', taken)]);
  await expect(
    page.getByRole('status').filter({ hasText: '1 original is back on this device.' }),
  ).toBeAttached();

  // Sync off in the other tab: photos only online go from this device, but not this one.
  await other.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(other.locator('[data-online-off]')).toBeVisible();
  for (let check = 0; check < 10; check += 1) {
    await other.waitForTimeout(100);
    expect(await originalsHere(page)).toBe(1);
  }
  expect(await stored(page)).toEqual({ photos: 1, files: 1 });
  expect(await markedHere(page, 'IMG_0400.JPG')).toBe(true);
  await expect(tiles(other)).toHaveCount(1);
});

test('an upload whose answer comes after the online copy was deleted in another tab doesn’t mark the photo as online', async ({
  page,
}) => {
  const other = await twoTabs(page);
  // The upload reaches the library, but its answer is slow to come back.
  let upload = (): void => undefined;
  const uploaded = new Promise<void>((resolve) => {
    upload = resolve;
  });
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route('**/api/library/items/**', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const response = await route.fetch();
    upload();
    await answered;
    await route.fulfill({ response });
  });
  const taken = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0300.JPG', taken)]);
  await uploaded;

  // Meanwhile the other tab deletes the online copy, and marks the photos here as not online.
  await deleteOnlineCopy(other);
  await expect.poll(async () => (await onlinePlace(other))?.epoch).toBeNull();
  answer();
  for (let check = 0; check < 10; check += 1) {
    await page.waitForTimeout(100);
    expect(await markedOnline(page, 'IMG_0300.JPG')).toBe(false);
  }

  // So it goes up again once sync is on.
  await page.unroute('**/api/library/items/**');
  await turnOnSync(other, 'Photos');
  await unlock(other);
  await expect(onlineStatus(other)).toHaveText(/^Online: 1 photo · /, ONLINE);
  expect(await originalsHere(page)).toBe(1);
});
