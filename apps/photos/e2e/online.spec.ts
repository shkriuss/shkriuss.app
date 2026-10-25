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
  hereWithoutOriginal,
  jpeg,
  naturalWidth,
  onlinePlace,
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

test('sync turned off while the online library is being asked: nothing is lost, and nothing more goes up', async ({
  page,
  browser,
}) => {
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0013.JPG');

  // The tablet has that photo only online.
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Photos');
  await expect(tiles(tablet)).toHaveCount(1, ONLINE);
  await expect(onlineStatus(tablet)).toHaveText(/^Online: 1 photo · /, ONLINE);

  // Its next look at the library takes a while (a slow connection): one
  // starts when a photo is added there, which would then go up.
  const held: Route[] = [];
  let letGo = (): void => undefined;
  const goOn = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await tablet.route('**/api/library/changes*', async (route) => {
    held.push(route);
    await goOn;
    await route.continue();
  });
  const uploads: string[] = [];
  tablet.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/library/items/')) {
      uploads.push(request.url());
    }
  });
  const july = withExif(
    await picture(tablet, { width: 800, height: 600, color: '#36c' }),
    '2019:07:04 18:30:05',
  );
  await addPhotos(tablet, [jpeg('IMG_0014.JPG', july)]);
  await expect.poll(() => held.length).toBeGreaterThan(0);

  // Meanwhile sync is turned off there: the photo only online goes at once.
  await tablet.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(tiles(tablet)).toHaveCount(1);
  const answered = tablet.waitForResponse((response) =>
    response.url().includes('/api/library/changes'),
  );
  letGo();
  await answered;
  await tablet.unroute('**/api/library/changes*');

  // The look under way stops (audit F3-2): it doesn't write back how far it
  // had got, so the next one starts from the beginning, and puts nothing online.
  await expect.poll(async () => (await onlinePlace(tablet))?.since).toBe(0);
  for (let check = 0; check < 10; check += 1) {
    await tablet.waitForTimeout(100);
    expect((await onlinePlace(tablet))?.since).toBe(0);
  }
  expect(uploads).toEqual([]);

  // On again: the photo only online is back, and the new one goes up.
  await turnOnSync(tablet, 'Photos');
  await expect(tiles(tablet)).toHaveCount(2, ONLINE);
  await expect(onlineStatus(tablet)).toHaveText(/^Online: 2 photos · /, ONLINE);

  // Opened with sync off, and the photo only online still kept, with how far
  // a look had got (as such a look could leave them before): it goes, and
  // comes back when sync is on again.
  const leftOver = await tablet.evaluate(
    () =>
      new Promise<[string, unknown][]>((resolve) => {
        const request = indexedDB.open('shkriuss-files');
        request.onsuccess = () => {
          const table = request.result.transaction('files').objectStore('files');
          const names = table.getAllKeys();
          const values = table.getAll();
          // Requests in one transaction finish in order: the names are read by now.
          values.onsuccess = () => {
            request.result.close();
            const pairs = names.result.map((name, at): [string, unknown] => [
              String(name),
              values.result[at],
            ]);
            resolve(
              pairs.filter(([name]) => name.startsWith('photo:') || name === 'photos-online:state'),
            );
          };
        };
      }),
  );
  await tablet.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(tiles(tablet)).toHaveCount(1);
  await tablet.evaluate(
    (pairs) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open('shkriuss-files');
        request.onsuccess = () => {
          const run = request.result.transaction('files', 'readwrite');
          for (const [name, value] of pairs) run.objectStore('files').put(value, name);
          run.oncomplete = () => {
            request.result.close();
            resolve();
          };
        };
      }),
    leftOver,
  );
  await tablet.reload();
  await expect(tiles(tablet)).toHaveCount(1);
  await expect.poll(async () => (await onlinePlace(tablet))?.since).toBe(0);
  await turnOnSync(tablet, 'Photos');
  await expect(tiles(tablet)).toHaveCount(2, ONLINE);
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

  // While it downloads, the viewer says so, and another tap doesn't start a
  // second download (audit G-8). The download waits here until let go.
  const held: Route[] = [];
  let letGo = (): void => undefined;
  const goOn = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route('**/api/library/items/**', async (route) => {
    held.push(route);
    await goOn;
    await route.continue();
  });
  const download = page.waitForEvent('download');
  const saveOriginal = dialog.getByRole('button', { name: 'Save original' });
  await saveOriginal.click();
  const viewerStatus = dialog.getByRole('status');
  await expect(viewerStatus).toHaveText('Downloading the original…');
  await expect(saveOriginal).toHaveAttribute('aria-disabled', 'true');
  await expect(saveOriginal).toBeFocused();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const asked = held.length;
  await saveOriginal.dispatchEvent('click');
  await page.waitForTimeout(500);
  expect(held.length).toBe(asked);
  letGo();
  expect((await readFile(await (await download).path())).equals(original)).toBe(true);
  await page.unroute('**/api/library/items/**');
  await expect(viewerStatus).toHaveText('Downloaded the original.');
  await expect(saveOriginal).not.toHaveAttribute('aria-disabled');
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
  // Shown at the top of the page, and read out (audit G-1).
  await expect(
    page.getByRole('alert').filter({ hasText: 'Couldn’t free up space. Please try again.' }),
  ).toBeVisible();
  expect(await originalsHere(page)).toBe(1);
});

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

