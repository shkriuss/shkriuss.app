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

/** How many photos (and how many sets of files) are kept on this device. */
export async function stored(page: Page): Promise<{ photos: number; files: number }> {
  const keys = await fileKeys(page);
  return {
    photos: keys.filter((key) => key.startsWith('photo:')).length,
    files: keys.filter((key) => key.startsWith('photo-files:')).length,
  };
}

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

/** How many photos have their original on this device (photos only online don't). */
export const originalsHere = (page: Page) =>
  page.evaluate(
    () =>
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
            resolve(files.result.filter((file: { original: Blob | null }) => file.original).length);
          };
        };
      }),
  );
