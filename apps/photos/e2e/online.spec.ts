// Photos' online library (docs/adr/0016-online-photo-library.md): photos go
// online, sealed, once the storage code is given; other devices see them and
// download only what they need; deleting goes everywhere; "Free up space"
// keeps photos viewable; after a new account key or with another account,
// each device uses the right library. The shared tests (tests/e2e/sync.spec.ts)
// cover turning sync on and off, deleting the online copy and a new account key.
import { readFile } from 'node:fs/promises';
import type { Browser, Page, Route } from '@playwright/test';
import { appSecretOf, parseRecoveryKey } from '../../../packages/account/src/secret.ts';
import { randomBytes, toBase64Url } from '../../../packages/crypto/src/index.ts';
import { libraryAccess, libraryRecord } from '../../../packages/library/src/client.ts';
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
  dropCopies,
  hereWithoutOriginal,
  jpeg,
  naturalWidth,
  onlinePlace,
  originalsHere,
  picture,
  stored,
  thumbsHere,
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

test('the storage code: asks for one, says it’s checking, and counts a code once', async ({
  page,
  guard,
}) => {
  // Before, an empty field did nothing, and a second press while a wrong code
  // was being checked was a second wrong try (audit 4 G-6).
  guard.allowConsole('status of 403 (Forbidden)');
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Photos');
  await expect(onlineStatus(page)).toHaveText('To keep photos online, enter the storage code.');
  const form = page.locator('[data-unlock-form]');
  const field = page.getByLabel('Storage code');
  const button = page.getByRole('button', { name: 'Unlock online storage' });
  const error = page.locator('[data-unlock-error]');
  const status = page.locator('[data-unlock-status]');

  await field.press('Enter');
  await expect(error).toHaveText('Enter the storage code.');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  // Focus was in the field already: the problem is read out.
  await expect(form.getByRole('alert')).toHaveText('Storage code: Enter the storage code.');

  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const tries: string[] = [];
  await page.route('**/api/library/unlock', async (route) => {
    tries.push(route.request().method());
    await answered;
    await route.fallback();
  });
  await field.fill('a wrong guess');
  await button.click();
  await expect(status).toHaveText('Checking the storage code…');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await checkA11y(page, 'online library: checking the storage code');
  await field.press('Enter');
  await button.click({ force: true });
  answer();
  await expect(error).toHaveText('That isn’t the storage code. Check it and try again.');
  await expect(status).toHaveText('');
  await expect(button).not.toHaveAttribute('aria-disabled');
  expect(tries).toEqual(['POST']);
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
  // Focus goes to the status line, not to the top of the page (audit 5 G-2).
  await expect(onlineStatus(page)).toBeFocused();
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
  const julyTile = tablet.getByRole('button', { name: 'Photo taken Jul 4, 2019, 6:30:05 PM' });
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
  // Read out with its title, so a screen reader hears it goes online too (audit 5 G-3).
  await expect(confirm).toHaveAccessibleDescription(
    'It’s deleted from this device and from your online library, so from your other devices too. This can’t be undone.',
  );
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

test('keyboard focus stays on a photo while photos go online', async ({ page }) => {
  // The grid is drawn again after each upload: focus fell to the top of the page (audit 3 G-1).
  await createAccount(page);
  await page.goto('/');
  const october = withExif(await picture(page, { width: 400, height: 300 }), '2026:10:21 14:03:22');
  const july = withExif(
    await picture(page, { width: 400, height: 300, color: '#36c' }),
    '2019:07:04 18:30:05',
  );
  await addPhotos(page, [jpeg('IMG_0015.JPG', october), jpeg('IMG_0016.JPG', july)]);

  // Uploads wait until a photo has keyboard focus.
  let letGo = (): void => undefined;
  const goOn = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route('**/api/library/items/**', async (route) => {
    if (route.request().method() === 'PUT') await goOn;
    await route.continue();
  });
  await turnOnSync(page, 'Photos');
  await unlock(page);
  // Unlocking ends by putting focus on the status line (audit 5 G-2): wait for
  // it, or it could take focus from the photo focused next (CI, 31 October).
  await expect(onlineStatus(page)).toBeFocused();
  const tile = page.getByRole('button', { name: 'Photo taken Jul 4, 2019, 6:30:05 PM' });
  await tile.focus();
  await page.evaluate(() => {
    (window as unknown as { focusedBefore: Element | null }).focusedBefore = document.activeElement;
  });

  letGo();
  await expect(onlineStatus(page)).toHaveText(/^Online: 2 photos · /, ONLINE);
  // Drawn again (the tile is a new copy), with focus on the same photo.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement ===
          (window as unknown as { focusedBefore: Element | null }).focusedBefore,
      ),
    )
    .toBe(false);
  await expect(tile).toBeFocused();
});

