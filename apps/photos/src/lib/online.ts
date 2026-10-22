/**
 * The online library's rules for Photos, as plain functions
 * (docs/adr/0016-online-photo-library.md): what changes from other devices
 * do to this device's photos, which photos go up next, what "Free up space"
 * frees, and what the status line says; and how the libraries' records are
 * kept. The work itself is in ../scripts/online.ts.
 */
import {
  isLibraryRecord,
  tidyRecords,
  type LibraryChange,
  type LibraryProblem,
  type LibraryRecord,
} from '@shkriuss/library';
import type { StoreOptions } from '@shkriuss/storage';
import {
  countLabel,
  detailsOf,
  formatBytes,
  isPhotoDetails,
  type OnlinePlace,
  type Photo,
} from './photos.ts';

/** The online libraries' records, kept in the synced copy (they move with a new account key). */
export interface Records {
  items: LibraryRecord[];
}

const isRecords = (value: unknown): value is Records =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Records).items) &&
  (value as Records).items.every(isLibraryRecord);

/**
 * The records' store. Version 2 keeps one record per library; version 1's
 * one record ("library") becomes the record of its library. Records of
 * version 1 can still come from other devices, and are tidied the same way.
 */
export const RECORDS: StoreOptions<Records> = {
  key: 'library',
  version: 2,
  fallback: () => ({ items: [] }),
  validate: isRecords,
  migrate: (old, version) =>
    version === 1 && isRecords(old) ? { items: [...tidyRecords(old.items)] } : undefined,
};

/** What a page of changes from the online library does here. */
export interface Applied {
  /** Photos to save here: new from another device, or now known to be online. */
  save: Photo[];
  /** Photos to delete here: deleted on another device, or kept under another id. */
  remove: string[];
  /** Photos here that are the same as one online: their files go to its id first. */
  moves: { from: string; to: string }[];
  /** Photos online twice (added on two devices at once): the extra ones, to delete online. */
  duplicates: string[];
  /** Changes whose details weren't a photo's. */
  skipped: number;
}

const samePlace = (a: OnlinePlace | null, b: OnlinePlace) =>
  a !== null && a.key === b.key && a.parts.join() === b.parts.join();

/**
 * Applies changes from the online library to this device's photos. The
 * same photo (by SHA-256) is kept once: one only here takes the online
 * one's id; of two online, the smaller id stays (every device agrees).
 */
export function applyChanges(
  photos: ReadonlyMap<string, Photo>,
  changes: readonly LibraryChange[],
): Applied {
  const working = new Map(photos);
  const byHash = new Map([...photos.values()].map((photo) => [photo.hash, photo.id]));
  const save = new Map<string, Photo>();
  const remove = new Set<string>();
  const moves: Applied['moves'] = [];
  const duplicates: string[] = [];
  let skipped = 0;

  const keep = (photo: Photo) => {
    working.set(photo.id, photo);
    byHash.set(photo.hash, photo.id);
    save.set(photo.id, photo);
    remove.delete(photo.id);
  };
  const drop = (id: string) => {
    const photo = working.get(id);
    if (photo && byHash.get(photo.hash) === id) byHash.delete(photo.hash);
    working.delete(id);
    save.delete(id);
    remove.add(id);
  };

  for (const change of changes) {
    if ('deleted' in change) {
      if (working.has(change.id)) drop(change.id);
      continue;
    }
    if (!isPhotoDetails(change.details) || change.details.id !== change.id) {
      skipped += 1;
      continue;
    }
    const online = { key: change.key, parts: change.parts };
    const known = working.get(change.id);
    if (known) {
      if (!samePlace(known.online, online)) keep({ ...known, online });
      continue;
    }
    const twinId = byHash.get(change.details.hash);
    const twin = twinId === undefined ? undefined : working.get(twinId);
    if (twin?.online && twin.id < change.id) {
      duplicates.push(change.id);
      continue;
    }
    if (twin) {
      // The online photo takes the twin's place (and its original, if it's here).
      if (twin.online) duplicates.push(twin.id);
      if (twin.here) moves.push({ from: twin.id, to: change.id });
      drop(twin.id);
    }
    keep({ ...detailsOf(change.details), online, here: twin?.here ?? false });
  }
  return { save: [...save.values()], remove: [...remove], moves, duplicates, skipped };
}

