/**
 * Repairs' photos: made smaller on the device and kept there, in the files
 * store (@shkriuss/storage/files, docs/adr/0013-photos-on-the-device.md).
 * A repair only keeps their ids. They don't sync and aren't in backups.
 */
import { createFileStore, keepFiles } from '@shkriuss/storage/files';
import { fitWithin, PHOTO_SIZES } from '../lib/repairs.ts';

export interface PhotoFile {
  id: string;
  /** JPEG, at most PHOTO_SIZES.full pixels on its longest side. */
  full: Blob;
  /** JPEG, at most PHOTO_SIZES.thumb pixels on its longest side. */
  thumb: Blob;
}

const files = createFileStore<PhotoFile>('repair-photos');
const QUALITY = 0.82;

/** Shown when a file can't be read as a picture. */
export class NotAPhotoError extends Error {}

function encode(image: ImageBitmap, max: number): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('No canvas.'));
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t save the photo.'))),
      'image/jpeg',
      QUALITY,
    );
  });
}

/**
 * Reads a picked file and makes the photo and its thumbnail. Saving it again
 * also leaves out what the camera wrote into the file, like the location.
 */
export async function makePhoto(file: File): Promise<PhotoFile> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new NotAPhotoError(`${file.name || 'That file'} isn’t a photo.`);
  }
  try {
    const [full, thumb] = await Promise.all([
      encode(image, PHOTO_SIZES.full),
      encode(image, PHOTO_SIZES.thumb),
    ]);
    return { id: crypto.randomUUID(), full, thumb };
  } finally {
    image.close();
  }
}

/** Saves new photos (all or none), and asks the browser to keep them. */
export async function savePhotos(photos: readonly PhotoFile[]): Promise<void> {
  if (photos.length === 0) return;
  await files.putAll(photos);
  void keepFiles();
}

/** Thumbnails shown so far, as object URLs (null: not on this device). */
const thumbs = new Map<string, string | null>();

/** A thumbnail's URL, or null if the photo isn't on this device. */
export async function thumbUrl(id: string): Promise<string | null> {
  const known = thumbs.get(id);
  if (known !== undefined) return known;
  const photo = await files.get(id).catch(() => undefined);
  const url = photo ? URL.createObjectURL(photo.thumb) : null;
  thumbs.set(id, url);
  return url;
}

/** For a photo picked but not saved yet: its thumbnail's URL. */
export function rememberThumb(photo: PhotoFile): string {
  const url = URL.createObjectURL(photo.thumb);
  thumbs.set(photo.id, url);
  return url;
}

/** The full photo, or undefined if it isn't on this device. */
export const getPhoto = (id: string): Promise<PhotoFile | undefined> =>
  files.get(id).catch(() => undefined);

/** Deletes photos from the device (and forgets their thumbnails). */
export async function deletePhotos(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const url = thumbs.get(id);
    if (url) URL.revokeObjectURL(url);
    thumbs.delete(id);
  }
  await files.removeAll(ids).catch(() => undefined);
}