test('“Delete all data?” says how many photos aren’t online yet: sync doesn’t keep those', async ({
  page,
}) => {
  // It said only that the online copy keeps its data (audit 6 E-3).
  await createAccount(page);
  await page.goto('/');
  const october = withExif(await picture(page, { width: 400, height: 300 }), '2026:10:21 14:03:22');
  const july = withExif(
    await picture(page, { width: 400, height: 300, color: '#36c' }),
    '2019:07:04 18:30:05',
  );
  await addPhotos(page, [jpeg('IMG_0017.JPG', october), jpeg('IMG_0018.JPG', july)]);
  const dialog = page.getByRole('dialog', { name: 'Delete all data?' });
  const note = dialog.locator('[data-delete-note]');

  // With sync off, it says how to keep them already.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await expect(note).toBeHidden();
  await page.keyboard.press('Escape');

  // Sync on, but the storage code not given yet: nothing has gone up.
  await turnOnSync(page, 'Photos');
  await expect(onlineStatus(page)).toHaveText('To keep photos online, enter the storage code.');
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await expect(note).toHaveText(
    '2 photos on this device aren’t online yet, so they’re deleted for good. To keep them, save their originals first.',
  );
  await expect(dialog).toHaveAccessibleDescription(
    /keep their data\. 2 photos on this device aren’t online yet, so they’re deleted for good\. To keep them, save their originals first\.$/,
  );
  await checkA11y(page, 'delete all data: photos not online yet');
  await page.keyboard.press('Escape');

  // Once they're online, there's nothing more to say.
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 2 photos · /, ONLINE);
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await expect(note).toBeHidden();
  await expect(dialog).not.toHaveAccessibleDescription(/online yet/);
  await page.keyboard.press('Escape');
});

/** A second device signed in to the same account, with sync on in Photos. */
async function tabletWith(browser: Browser, key: string, appURL: string): Promise<Page> {
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Photos');
  return tablet;
}

/** "Sync now", then waits until the online library has been asked for its changes. */
async function syncNow(page: Page): Promise<void> {
  const asked = page.waitForResponse((response) => response.url().includes('/api/library/changes'));
  await page.getByRole('button', { name: 'Sync now' }).click();
  await asked;
}

/** Deletes the photo open in the viewer, and says what the dialog said. */
async function deleteInViewer(page: Page): Promise<string> {
  await page.locator('[data-viewer]').getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this photo?' });
  const said = (await confirm.locator('[data-delete-text]').textContent()) ?? '';
  await confirm.getByRole('button', { name: 'Delete' }).click();
  return said;
}

