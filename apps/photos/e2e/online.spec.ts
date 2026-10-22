// Photos' online library (docs/adr/0016-online-photo-library.md): photos go
// online, sealed, once the storage code is given; other devices see them and
// download only what they need; deleting goes everywhere; "Free up space"
// keeps photos viewable; after a new account key or with another account,
// each device uses the right library. The shared tests (tests/e2e/sync.spec.ts)
// cover turning sync on and off, deleting the online copy and a new account key.
import { readFile } from 'node:fs/promises';
import type { Page, Route } from '@playwright/test';
import {
  createAccount,
  hubURL,
  oldCopyMoved,
  otherDevice,
  replaceKey,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { TEST_STORAGE_CODE } from '../../../tests/e2e/sites.ts';
import {
  addPhotos,
  jpeg,
  naturalWidth,
  originalsHere,
  picture,
  stored,
  withExif,
} from './helpers.ts';

// An account, the hub, uploads, and a second device: more than the usual 30 seconds.
test.slow();

test.beforeEach(({ guard }) => {
  guard.allowOrigin(hubURL);
});

/** For what waits on the online library (uploads, another device's changes). */
const ONLINE = { timeout: 15_000 };

const onlineStatus = (page: Page) => page.locator('[data-online-status]');
const tiles = (page: Page) => page.locator('[data-months] .tile');

async function unlock(page: Page, code = TEST_STORAGE_CODE): Promise<void> {
  await page.getByLabel('Storage code').fill(code);
  await page.getByRole('button', { name: 'Unlock online storage' }).click();
}

/** A photo on this device, online with the storage code given, after turning on sync. */
async function photoOnline(page: Page, name: string): Promise<void> {
  const taken = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg(name, taken)]);
  await turnOnSync(page, 'Photos');
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
}

/** "Turn on sync" from the hub's list of apps, with whichever account the hub has now. */
async function connectAgain(page: Page, appURL: string): Promise<void> {
  await page.goto(`${appURL}/#sync=connect`);
  await page.getByRole('button', { name: 'Turn on sync for Photos' }).click();
  await page.waitForURL(`${appURL}/`);
}

/** Resolves once this device's next change to the online copy has gone up. */
const copyUploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') &&
      response.request().method() === 'PUT' &&
      response.ok(),
  );

/** Resolves once the record of a library this device started is in the online copy. */
const recordUploaded = (page: Page) =>
  page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem('shkriuss-device:sync') ?? 'null') as {
      dirty?: boolean;
      known?: Record<string, { items: Record<string, unknown> }>;
    } | null;
    const known = Object.keys(state?.known?.['shkriuss:library']?.items ?? {});
    return state?.dirty === false && known.some((id) => id.startsWith('library'));
  });