test('a photo is never marked as on this device without its original, even if freeing up space stops half-way', async ({
  page,
}) => {
  // Audit F3-1: the tab is closed, or the device fills up, part-way through.
  await createAccount(page);
  await page.goto('/');
  const october = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  const july = withExif(
    await picture(page, { width: 800, height: 600, color: '#36c' }),
    '2019:07:04 18:30:05',
  );
  await addPhotos(page, [jpeg('IMG_0010.JPG', october), jpeg('IMG_0011.JPG', july)]);
  await turnOnSync(page, 'Photos');
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 2 photos · /, ONLINE);

  // Nothing more can be saved once the first original has gone, as if the page had been closed.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const transaction = IDBDatabase.prototype.transaction;
    let stopped = false;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ) {
      const [value, key] = args;
      if (
        String(key).startsWith('photo-files:') &&
        (value as { original: unknown }).original === null
      ) {
        this.transaction.addEventListener('complete', () => {
          stopped = true;
        });
      }
      return put.apply(this, args);
    };
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<typeof transaction>
    ) {
      if (stopped) throw new DOMException('The page was closed.', 'InvalidStateError');
      return transaction.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Free up space on this device' }).click();
  await page
    .getByRole('dialog', { name: 'Free up space on this device?' })
    .getByRole('button', { name: 'Free up space' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Couldn’t free up space. Please try again.' }),
  ).toBeVisible();

  // Opened again: the photo freed says it's only online, and the other one still has its original.
  await page.reload();
  await expect(onlineStatus(page)).toHaveText(/^Online: 2 photos · /, ONLINE);
  expect(await hereWithoutOriginal(page)).toBe(0);
  expect(await originalsHere(page)).toBe(1);
  await page.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03 PM' }).click();
  const dialog = page.locator('[data-viewer]');
  await expect(dialog.locator('[data-detail="where"]')).toHaveText(
    'Online (the original isn’t on this device)',
  );
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Deleting the online copy deletes the photo that was only there, and keeps the other.
  await deleteOnlineCopy(page);
  await expect(tiles(page)).toHaveCount(1);
  expect(await originalsHere(page)).toBe(1);
  expect(await hereWithoutOriginal(page)).toBe(0);
});

test('deleting the online copy keeps no photo as on this device without its original', async ({
  page,
}) => {
  await createAccount(page);
  await page.goto('/');
  await photoOnline(page, 'IMG_0012.JPG');
  // As an older version could leave it (audit F3-1): marked as here, but its original was freed.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('shkriuss-files');
        request.onsuccess = () => {
          const database = request.result;
          const run = database.transaction('files', 'readwrite');
          const table = run.objectStore('files');
          const files = table.getAll(
            IDBKeyRange.bound('photo-files:', 'photo-files;', false, true),
          );
          files.onsuccess = () => {
            for (const file of files.result as { id: string }[]) {
              table.put({ ...file, original: null, view: null }, `photo-files:${file.id}`);
            }
          };
          run.oncomplete = () => {
            database.close();
            resolve();
          };
          run.onerror = () => reject(run.error ?? new Error('Not saved'));
        };
      }),
  );
  await page.reload();
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);

  // Its original was only online, so with the online copy deleted, the photo is gone.
  await deleteOnlineCopy(page);
  await expect(tiles(page)).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ photos: 0 });
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
