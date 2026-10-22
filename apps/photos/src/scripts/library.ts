/**
 * The photo library on this device, in IndexedDB (@shkriuss/storage/files,
 * docs/adr/0015-photos-app.md). Two kinds of record per photo:
 *
 *   "photo:<id>"        its details (Photo): small, so the whole list loads fast
 *   "photo-files:<id>"  the original file as it was picked, and the two copies
 *
 * The files are saved first and the details last, so a photo only shows once
 * everything is saved; deleting goes the other way round.
 */
import { createFileStore, keepFiles } from '@shkriuss/storage/files';
import { byNewest, isPhoto, type Photo } from '../lib/photos.ts';

export interface PhotoFiles {
  id: string;
  /** Exactly as picked. */
  original: Blob;
  /** JPEG copies made smaller (null when this browser can't show the original). */
  view: Blob | null;
  thumb: Blob | null;
}

const details = createFileStore<Photo>('photo');
const files = createFileStore<PhotoFiles>('photo-files');

/** Every photo's details, newest first. */
export async function loadLibrary(): Promise<Photo[]> {
  return (await details.all()).filter(isPhoto).sort(byNewest);
}

/** Saves a photo: its files, then its details. Throws if the device is out of space. */
export async function savePhoto(photo: Photo, photoFiles: PhotoFiles): Promise<void> {
  await files.putAll([photoFiles]);
  try {
    await details.putAll([photo]);
  } catch (error) {
    await files.removeAll([photo.id]).catch(() => undefined);
    throw error;
  }
  void keepFiles();
}

export const getFiles = (id: string): Promise<PhotoFiles | undefined> =>
  files.get(id).catch(() => undefined);

/** Thumbnails shown so far, as object URLs (null: there's no thumbnail). */
const thumbs = new Map<string, Promise<string | null>>();

/** A photo's thumbnail URL, or null if it has none (this browser can't show it). */
export function thumbUrl(id: string): Promise<string | null> {
  let url = thumbs.get(id);
  if (!url) {
    url = getFiles(id).then((found) => (found?.thumb ? URL.createObjectURL(found.thumb) : null));
    thumbs.set(id, url);
  }
  return url;
}

/** Deletes photos from this device: details first, then files. */
export async function deletePhotos(ids: readonly string[]): Promise<void> {
  await details.removeAll(ids);
  for (const id of ids) {
    void thumbs.get(id)?.then((url) => url && URL.revokeObjectURL(url));
    thumbs.delete(id);
  }
  await files.removeAll(ids).catch(() => undefined);
}