test('puts photos online, and shows them on the other devices', async ({
  page,
  browser,
  guard,
}) => {
  // The wrong storage code, tried on purpose.
  guard.allowConsole('status of 403 (Forbidden)');
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  const july = withExif(await picture(page, { color: '#36c' }), '2019:07:04 18:30:05');
  const october = withExif(
    await picture(page, { width: 3000, height: 4000 }),
    '2026:10:21 14:03:22',
  );
  await addPhotos(page, [jpeg('IMG_0001.JPG', july), jpeg('IMG_0002.JPG', october)]);
  await expect(tiles(page)).toHaveCount(2);

  // Nothing goes online until the storage code is given.
  await turnOnSync(page, 'Photos');
  await expect(onlineStatus(page)).toHaveText('To keep photos online, enter the storage code.');
  await unlock(page, 'a wrong guess');
  await expect(page.locator('[data-unlock-error]')).toHaveText(
    'That isn’t the storage code. Check it and try again.',
  );
  await checkA11y(page, 'online library: the storage code');
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 2 photos · /, ONLINE);
  await checkA11y(page, 'online library: all online');

  // The tablet sees them without the code, and downloads only thumbnails.
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Photos');
  await expect(tiles(tablet)).toHaveCount(2, ONLINE);
  await expect(onlineStatus(tablet)).toHaveText(/^Online: 2 photos · /, ONLINE);
  await expect(tablet.getByLabel('Storage code')).toBeHidden();
  const julyTile = tablet.getByRole('button', { name: 'Photo taken Jul 4, 2019, 6:30 PM' });
  await expect.poll(() => naturalWidth(julyTile.locator('img')), ONLINE).toBe(512);
  expect(await originalsHere(tablet)).toBe(0);

  // Looking at one downloads its screen-sized copy; saving downloads the original, exactly.
  await julyTile.click();
  const dialog = tablet.locator('[data-viewer]');
  await expect.poll(() => naturalWidth(dialog.getByRole('img')), ONLINE).toBe(2048);
  await expect(dialog.locator('[data-detail="where"]')).toHaveText(
    'Online (the original isn’t on this device)',
  );
  const download = tablet.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save original' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('IMG_0001.JPG');
  expect((await readFile(await saved.path())).equals(july)).toBe(true);

  // Deleting it there deletes it everywhere.
  await dialog.getByRole('button', { name: 'Delete' }).click();
  const confirm = tablet.getByRole('dialog', { name: 'Delete this photo?' });
  await expect(confirm).toContainText('deleted from this device and from your online library');
  const removed = tablet.waitForResponse(
    (response) => response.url().endsWith('/api/library/remove') && response.ok(),
  );
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await removed;
  await expect(tiles(tablet)).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(tiles(page)).toHaveCount(1, ONLINE);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
  expect(await stored(page)).toMatchObject({ photos: 1 });

  // With sync off, photos that are only online can't be seen; on again, they're back.
  await tablet.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(tiles(tablet)).toHaveCount(0);
  await turnOnSync(tablet, 'Photos');
  await expect(tiles(tablet)).toHaveCount(1, ONLINE);
  await tablet.context().close();
});

test('frees up space on this device, and the photos still show', async ({ page }) => {
  await createAccount(page);
  await page.goto('/');
  const original = withExif(await picture(page), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0003.JPG', original)]);
  const freeUp = page.getByRole('button', { name: 'Free up space on this device' });
  await turnOnSync(page, 'Photos');
  await expect(freeUp).toBeHidden();
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);

  await freeUp.click();
  const confirm = page.getByRole('dialog', { name: 'Free up space on this device?' });
  await expect(confirm).toContainText('This removes the original of 1 photo (');
  await checkA11y(page, 'free up space');
  await confirm.getByRole('button', { name: 'Free up space' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Freed up / })).toBeAttached();
  expect(await originalsHere(page)).toBe(0);
  await expect(freeUp).toBeHidden();

  // It still shows, and its original comes back from online.
  const tile = page.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03 PM' });
  await expect.poll(() => naturalWidth(tile.locator('img')), ONLINE).toBe(512);
  await tile.click();
  const dialog = page.locator('[data-viewer]');
  await expect.poll(() => naturalWidth(dialog.getByRole('img')), ONLINE).toBe(2048);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save original' }).click();
  expect((await readFile(await (await download).path())).equals(original)).toBe(true);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Picking the same photo again puts its original back on this device.
  await addPhotos(page, [jpeg('IMG_0003.JPG', original)]);
  await expect(
    page.getByRole('status').filter({ hasText: '1 original is back on this device.' }),
  ).toBeAttached();
  expect(await originalsHere(page)).toBe(1);
  await expect(tiles(page)).toHaveCount(1);
  await expect(freeUp).toBeVisible();
});

