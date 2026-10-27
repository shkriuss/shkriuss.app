// Shared by Photos' browser tests: picking photos, and counting what's kept
// on the device. Making photos is shared with Repairs (tests/e2e/photos.ts).
import type { Page } from '@playwright/test';
import { fileKeys } from '../../../tests/e2e/photos.ts';

export { jpeg, naturalWidth, picture, withExif } from '../../../tests/e2e/photos.ts';

/** Picks files with "Add photos", and waits until they're all read. */
export async function addPhotos(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles(files);
  // Busy (aria-disabled) while the photos are added.
  await page
    .getByRole('button', { name: 'Add photos' })
    .and(page.locator(':enabled:not([aria-disabled="true"])'))
    .waitFor();
}

/** Whether the photo saved as `name` is marked as on this device (its original here). */
export const markedHere = (page: Page, name: string) =>
  page.evaluate(
    (name) =>
      new Promise<boolean | null>((resolve, reject) => {
        const request = indexedDB.open('shkriuss-files');
        request.onerror = () => reject(request.error ?? new Error('No database'));
        request.onsuccess = () => {
          const database = request.result;
          const range = IDBKeyRange.bound('photo:', 'photo;', false, true);
          const photos = database.transaction('files').objectStore('files').getAll(range);
          photos.onsuccess = () => {
            database.close();
            const found = (photos.result as { name: string; here?: boolean }[]).find(
              (photo) => photo.name === name,
            );
            resolve(found ? found.here !== false : null);
          };
        };
      }),
    name,
  );

/** How many photos (and how many sets of files) are kept on this device. */
export async function stored(page: Page): Promise<{ photos: number; files: number }> {
  const keys = await fileKeys(page);
  return {
    photos: keys.filter((key) => key.startsWith('photo:')).length,
    files: keys.filter((key) => key.startsWith('photo-files:')).length,
  };
}

/** How far this device has caught up with the online library ("photos-online:state"), if at all. */
export const onlinePlace = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ library: string; epoch: string | null; since: number } | null>((resolve) => {
        const request = indexedDB.open('shkriuss-files');
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction('files').objectStore('files').get('photos-online:state');
          get.onsuccess = () => {
            database.close();
            resolve(
              (get.result as { library: string; epoch: string | null; since: number }) ?? null,
            );
          };
        };
      }),
  );

/** How many photos are marked as on this device without their original there (never any). */
export const hereWithoutOriginal = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('shkriuss-files');
        request.onerror = () => reject(request.error ?? new Error('No database'));
        request.onsuccess = () => {
          const database = request.result;
          const table = database.transaction('files').objectStore('files');
          const range = (kind: string) => IDBKeyRange.bound(`${kind}:`, `${kind};`, false, true);
          const photos = table.getAll(range('photo'));
          const files = table.getAll(range('photo-files'));
          // Requests in one transaction finish in order: the photos are read by now.
          files.onsuccess = () => {
            database.close();
            const originals = new Set(
              (files.result as { id: string; original: Blob | null }[])
                .filter((file) => file.original)
                .map((file) => file.id),
            );
            const marked = photos.result as { id: string; here?: boolean }[];
            resolve(
              marked.filter((photo) => photo.here !== false && !originals.has(photo.id)).length,
            );
          };
        };
      }),
  );

/** How many photos have this part (the original, the thumbnail or the screen-sized copy) on this device. */
const partsHere = (page: Page, part: 'original' | 'thumb' | 'view') =>
  page.evaluate(
    (part) =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open('shkriuss-files');
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve(0);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('files')) {
            database.close();
            resolve(0);
            return;
          }
          const range = IDBKeyRange.bound('photo-files:', 'photo-files;', false, true);
          const files = database.transaction('files').objectStore('files').getAll(range);
          files.onsuccess = () => {
            database.close();
            resolve(files.result.filter((file: Record<string, Blob | null>) => file[part]).length);
          };
        };
      }),
    part,
  );

/** How many photos have their original on this device (photos only online don't). */
export const originalsHere = (page: Page) => partsHere(page, 'original');

/** How many photos have a thumbnail on this device. */
export const thumbsHere = (page: Page) => partsHere(page, 'thumb');

/** Takes the thumbnail and screen-sized copy of every photo away from this device, keeping originals. */
export const dropCopies = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('shkriuss-files');
        request.onerror = () => reject(request.error ?? new Error('No database'));
        request.onsuccess = () => {
          const database = request.result;
          const run = database.transaction('files', 'readwrite');
          const table = run.objectStore('files');
          const files = table.getAll(
            IDBKeyRange.bound('photo-files:', 'photo-files;', false, true),
          );
          files.onsuccess = () => {
            for (const file of files.result as { id: string }[]) {
              table.put({ ...file, thumb: null, view: null }, `photo-files:${file.id}`);
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
