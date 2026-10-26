// Photos while its library loads, which takes seconds with tens of
// thousands of photos on a phone (audit 3 F3-8). The page says it's
// loading, not "No photos yet", and photos picked meanwhile, and the online
// library's changes, wait until it's loaded, so they're checked against
// every photo here.
import type { Page, Request } from '@playwright/test';
import { createAccount, hubURL, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { TEST_STORAGE_CODE } from '../../../tests/e2e/sites.ts';
import { addPhotos, jpeg, markedHere, picture, stored, withExif } from './helpers.ts';

const loading = (page: Page) => page.getByText('Loading your photos…');
const empty = (page: Page) => page.getByText('No photos yet.', { exact: false });

/**
 * From the next time the page opens, its first read of the whole library
 * isn't done until the returned function lets it go, as on a phone with a
 * big library.
 */
async function slowLoad(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(() => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as unknown as { letLoad: () => void }).letLoad = release;
    const getAll = IDBObjectStore.prototype.getAll;
    let first = true;
    IDBObjectStore.prototype.getAll = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof getAll>
    ) {
      const request = getAll.apply(this, args);
      const [query] = args;
      if (first && query instanceof IDBKeyRange && query.lower === 'photo:') {
        first = false;
        // The read is done when its transaction completes: tell the page only once let go.
        const transaction = this.transaction;
        let done: ((event: Event) => void) | null = null;
        Object.defineProperty(transaction, 'oncomplete', {
          configurable: true,
          get: () => done,
          set: (handler: ((event: Event) => void) | null) => {
            done = handler;
          },
        });
        transaction.addEventListener('complete', (event) => {
          void held.then(() => done?.call(transaction, event));
        });
      }
      return request;
    };
  });
  return () => page.evaluate(() => (window as unknown as { letLoad: () => void }).letLoad());
}

test('says it’s loading, never “No photos yet”, and checks photos picked meanwhile against the library', async ({
  page,
}) => {
  // Before any script runs, the page itself says it's loading.
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('Loading your photos…');
  expect(html).toMatch(/<p[^>]*data-empty[^>]*hidden/);

  await page.goto('/');
  await expect(empty(page)).toBeVisible();
  await expect(loading(page)).toBeHidden();
  const photo = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0001.JPG', photo)]);

  const letLoad = await slowLoad(page);
  await page.reload();
  await expect(loading(page)).toBeVisible();
  await expect(page.locator('[data-summary]')).toBeHidden();
  expect(await empty(page).isVisible(), '"No photos yet." while the library loads').toBe(false);

  // The same photo picked again meanwhile waits for the library, and is found in it.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles([jpeg('copy of IMG_0001.JPG', photo)]);
  await expect(page.getByRole('button', { name: 'Add photos' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await letLoad();
  await expect(
    page.getByRole('status').filter({ hasText: 'No photos were added. 1 photo was already here.' }),
  ).toBeAttached();
  await expect(loading(page)).toBeHidden();
  await expect(empty(page)).toBeHidden();
  await expect(page.locator('[data-summary]')).toContainText('1 photo ·');
  expect(await stored(page)).toMatchObject({ photos: 1 });
});

test('with sync on, the online library’s changes wait until the photos here are loaded', async ({
  page,
  guard,
}) => {
  // They were applied to the list while it was still empty: a photo here and
  // online was then saved as only online (found with audit 3 F3-8), and
  // "Delete the online copy" would delete it from this device.
  guard.allowOrigin(hubURL);
  await createAccount(page);
  await page.goto('/');
  const photo = withExif(await picture(page, { width: 800, height: 600 }), '2026:10:21 14:03:22');
  await addPhotos(page, [jpeg('IMG_0020.JPG', photo)]);
  await turnOnSync(page, 'Photos');
  await page.getByLabel('Storage code').fill(TEST_STORAGE_CODE);
  await page.getByRole('button', { name: 'Unlock online storage' }).click();
  const status = page.locator('[data-online-status]');
  await expect(status).toHaveText(/^Online: 1 photo · /, { timeout: 15_000 });

  // The next look at the library starts from the beginning, as after turning sync off and on again.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('shkriuss-files');
        request.onsuccess = () => {
          const database = request.result;
          const run = database.transaction('files', 'readwrite');
          const table = run.objectStore('files');
          const read = table.get('photos-online:state');
          read.onsuccess = () => {
            table.put({ ...read.result, since: 0 }, 'photos-online:state');
          };
          run.oncomplete = () => {
            database.close();
            resolve();
          };
          run.onerror = () => reject(run.error ?? new Error('Not saved'));
        };
      }),
  );

  // Opened again, and the library here takes a while to load: sync goes ahead,
  // but nothing is asked of the online library until it's loaded.
  const letLoad = await slowLoad(page);
  const asked: string[] = [];
  const listen = (request: Request) => {
    if (request.url().includes('/api/library/changes')) asked.push(request.url());
  };
  page.on('request', listen);
  const synced = page.waitForResponse((response) => response.url().includes('/api/sync/copy'));
  await page.reload();
  await synced;
  await page.waitForTimeout(2000);
  expect(asked, 'the online library was asked before the photos here were loaded').toEqual([]);

  await letLoad();
  await expect(status).toHaveText(/^Online: 1 photo · /, { timeout: 15_000 });
  expect(asked.length).toBeGreaterThan(0);
  // Its original is here, and it's still marked so.
  expect(await markedHere(page, 'IMG_0020.JPG')).toBe(true);
  page.off('request', listen);
});
