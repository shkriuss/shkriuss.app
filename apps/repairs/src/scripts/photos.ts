/**
 * Repairs' photos: made smaller on the device and kept there, in the files
 * store (@shkriuss/storage/files, docs/adr/0013-photos-on-the-device.md).
 * A repair only keeps their ids. They aren't in backups.
 *
 * With sync on, they go to the other devices too, sealed on the device
 * (docs/adr/0014-syncing-photos.md). A device without a photo downloads its
 * thumbnail when the list first shows it, and the full photo when it's
 * opened, then keeps them like its own.
 */
import { createFileStore, keepFiles } from '@shkriuss/storage/files';
import type { SyncClient } from '@shkriuss/sync';
import {
  fitWithin,
  fromPhotoFile,
  MAX_PHOTO_BYTES,
  PHOTO_QUALITIES,
  PHOTO_SIZES,
  photoFile,
  type PhotoPart,
} from '../lib/repairs.ts';

export interface PhotoFile {
  id: string;
  /** JPEG, at most PHOTO_SIZES.full pixels on its longest side. Missing until it's downloaded. */
  full?: Blob;
  /** JPEG, at most PHOTO_SIZES.thumb pixels on its longest side. */
  thumb: Blob;
}

const files = createFileStore<PhotoFile>('repair-photos');

/** Shown when a file can't be read as a picture. */
export class NotAPhotoError extends Error {}

function encode(image: ImageBitmap, max: number, quality: number): Promise<Blob> {
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
      quality,
    );
  });
}

/** Saved at the best quality that's small enough to sync. */
async function encodeSmallEnough(image: ImageBitmap, max: number): Promise<Blob> {
  let blob: Blob | undefined;
  for (const quality of PHOTO_QUALITIES) {
    blob = await encode(image, max, quality);
    if (blob.size <= MAX_PHOTO_BYTES) break;
  }
  return blob as Blob;
}

/**
 * Reads a picked file and makes the photo and its thumbnail. Saving it again
 * also leaves out what the camera wrote into the file, like the location.
 */
export async function makePhoto(file: File): Promise<PhotoFile & { full: Blob }> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new NotAPhotoError(`${file.name || 'That file'} isn’t a photo.`);
  }
  try {
    const [full, thumb] = await Promise.all([
      encodeSmallEnough(image, PHOTO_SIZES.full),
      encodeSmallEnough(image, PHOTO_SIZES.thumb),
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

// ---------- From other devices ----------

let sync: SyncClient | null = null;

/** Where photos from other devices come from: the app's sync. */
export function downloadPhotosWith(client: SyncClient): void {
  sync = client;
}

/** At most this many downloads at once, so a long list doesn't start dozens. */
const DOWNLOADS = 3;
let downloading = 0;
const waiting: (() => void)[] = [];

async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (downloading < DOWNLOADS) downloading += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    // Hand the place on to the next download, or give it up.
    const next = waiting.shift();
    if (next) next();
    else downloading -= 1;
  }
}

/** Downloads one part of a photo from another device and keeps it here; null if it can't. */
async function download(id: string, part: PhotoPart): Promise<Blob | null> {
  const client = sync;
  if (!client?.status().on) return null;
  const bytes = await oneAtATime(() => client.download(photoFile(id, part)));
  if (!bytes) return null;
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const here = await files.get(id).catch(() => undefined);
  // A full photo is only kept with its thumbnail (which the list shows first).
  const photo = part === 'thumb' ? { ...here, id, thumb: blob } : here && { ...here, full: blob };
  if (photo) await savePhotos([photo]).catch(() => undefined);
  return blob;
}

/** The bytes of a photo file, for sync to upload (null if it isn't here). */
export async function readPhotoFile(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const which = fromPhotoFile(file);
  const photo = which ? await files.get(which.photo).catch(() => undefined) : undefined;
  const blob = which && photo?.[which.part];
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

// ---------- Showing them ----------

/** Thumbnails shown so far, as object URLs. */
const thumbs = new Map<string, string>();
/** Thumbnails being found, so asking twice finds them once. */
const finding = new Map<string, Promise<string | null>>();
/** When downloading a thumbnail last failed: tried again after a while, not at every change. */
const missed = new Map<string, number>();
const RETRY_MS = 15 * 1000;

/** A thumbnail's URL, downloading it if it's online; null if it isn't on this device. */
export function thumbUrl(id: string): Promise<string | null> {
  const known = thumbs.get(id);
  if (known) return Promise.resolve(known);
  let found = finding.get(id);
  if (!found) {
    found = (async () => {
      const photo = await files.get(id).catch(() => undefined);
      let thumb: Blob | null = photo?.thumb ?? null;
      if (!thumb && Date.now() - (missed.get(id) ?? 0) >= RETRY_MS) {
        thumb = await download(id, 'thumb').catch(() => null);
        if (!thumb) missed.set(id, Date.now());
      }
      if (!thumb) return null;
      const url = URL.createObjectURL(thumb);
      thumbs.set(id, url);
      return url;
    })().finally(() => finding.delete(id));
    finding.set(id, found);
  }
  return found;
}

/** For a photo picked but not saved yet: its thumbnail's URL. */
export function rememberThumb(photo: PhotoFile): string {
  const url = URL.createObjectURL(photo.thumb);
  thumbs.set(photo.id, url);
  return url;
}

/**
 * The full photo, downloading it if it's online. Without a connection, the
 * thumbnail stands in (`full` false), so there's still something to see.
 */
export async function getPhoto(id: string): Promise<{ blob: Blob; full: boolean } | null> {
  const photo = await files.get(id).catch(() => undefined);
  const full = photo?.full ?? (await download(id, 'full').catch(() => null));
  if (full) return { blob: full, full: true };
  return photo ? { blob: photo.thumb, full: false } : null;
}

/** Deletes photos from the device (and forgets their thumbnails). */
export async function deletePhotos(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const url = thumbs.get(id);
    if (url) URL.revokeObjectURL(url);
    thumbs.delete(id);
  }
  await files.removeAll(ids).catch(() => undefined);
}