test('frees up space only when the online library has just said the photos are there', async ({
  page,
  guard,
}) => {
  // The online library is cut off on purpose.
  guard.allowConsole('net::ERR_FAILED');
  await createAccount(page);
  await page.goto('/');
  await photoOnline(page, 'IMG_0008.JPG');
  const freeUp = page.getByRole('button', { name: 'Free up space on this device' });
  await expect(freeUp).toBeVisible();

  // Opened again while the library can't be reached: nothing is offered.
  const cutOff = (route: Route) => route.abort();
  await page.route('**/api/library/changes*', cutOff);
  await page.reload();
  await expect(onlineStatus(page)).toHaveText(
    'Couldn’t reach the online library: no connection. It will try again.',
    ONLINE,
  );
  await expect(freeUp).toBeHidden();

  // Once it answers, it's offered, and asked again before anything is removed.
  await page.unroute('**/api/library/changes*', cutOff);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(freeUp).toBeVisible(ONLINE);
  await freeUp.click();
  await page.route('**/api/library/changes*', cutOff);
  await page
    .getByRole('dialog', { name: 'Free up space on this device?' })
    .getByRole('button', { name: 'Free up space' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Couldn’t free up space. Please try again.' }),
  ).toBeAttached();
  expect(await originalsHere(page)).toBe(1);
});

test('after the account key is replaced, every device keeps to the library with the photos', async ({
  page,
  browser,
}) => {
  await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0005.JPG');

  // The key is replaced on this phone. A new tablet, signed in with the new
  // recovery key, turns on sync before the phone does: it starts a library.
  const { key } = await replaceKey(page);
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Photos');
  await expect(onlineStatus(tablet)).toHaveText(
    'To keep photos online, enter the storage code.',
    ONLINE,
  );
  await recordUploaded(tablet);

  // The phone turns on sync again: it keeps its library, moved to the new key…
  const moved = oldCopyMoved(page);
  await connectAgain(page, appURL);
  await moved;
  const recordMoved = copyUploaded(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
  await recordMoved;

  // …and the tablet uses it too, so it shows the photo.
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(tiles(tablet)).toHaveCount(1, ONLINE);
  await expect(onlineStatus(tablet)).toHaveText(/^Online: 1 photo · /, ONLINE);
  await tablet.context().close();
});

test('a device with the old account key took the library: Photos says so, and starts a new one', async ({
  page,
  browser,
  guard,
}) => {
  // The lost phone moved the old copy (410), and moving the library is refused: it's theirs now (403).
  guard.allowConsole('status of 410 (Gone)');
  guard.allowConsole('status of 403 (Forbidden)');
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0007.JPG');
  const lost = await (await otherDevice(browser)).newPage();
  await signInWithKey(lost, key);
  await lost.goto(`${appURL}/`);
  await turnOnSync(lost, 'Photos');
  await expect(tiles(lost)).toHaveCount(1, ONLINE);

  // That phone is lost, and the key is replaced on this tablet. Before the
  // tablet opens Photos again, someone with the phone makes an account of
  // their own, and turns on sync in Photos with it.
  await replaceKey(page);
  await lost.goto(`${hubURL}/account/`);
  await expect(lost.locator('[data-message]')).toHaveText(/^Your account key was replaced/);
  await createAccount(lost);
  const takenAway = oldCopyMoved(lost);
  await connectAgain(lost, appURL);
  await takenAway;
  await lost.context().close();

  // The tablet turns on sync again: Photos says what happened, and its photo
  // goes up to a new library.
  await connectAgain(page, appURL);
  await expect(onlineStatus(page)).toHaveText(
    /^Your online library was taken by a device that still had your old account key, perhaps the lost one/,
    ONLINE,
  );
  await expect(onlineStatus(page)).toContainText('To keep photos online, enter the storage code.');
  await unlock(page);
  await expect(onlineStatus(page)).toContainText('Online: 1 photo · ', ONLINE);
});

test('signed in to another account, photos go up to that account’s library', async ({ page }) => {
  await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0006.JPG');

  // This device signs in to another account, and Photos syncs with it.
  await page.goto(`${hubURL}/account/`);
  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out of this device?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await createAccount(page);
  await connectAgain(page, appURL);

  // That account's library is a new one: the photo isn't offered to free up, and goes up to it.
  await expect(onlineStatus(page)).toHaveText(
    'To keep photos online, enter the storage code.',
    ONLINE,
  );
  await expect(page.getByRole('button', { name: 'Free up space on this device' })).toBeHidden();
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
});
