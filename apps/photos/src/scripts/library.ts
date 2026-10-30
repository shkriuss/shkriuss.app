/**
 * The photo library on this device, in IndexedDB (@shkriuss/storage/files,
 * docs/adr/0015-photos-app.md). Two kinds of record per photo:
 *
 *   "photo:<id>"        its details and where it is (Photo): small, so the whole list loads fast
 *   "photo-files:<id>"  the original file as it was picked, and the two copies
 *
 * The two are saved together, and deleted together, in one transaction, so
 * a photo never shows without its files, and files are never left behind
 * without their photo (audit 5 E-4; files found so, from an older version,
 * go when the library loads). A photo that's only online (docs/adr/0016)
 * has no original here, and keeps its thumbnail once it's downloaded;
 * "Free up space" changes both records at once. How far this device has
 * caught up with the online library is kept here too
 * ("photos-online:state"), so "Delete all data" forgets it with the photos.
 */
import {
  createFileStore,
  keepFiles,
  putTogether,
  removeLeftOver,
  removeTogether,
  type FileEntry,
} from '@shkriuss/storage/files';
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

/**
 * Every photo's details, newest first. Files left without any details (an
 * older version's deletion or save stopped half-way, or a thumbnail that
 * arrived after its photo was deleted) go too: never shown, they'd stay on
 * the device for good (audit 5 E-4).
 */
export async function loadLibrary(): Promise<Photo[]> {
  changes.loading();
  const photos = (await details.all())
    .map(toPhoto)
    .filter((photo) => photo !== null)
    .sort(byNewest);
  // By the keys (details this version can't read keep their files), in the
  // one transaction that looks: a photo another tab is saving just now, its
  // details and files together, isn't taken for files left over.
  try {
    for (const id of await removeLeftOver(files, details)) forgetThumb(id);
  } catch {
    // Couldn't tidy up (the browser refusing writes, say): the photos are loaded all the same.
  }
  return photos;
}

/**
 * Saves a photo: its files and its details together, in one transaction,
 * so a page closed between them can't leave the files without the photo
 * (audit 5 E-4). Throws if the device is out of space.
 */
export async function savePhoto(photo: Photo, photoFiles: PhotoFiles): Promise<void> {
  await putTogether([files.entry(photoFiles), details.entry(photo)]);
  changes.changed();
  void keepFiles();
}

/**
 * Saves photos' details (where they are has changed, or they're new from
 * another device). `moves`: photos here that are the same as one online
 * (applyChanges), whose files go to the online photo's id first, in the
 * same transaction, so another tab loading the library can't find them
 * without details in between and tidy them away (audit 5 E-4).
 */
export async function saveDetails(
  photos: readonly Photo[],
  moves: readonly { from: string; to: string }[] = [],
): Promise<void> {
  const moved: FileEntry[] = [];
  for (const { from, to } of moves) {
    const found = await getFiles(from);
    if (found) moved.push(files.entry({ ...found, id: to }));
  }
  await putTogether([...moved, ...photos.map((photo) => details.entry(photo))]);
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

/**
 * Keeps a downloaded thumbnail of a photo that's only online (or one this
 * browser can't show). In one transaction with reading what's there: read
 * first and saved after, it put an original back that "Free up space" had
 * just removed in between (audit 5 E-4).
 */
export async function keepThumb(id: string, thumb: Blob): Promise<string> {
  await files.change(id, (existing) => ({ id, original: null, view: null, ...existing, thumb }));
  forgetThumb(id);
  const url = URL.createObjectURL(thumb);
  thumbs.set(id, Promise.resolve(url));
  return url;
}

function forgetThumb(id: string): void {
  void thumbs.get(id)?.then((url) => url && URL.revokeObjectURL(url));
  thumbs.delete(id);
}

/**
 * Deletes photos from this device: details and files together, in one
 * transaction, so a page closed in between can't leave the files behind
 * (audit 5 E-4).
 */
export async function deletePhotos(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeTogether(ids.flatMap((id) => [details.removal(id), files.removal(id)]));
  changes.changed();
  for (const id of ids) forgetThumb(id);
}

/**
 * "Free up space", for one photo that's online: its original and
 * screen-sized copy go from this device; the thumbnail stays, so it still
 * shows. Its details say it's only online in the same transaction, so a
 * photo never says it's here without its original, even if this stops
 * half-way (audit F3-1). Returns the photo as it is now.
 */
export async function removeOriginal(photo: Photo): Promise<Photo> {
  const kept = await getFiles(photo.id);
  const freed = { ...photo, here: false };
  await putTogether([
    details.entry(freed),
    files.entry({ id: photo.id, original: null, view: null, thumb: kept?.thumb ?? null }),
  ]);
  changes.changed();
  return freed;
}

/**
 * The ids of the photos whose original is on this device, from one look at
 * all their files. A photo marked as here may not have it: an older version
 * of Photos could stop "Free up space" half-way.
 */
export async function withOriginals(): Promise<Set<string>> {
  return new Set((await files.all()).filter((found) => found.original).map((found) => found.id));
}

export const loadProgress = (): Promise<OnlineProgress | undefined> =>
  progress.get('state').catch(() => undefined);

export const saveProgress = (state: Omit<OnlineProgress, 'id'>): Promise<void> =>
  progress.putAll([{ ...state, id: 'state' }]);