/** Photos that go up next: here, not online yet, newest first (as the library is). */
export const waitingToGoUp = (photos: readonly Photo[], skip: ReadonlySet<string>): Photo[] =>
  photos.filter((photo) => photo.here && !photo.online && !skip.has(photo.id));

/** What "Free up space" would remove from this device: originals that are online. */
export function freeable(photos: readonly Photo[]): { photos: Photo[]; bytes: number } {
  const online = photos.filter((photo) => photo.here && photo.online);
  return { photos: online, bytes: online.reduce((sum, photo) => sum + photo.size, 0) };
}

/** Photos that are only online: they need the online library to be seen. */
export const onlyOnline = (photos: readonly Photo[]): Photo[] =>
  photos.filter((photo) => !photo.here);

export type OnlineProblem =
  | Exclude<LibraryProblem, 'wrong-code' | 'too-many-tries' | 'deleted' | 'exists' | 'too-big'>
  /** This browser won't save. */
  | 'storage';

/** Everything the status line needs. */
export interface OnlineState {
  /** Whether the library has been reached at least once since Photos opened. */
  checked: boolean;
  unlocked: boolean;
  usage: { items: number; bytes: number } | null;
  /** Photos here that aren't online yet. */
  waiting: number;
  /** Photos too big to go online. */
  tooBig: number;
  problem: OnlineProblem | null;
  /** For 'daily-limit': when uploads start again (ms). */
  retryAt: number | null;
  /** The library this device used was taken by a device with an old account key. */
  taken: boolean;
}

/** Problems that only stop photos going up: what's online is still there. */
const UPLOADS_ONLY: ReadonlySet<OnlineProblem> = new Set(['full', 'daily-limit', 'not-set-up']);

/**
 * Whether "Free up space" can be offered: only once the library in use has
 * answered since Photos opened, and while it isn't being deleted, moved or
 * out of reach. Before anything goes, it's asked again.
 */
export const canFreeUp = (state: OnlineState): boolean =>
  state.checked && (state.problem === null || UPLOADS_ONLY.has(state.problem));

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const TAKEN =
  'Your online library was taken by a device that still had your old account key, perhaps the lost one, so it can’t be used any more. Photos that were only in it can’t be brought back. Photos on this device go into a new online library.';

/** The status line: what happened to the library this device used, if it was taken, then how it's going. */
export const onlineMessage = (state: OnlineState): string =>
  state.taken ? `${TAKEN} ${statusOf(state)}` : statusOf(state);

function statusOf(state: OnlineState): string {
  const tooBig =
    state.tooBig > 0
      ? ` ${countLabel(state.tooBig, 'photo is', 'photos are')} too big to keep online (over 95 MB), so ${state.tooBig === 1 ? 'it stays' : 'they stay'} on this device.`
      : '';
  const waiting = countLabel(state.waiting, 'photo', 'photos');
  switch (state.problem) {
    case 'not-set-up':
      return 'Online storage isn’t set up yet, so photos can’t go online. Everything still works on this device.';
    case 'locked':
      return 'To keep photos online, enter the storage code.';
    case 'full':
      return `The online library is full, so ${waiting} stay on this device.`;
    case 'daily-limit':
      return `That’s all the uploads for today. The other ${waiting} go online after ${timeFormat.format(state.retryAt ?? Date.now())}.`;
    case 'wiping':
      return 'The online library is being deleted. Try again in a few minutes.';
    case 'offline':
      return 'Couldn’t reach the online library: no connection. It will try again.';
    case 'server':
    case 'moved':
      return 'Couldn’t reach the online library just now. It will try again later.';
    case 'storage':
      return 'This browser won’t save. Is it in private mode, or is storage blocked?';
    case null:
      break;
  }
  if (!state.checked) return 'Checking the online library…';
  if (!state.unlocked) return 'To keep photos online, enter the storage code.';
  if (state.waiting > 0) {
    return `Putting photos online: ${waiting} to go. Keep Photos open until it’s done.${tooBig}`;
  }
  const usage = state.usage ?? { items: 0, bytes: 0 };
  return `Online: ${countLabel(usage.items, 'photo', 'photos')} · ${formatBytes(usage.bytes)}.${tooBig}`;
}