test('a photo deleted while sync is off is deleted only on this device: the online library and the other devices keep it', async ({
  page,
  browser,
}) => {
  // It was deleted online, and from every device, once sync was on again (audit 3 F3-1).
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0021.JPG');
  const tablet = await tabletWith(browser, key, appURL);
  await expect(tiles(tablet)).toHaveCount(1, ONLINE);
  const removals: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/library/remove')) removals.push(request.url());
  });

  // The phone turns sync off, then deletes the photo there, as its dialog says.
  await page.getByRole('button', { name: 'Turn off on this device' }).click();
  await tiles(page).first().click();
  expect(await deleteInViewer(page)).toBe(
    'The original and its copies are deleted from this device. Your online library keeps it, so it shows here again when you turn sync on again.',
  );
  await expect(tiles(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ photos: 0, files: 0 });

  // On again: it's back on the phone, only online, and still on the tablet.
  await turnOnSync(page, 'Photos');
  await expect(tiles(page)).toHaveCount(1, ONLINE);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);
  await syncNow(page);
  await tiles(page).first().click();
  await expect(page.locator('[data-viewer] [data-detail="where"]')).toHaveText(
    'Online (the original isn’t on this device)',
  );
  expect(removals).toEqual([]);
  await syncNow(tablet);
  await tablet.waitForTimeout(500);
  await expect(tiles(tablet)).toHaveCount(1);
  await tablet.context().close();
});

test('a photo that couldn’t be deleted here, as the page says, isn’t deleted online later either', async ({
  page,
}) => {
  // The deletion online was noted first, and still went ahead (audit 6 F3-4).
  await createAccount(page);
  await page.goto('/');
  await photoOnline(page, 'IMG_0019.JPG');
  const removals: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/library/remove')) removals.push(request.url());
  });

  // Deleting can't be saved on this device just now.
  await page.evaluate(() => {
    const remove = IDBObjectStore.prototype.delete;
    (window as unknown as { canDelete: () => void }).canDelete = () => {
      IDBObjectStore.prototype.delete = remove;
    };
    IDBObjectStore.prototype.delete = () => {
      throw new DOMException('Not just now.', 'UnknownError');
    };
  });
  await tiles(page).first().click();
  expect(await deleteInViewer(page)).toMatch(/^It’s deleted from this device and from your online/);
  const viewerStatus = page.locator('[data-viewer] [data-viewer-status]');
  await expect(viewerStatus).toHaveText('Couldn’t delete. Please try again.');
  await page.evaluate(() => (window as unknown as { canDelete: () => void }).canDelete());
  await page.locator('[data-viewer]').getByRole('button', { name: 'Close' }).click();

  // It's still here, and online.
  await syncNow(page);
  await syncNow(page);
  expect(removals).toEqual([]);
  await expect(tiles(page)).toHaveCount(1);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /);
  expect(await stored(page)).toEqual({ photos: 1, files: 1 });
});

