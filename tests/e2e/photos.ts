// Photos in browser tests, for Photos and Repairs (audit J-16): making JPEGs
// (with the date a camera writes in them), and looking at the files an app
// keeps on the device (@shkriuss/storage/files).
import type { Locator, Page } from '@playwright/test';

/** A JPEG made in the browser, camera-sized by default (4000 × 3000). */
export async function picture(
  page: Page,
  { width = 4000, height = 3000, color = '#c33' } = {},
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h, fill]) => {
      const canvas = new OffscreenCanvas(w, h);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.fillStyle = fill;
      context.fillRect(0, 0, w, h);
      context.fillStyle = '#fff';
      context.fillRect(w / 4, h / 4, w / 2, h / 2);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      let text = '';
      for (const byte of new Uint8Array(await blob.arrayBuffer()))
        text += String.fromCharCode(byte);
      return btoa(text);
    },
    [width, height, color] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** The JPEG with an Exif segment saying when it was taken ("YYYY:MM:DD HH:MM:SS"), as cameras write. */
export function withExif(jpeg: Buffer, taken: string): Buffer {
  const date = Buffer.from(`${taken}\0`, 'latin1');
  // Big-endian TIFF: the first list points to the Exif list, which has DateTimeOriginal.
  const tiff = Buffer.alloc(8 + 18 + 18 + date.length);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x8769, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(26, 18);
  tiff.writeUInt32BE(0, 22);
  tiff.writeUInt16BE(1, 26);
  tiff.writeUInt16BE(0x9003, 28);
  tiff.writeUInt16BE(2, 30);
  tiff.writeUInt32BE(date.length, 32);
  tiff.writeUInt32BE(44, 36);
  tiff.writeUInt32BE(0, 40);
  date.copy(tiff, 44);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

/** A file to pick, for setFiles(). */
export const jpeg = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/jpeg', buffer });

export const naturalWidth = (image: Locator) =>
  image.evaluate((element) => (element as HTMLImageElement).naturalWidth);

/** The keys of the files kept on this device; none before the app has made its database. */
export const fileKeys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open('shkriuss-files');
        // Not made yet: leave that to the app. Made here, it would have no
        // table, and the app (finding it already there) couldn't save files.
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('files')) {
            database.close();
            resolve([]);
            return;
          }
          const keys = database.transaction('files').objectStore('files').getAllKeys();
          keys.onsuccess = () => {
            database.close();
            resolve(keys.result.map(String));
          };
        };
      }),
  );
