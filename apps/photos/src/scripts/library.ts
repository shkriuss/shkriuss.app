/**
 * The photo library on this device, in IndexedDB (@shkriuss/storage/files,
 * docs/adr/0015-photos-app.md). Two kinds of record per photo:
 *
 *   "photo:<id>"        its details and where it is (Photo): small, so the whole list loads fast
 *   "photo-files:<id>"  the original file as it was picked, and the two copies
 *
 * The files are saved first and the details last, so a photo only shows once
 * everything is saved; deleting goes the other way round. A photo that's
 * only online (docs/adr/0016) has no original here, and keeps its thumbnail
 * once it's downloaded. How far this device has caught up with the online
 * library is kept here too ("photos-online:state"), so "Delete all data"
 * forgets it with the photos.
 */
import { createFileStore, keepFiles } from '@shkriuss/storage/files';
import { changeCount } from '../lib/changes.ts';
import { byNewest, toPhoto, type Photo } from '../lib/photos.ts';

export interface PhotoFiles {
  id: string;
  /** Exactly as picked (null when the photo is only online). */
  original: Blob | null;
  /** JPEG copies made smaller (null when this browser can't show the original, or not here). */
  view: Blob | null;
  thumb: Blob | null;
}

/** How far this device has caught up with the online library, and what's still to delete there. */
export interface OnlineProgress {
  id: 'state';
  library: string;
  /** The library's lifetime: when it changes, the library was deleted and started again. */
  epoch: string | null;
  /** The last change seen. */
  since: number;
  /** Photos deleted here that are still to be deleted online. */
  removals: string[];
}

const details = createFileStore<Photo>('photo');
const files = createFileStore<PhotoFiles>('photo-files');
const progress = createFileStore<OnlineProgress>('photos-online');

/** Every change to the photos' details counts, so other Photos tabs know to load them again. */
const changes = changeCount();

/** True if another Photos tab changed the photos since this one last loaded or changed them. */
export const changedElsewhere = (): boolean => changes.changedElsewhere();

/** Every photo's details, newest first. */
export async function loadLibrary(): Promise<Photo[]> {
  changes.loading();
  return (await details.all())
    .map(toPhoto)
    .filter((photo) => photo !== null)
    .sort(byNewest);
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
  changes.changed();
  void keepFiles();
}

/** Saves photos' details (where they are has changed, or they're new from another device). */
export async function saveDetails(photos: readonly Photo[]): Promise<void> {
  await details.putAll(photos);
  changes.changed();
}

export const getFiles = (id: string): Promise<PhotoFiles | undefined> =>
  files.get(id).catch(() => undefined);

/** Thumbnails shown so far, as object URLs (null: there's no thumbnail). */
const thumbs = new Map<string, Promise<string | null>>();

/** A photo's thumbnail URL from this device, or null if it has none here. */
export function thumbUrl(id: string): Promise<string | null> {
  let url = thumbs.get(id);
  if (!url) {
    url = getFiles(id).then((found) => (found?.thumb ? URL.createObjectURL(found.thumb) : null));
    thumbs.set(id, url);
  }
  return url;
}

/** Keeps a downloaded thumbnail of a photo that's only online. */
export async function keepThumb(id: string, thumb: Blob): Promise<string> {
  const existing = await getFiles(id);
  await files.putAll([{ id, original: null, view: null, ...existing, thumb }]);
  forgetThumb(id);
  const url = URL.createObjectURL(thumb);
  thumbs.set(id, Promise.resolve(url));
  return url;
}

function forgetThumb(id: string): void {
  void thumbs.get(id)?.then((url) => url && URL.revokeObjectURL(url));
  thumbs.delete(id);
}

/** Deletes photos from this device: details first, then files. */
export async function deletePhotos(ids: readonly string[]): Promise<void> {
  await details.removeAll(ids);
  changes.changed();
  for (const id of ids) forgetThumb(id);
  await files.removeAll(ids).catch(() => undefined);
}

/**
 * "Free up space": the originals and screen-sized copies of photos that are
 * online go from this device; thumbnails stay, so every photo still shows.
 */
export async function removeOriginals(photos: readonly Photo[]): Promise<void> {
  for (const photo of photos) {
    const kept = await getFiles(photo.id);
    await files.putAll([{ id: photo.id, original: null, view: null, thumb: kept?.thumb ?? null }]);
  }
  await details.putAll(photos.map((photo) => ({ ...photo, here: false })));
  changes.changed();
}

/** Gives a photo's files to another id (the same photo, as it's known online). */
export async function moveFiles(from: string, to: string): Promise<void> {
  const found = await getFiles(from);
  if (found) await files.putAll([{ ...found, id: to }]);
}

export const loadProgress = (): Promise<OnlineProgress | undefined> =>
  progress.get('state').catch(() => undefined);

export const saveProgress = (state: Omit<OnlineProgress, 'id'>): Promise<void> =>
  progress.putAll([{ ...state, id: 'state' }]);