test('a photo deleted while sync is on is deleted everywhere, even if sync is turned off before that gets online', async ({
  page,
  browser,
  guard,
}) => {
  // The online library is cut off on purpose.
  guard.allowConsole('net::ERR_FAILED');
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await photoOnline(page, 'IMG_0022.JPG');
  const tablet = await tabletWith(browser, key, appURL);
  await expect(tiles(tablet)).toHaveCount(1, ONLINE);

  // Deleted with sync on, as the dialog says, but it can't reach the online library just now.
  const cutOff = (route: Route) => route.abort();
  await page.route('**/api/library/remove', cutOff);
  await tiles(page).first().click();
  expect(await deleteInViewer(page)).toBe(
    'It’s deleted from this device and from your online library, so from your other devices too. This can’t be undone.',
  );
  await expect(tiles(page)).toHaveCount(0);
  await expect(onlineStatus(page)).toHaveText(
    'Couldn’t reach the online library: no connection. It will try again.',
    ONLINE,
  );

  // Sync is turned off before it gets there, and on again later: then it does.
  await page.getByRole('button', { name: 'Turn off on this device' }).click();
  await page.unroute('**/api/library/remove', cutOff);
  const removed = page.waitForResponse(
    (response) => response.url().endsWith('/api/library/remove') && response.ok(),
  );
  await turnOnSync(page, 'Photos');
  await removed;
  // It never came back on the phone meanwhile, and goes from the tablet.
  await expect(tiles(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ photos: 0, files: 0 });
  await syncNow(tablet);
  await expect(tiles(tablet)).toHaveCount(0);
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
  await expect(confirm).toHaveAccessibleDescription(/^This removes the original of 1 photo \(/);
  await checkA11y(page, 'free up space');
  await confirm.getByRole('button', { name: 'Free up space' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Freed up / })).toBeAttached();
  expect(await originalsHere(page)).toBe(0);
  await expect(freeUp).toBeHidden();

  // It still shows, and its original comes back from online.
  const tile = page.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03:22 PM' });
  await expect.poll(() => naturalWidth(tile.locator('img')), ONLINE).toBe(512);
  const dialog = page.locator('[data-viewer]');

  // Closed while its screen-sized copy is still downloading: nothing goes
  // wrong when it arrives (any error on the page fails the test).
  let arrive = (): void => undefined;
  const arriving = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await page.route('**/api/library/items/**', async (route) => {
    await arriving;
    await route.continue();
  });
  const downloaded = page.waitForResponse((response) =>
    response.url().includes('/api/library/items/'),
  );
  await tile.click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  arrive();
  await downloaded;
  await page.unroute('**/api/library/items/**');

  await tile.click();
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
  const viewerStatus = dialog.getByRole('status').and(dialog.locator('[data-viewer-status]'));
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

test('a photo picked again where this browser can’t show it keeps its thumbnail, and the viewer says out loud when a download fails', async ({
  page,
  browser,
  guard,
}) => {
  // Re-adding a HEIC on a Pixel replaced the thumbnail downloaded from the
  // online library with none, so it showed as "HEIC" from then on (audit 5
  // F3-6); and the viewer showed, but didn't read out, that a download
  // failed (audit 5 G-7).
  guard.allowConsole('net::ERR_INTERNET_DISCONNECTED');
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  // Camera-sized, so its screen-sized copy (2,048 pixels) is told from the original (4,000).
  const original = withExif(await picture(page), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0030.JPG', original)]);
  await turnOnSync(page, 'Photos');
  await unlock(page);
  await expect(onlineStatus(page)).toHaveText(/^Online: 1 photo · /, ONLINE);

  // A tablet whose browser can't show this kind of photo (as Chrome can't show HEIC).
  const tablet = await (await otherDevice(browser)).newPage();
  await tablet.route('**/_astro/process.worker-*.js', async (route) => {
    const response = await route.fetch();
    const script = await response.text();
    await route.fulfill({
      response,
      body: `self.createImageBitmap = () => Promise.reject(new Error('Not this kind'));\n${script}`,
    });
  });
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Photos');
  const tile = tablet.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03:22 PM' });
  await expect(tile).toBeVisible(ONLINE);
  await expect.poll(() => naturalWidth(tile.locator('img')), ONLINE).toBe(512);

  // Offline, the screen-sized copy can't be downloaded: said in the viewer, and read out.
  const failed = 'Couldn’t download this photo. Check your connection and try again.';
  await tablet.context().setOffline(true);
  await tile.click();
  const dialog = tablet.locator('[data-viewer]');
  const viewerStatus = dialog.locator('[data-viewer-status]');
  await expect(dialog.locator('[data-viewer-none]')).toHaveText(failed);
  await expect(viewerStatus).toHaveText(failed);
  await expect(viewerStatus).toHaveAttribute('data-problem', '');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await tablet.context().setOffline(false);

  // The original picked on the tablet: back there, with the thumbnail it had.
  await addPhotos(tablet, [jpeg('IMG_0030.JPG', original)]);
  await expect(
    tablet.getByRole('status').filter({ hasText: '1 original is back on this device.' }),
  ).toBeAttached();
  expect(await originalsHere(tablet)).toBe(1);
  expect(await thumbsHere(tablet)).toBe(1);
  await tablet.reload();
  await expect.poll(() => naturalWidth(tile.locator('img')), ONLINE).toBe(512);
  // Its screen-sized copy comes from the online library, as it's there.
  await tile.click();
  await expect.poll(() => naturalWidth(dialog.getByRole('img')), ONLINE).toBe(2048);
  await expect(viewerStatus).toHaveText('');
  await expect(dialog.locator('[data-detail="where"]')).toHaveText('On this device and online');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Even without its thumbnail here, a photo on this device shows the online library's.
  await dropCopies(tablet);
  await tablet.reload();
  await expect.poll(() => naturalWidth(tile.locator('img')), ONLINE).toBe(512);
  await tablet.context().close();
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

test('“Free up space” says it’s waiting for the online library, and a second press does nothing', async ({
  page,
}) => {
  // It said nothing and wasn't busy meanwhile, so a second press opened the
  // dialog again and queued a second go (audit 6 G-5).
  await createAccount(page);
  await page.goto('/');
  await photoOnline(page, 'IMG_0009.JPG');

  // A slow connection: the library's answer waits until let go.
  let letGo = (): void => undefined;
  const goOn = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  const asked: string[] = [];
  await page.route('**/api/library/changes*', async (route) => {
    asked.push(route.request().url());
    await goOn;
    await route.continue();
  });
  const freeUp = page.getByRole('button', { name: 'Free up space on this device' });
  const confirm = page.getByRole('dialog', { name: 'Free up space on this device?' });
  await freeUp.click();
  await confirm.getByRole('button', { name: 'Free up space' }).click();
  const status = page.locator('[data-free-up-status]');
  await expect(status).toHaveText('Freeing up space…');
  await expect(status).toHaveRole('status');
  await expect(freeUp).toHaveAttribute('aria-disabled', 'true');
  await expect(freeUp).toBeFocused();
  await checkA11y(page, 'freeing up space');
  await expect.poll(() => asked.length).toBeGreaterThan(0);

  await freeUp.click({ force: true });
  await expect(confirm).toBeHidden();
  letGo();
  await expect(page.getByRole('status').filter({ hasText: /^Freed up / })).toBeAttached(ONLINE);
  expect(await originalsHere(page)).toBe(0);
  await expect(status).toHaveText('');
  await expect(page.locator('[data-library-heading]')).toBeFocused();
  await page.unroute('**/api/library/changes*');
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
  await page.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03:22 PM' }).click();
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
  // Moving the library is refused: it's theirs now (403).
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
  // their own, and turns on sync in Photos with it. Photos there moves
  // nothing of the old key's: only the person's own devices know which key
  // replaced it (audit A-3).
  await replaceKey(page);
  await lost.goto(`${hubURL}/account/`);
  await expect(lost.locator('[data-message]')).toHaveText(/^Your account key was replaced/);
  await createAccount(lost);
  const moves: string[] = [];
  lost.on('request', (request) => {
    if (/\/api\/(sync\/copy\?moved|library\/move)$/.test(request.url())) moves.push(request.url());
  });
  const since = await lost.evaluate(() => Date.now());
  await connectAgain(lost, appURL);
  await lost.waitForFunction((after) => {
    const state = JSON.parse(localStorage.getItem('shkriuss-device:sync') ?? 'null') as {
      last?: number | null;
    } | null;
    return (state?.last ?? 0) >= after;
  }, since);
  expect(moves).toEqual([]);

  // But an older version of Photos still on that phone, or a request made by
  // hand, can move the library with the old key's token.
  const old = await parseRecoveryKey(key);
  if (!old.ok) throw new Error('Not a recovery key');
  const secret = await appSecretOf(old.secret, 'photos');
  const { token, library } = await libraryAccess(secret, await libraryRecord(secret, undefined));
  const taken = await lost.request.post(`${appURL}/api/library/move`, {
    headers: { Authorization: `Bearer ${toBase64Url(randomBytes(32))}`, 'X-Library': library },
    data: { from: token },
  });
  expect(taken.status()).toBe(204);
  await lost.context().close();

  // The tablet turns on sync again: it moves the old copy itself, Photos says
  // what happened to the library, and its photo goes up to a new library.
  const moved = oldCopyMoved(page);
  await connectAgain(page, appURL);
  await moved;
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
  // Signing out happens when the dialog's close event runs, a moment after the
  // click: leaving the page at once could skip it, and the next page was still
  // signed in (CI, 31 October). The hub's own tests wait the same way.
  await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
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
