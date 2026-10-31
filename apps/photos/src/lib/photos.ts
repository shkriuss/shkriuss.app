/**
 * Photos' rules, as plain functions: a photo's details, the library grouped
 * by month (newest first), and how things are shown. The photos themselves
 * (the original file, a thumbnail and a screen-sized copy) are files on the
 * device: ../scripts/library.ts and docs/adr/0015-photos-app.md. The online
 * library's rules are in online.ts.
 */
import { DATE_LOCALE } from '@shkriuss/ui/locale';

/** What every device knows about a photo (sent to the online library sealed). */
export interface PhotoDetails {
  id: string;
  /**
   * When it was taken: "YYYY-MM-DDTHH:MM:SS" in the camera's local time, from
   * what the camera wrote in the file (else the file's own date).
   */
  taken: string;
  /** When it was added here (ms). */
  added: number;
  /** The original file's name, type and size in bytes. */
  name: string;
  type: string;
  size: number;
  /** In pixels, when this browser can show it; else null. */
  width: number | null;
  height: number | null;
  /** SHA-256 of the original file (base64url), so the same photo isn't added twice. */
  hash: string;
}

/** Where a photo is in the online library: which key sealed it, and its parts' sealed sizes. */
export interface OnlinePlace {
  key: string;
  /** Thumbnail, screen-sized copy, original (0: that part is empty). */
  parts: number[];
}

/** A photo in this device's library. */
export interface Photo extends PhotoDetails {
  /** Its place in the online library; null if it isn't online (yet). */
  online: OnlinePlace | null;
  /** Whether its original is on this device (false: it's only online). */
  here: boolean;
}

/** The parts of a photo online, in order. */
export const PARTS = { thumb: 0, view: 1, original: 2 } as const;

/** The longest side of the thumbnail (for the grid) and of the copy for looking at it. */
export const SIZES = { thumb: 512, view: 2048 } as const;
export const QUALITY = { thumb: 0.8, view: 0.85 } as const;
/** Photos shown at first, and added by each "Show more". */
export const PAGE_SIZE = 120;

const TAKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
/** Longer than any file type a browser gives ("image/heic-sequence"…). */
const MAX_TYPE_LENGTH = 100;
const isSize = (value: unknown) =>
  value === null || (Number.isSafeInteger(value) && (value as number) > 0);

/** Checks a photo's details, read back from the device or from another device. */
export function isPhotoDetails(value: unknown): value is PhotoDetails {
  if (typeof value !== 'object' || value === null) return false;
  const photo = value as Record<string, unknown>;
  return (
    typeof photo['id'] === 'string' &&
    photo['id'] !== '' &&
    typeof photo['taken'] === 'string' &&
    TAKEN.test(photo['taken']) &&
    Number.isFinite(photo['added']) &&
    typeof photo['name'] === 'string' &&
    typeof photo['type'] === 'string' &&
    photo['type'].length <= MAX_TYPE_LENGTH &&
    Number.isSafeInteger(photo['size']) &&
    (photo['size'] as number) >= 0 &&
    isSize(photo['width']) &&
    isSize(photo['height']) &&
    typeof photo['hash'] === 'string'
  );
}

const isOnlinePlace = (value: unknown): value is OnlinePlace =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as OnlinePlace).key === 'string' &&
  Array.isArray((value as OnlinePlace).parts) &&
  (value as OnlinePlace).parts.length === 3 &&
  (value as OnlinePlace).parts.every((size) => Number.isSafeInteger(size) && size >= 0);

/**
 * A photo read back from the device, or null if it isn't one. Photos saved
 * before the online library are on this device, and not online.
 */
export function toPhoto(value: unknown): Photo | null {
  if (!isPhotoDetails(value)) return null;
  const { online, here } = value as Partial<Photo>;
  return { ...value, online: isOnlinePlace(online) ? online : null, here: here !== false };
}

/** The copies made from a photo: a thumbnail for the grid, and one to look at (null: this browser couldn't make them). */
export interface PhotoCopies {
  view: Blob | null;
  thumb: Blob | null;
}

/**
 * The copies to keep when a photo is picked again (its original was only
 * online, say after "Free up space"): the ones just `made` from it, or,
 * where this browser couldn't make them (a HEIC outside Safari), the ones
 * `kept` here already, like a thumbnail downloaded from the online library,
 * made by the device that added the photo. Before, they were replaced with
 * none, and the photo showed as "HEIC" from then on (audit 5 F3-6).
 */
export const copiesToKeep = (made: PhotoCopies, kept: PhotoCopies | undefined): PhotoCopies => ({
  view: made.view ?? kept?.view ?? null,
  thumb: made.thumb ?? kept?.thumb ?? null,
});

/** Just the details, as sent to the online library. */
export const detailsOf = ({
  id,
  taken,
  added,
  name,
  type,
  size,
  width,
  height,
  hash,
}: PhotoDetails): PhotoDetails => ({ id, taken, added, name, type, size, width, height, hash });

const pad = (value: number) => String(value).padStart(2, '0');

/** A moment as "YYYY-MM-DDTHH:MM:SS" in this device's time zone. */
export function localDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Newest taken first; photos taken at the same moment, the last added first. */
export const byNewest = (a: Photo, b: Photo): number =>
  b.taken.localeCompare(a.taken) || b.added - a.added || a.id.localeCompare(b.id);

/** Changes at most this many photos one by one; more, in one pass over the list. */
const FEW_CHANGES = 16;

/** Where `photo` goes in `photos` (in `compare`'s order): after every one before it. */
function placeOf(
  photos: readonly Photo[],
  photo: Photo,
  compare: (a: Photo, b: Photo) => number,
): number {
  let low = 0;
  let high = photos.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(photos[middle] as Photo, photo) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * `photos` (newest first) with `photo`, a new one (not in it yet), put in its
 * place: one search. withChanges would also look through every photo for an
 * old copy of it, which with 100,000 photos took tens of milliseconds for each
 * photo added (review of audit 4 J-1).
 */
export function withAdded(
  photos: readonly Photo[],
  photo: Photo,
  compare: (a: Photo, b: Photo) => number = byNewest,
): Photo[] {
  const next = photos.slice();
  next.splice(placeOf(next, photo, compare), 0, photo);
  return next;
}

/**
 * `photos` (newest first) with the photos in `save` and the ids in `remove`
 * taken out, and those in `save` put in their places: a new list, still in
 * order. Each change used to sort the whole library again, which froze a
 * big library's page for each photo added or uploaded, up to a second and
 * more with 100,000 of them on a phone (audit 4 J-1). Now a few changes
 * cost a search each, and many one pass over the list. A photo in both
 * `save` and `remove` is kept, as saved. One not found where it belongs
 * (moved, or new) is looked for through the list: for new ones, withAdded.
 */
export function withChanges(
  photos: readonly Photo[],
  save: readonly Photo[],
  remove: readonly string[] = [],
  compare: (a: Photo, b: Photo) => number = byNewest,
): Photo[] {
  let next = photos.slice();
  // The last change to each photo.
  const saving = new Map(save.map((photo) => [photo.id, photo]));
  // Most changes leave a photo where it was in the order (uploading it, say):
  // found there in a search, without reading the whole list.
  const moved: Photo[] = [];
  for (const photo of saving.values()) {
    const at = placeOf(next, photo, compare) - 1;
    if (next[at]?.id === photo.id) next[at] = photo;
    else moved.push(photo);
  }
  const gone = new Set([
    ...remove.filter((id) => !saving.has(id)),
    ...moved.map((photo) => photo.id),
  ]);
  if (gone.size <= FEW_CHANGES) {
    for (const id of gone) {
      const at = next.findIndex((photo) => photo.id === id);
      if (at !== -1) next.splice(at, 1);
    }
  } else {
    next = next.filter((photo) => !gone.has(photo.id));
  }
  if (moved.length <= FEW_CHANGES) {
    for (const photo of moved) next.splice(placeOf(next, photo, compare), 0, photo);
    return next;
  }
  // Many: merge the two lists, each in order.
  const added = moved.sort(compare);
  const merged: Photo[] = [];
  let kept = 0;
  for (const photo of added) {
    while (kept < next.length && compare(next[kept] as Photo, photo) <= 0) {
      merged.push(next[kept] as Photo);
      kept += 1;
    }
    merged.push(photo);
  }
  for (; kept < next.length; kept += 1) merged.push(next[kept] as Photo);
  return merged;
}

export interface Month {
  /** "YYYY-MM" */
  month: string;
  photos: Photo[];
}

/** Photos (already sorted newest first) in groups by the month they were taken. */
export function byMonth(photos: readonly Photo[]): Month[] {
  const months: Month[] = [];
  for (const photo of photos) {
    const month = photo.taken.slice(0, 7);
    const last = months.at(-1);
    if (last?.month === month) last.photos.push(photo);
    else months.push({ month, photos: [photo] });
  }
  return months;
}

/** The moment as written, without changing time zone (it has none). */
function asWritten(taken: string): Date {
  const [date = '', time = ''] = taken.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour, minute, second));
}

/**
 * A date format for each locale, made once: making one takes a while, and
 * the grid names every photo it shows.
 */
function dateFormat(options: Intl.DateTimeFormatOptions): (locale: string) => Intl.DateTimeFormat {
  const made = new Map<string, Intl.DateTimeFormat>();
  return (locale) => {
    let format = made.get(locale);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, options);
      made.set(locale, format);
    }
    return format;
  };
}

const monthFormat = dateFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' });
// To the second: photos taken in the same minute have names of their own (audit 3 G-8).
const takenFormat = dateFormat({ dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' });

// Each label below takes a `locale` too, which tests give, so they pass on a
// computer set to any language (audit 3 J-5). Left out, dates are in
// English (DATE_LOCALE) and numbers in the browser's own language.

/** "2026-10" → "October 2026" */
export const monthLabel = (month: string, locale = DATE_LOCALE): string =>
  monthFormat(locale).format(asWritten(`${month}-01T00:00:00`));

/** "2026-10-21T14:03:22" → "Oct 21, 2026, 2:03:22 PM" */
export const takenLabel = (taken: string, locale = DATE_LOCALE): string =>
  takenFormat(locale).format(asWritten(taken));

/** A photo's text alternative: what we know is when it was taken. */
export const photoAlt = (photo: Photo, locale = DATE_LOCALE): string =>
  `Photo taken ${takenLabel(photo.taken, locale)}`;

/**
 * Which photo the viewer shows (`index` from 0), read out when Next or
 * Previous shows another (audit 3 G-8): "Photo 2 of 3, taken Oct 20, 2026,
 * 2:05:03 PM".
 */
export const shownLabel = (photo: Photo, index: number, count: number, locale?: string): string =>
  `Photo ${(index + 1).toLocaleString(locale)} of ${count.toLocaleString(locale)}, taken ${takenLabel(photo.taken, locale)}`;

/** "1 photo", "2 photos" */
export const countLabel = (count: number, one: string, many: string, locale?: string): string =>
  `${count.toLocaleString(locale)} ${count === 1 ? one : many}`;

/** A size as it's shown: to one decimal below 10, else whole ("4.2", "48"). */
function rounded(value: number): number {
  const tenths = Math.round(value * 10) / 10;
  return tenths < 10 ? tenths : Math.round(value);
}

/** Bytes as people read them on phones (1 KB = 1,000 bytes): "820 KB", "4.2 MB", "1.3 GB". */
export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < 1000) return countLabel(bytes, 'byte', 'bytes', locale);
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  // Rounded as it's shown before the unit is chosen, so 999,999 bytes is
  // "1.0 MB", not "1,000 KB" (audit 3 F3-9).
  while (rounded(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const shown = rounded(value);
  const digits = shown < 10 ? 1 : 0;
  return `${shown.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`;
}

/** "12 photos · 48 MB" */
export function librarySummary(photos: readonly Photo[], locale?: string): string {
  const bytes = photos.reduce((sum, photo) => sum + photo.size, 0);
  return `${countLabel(photos.length, 'photo', 'photos', locale)} · ${formatBytes(bytes, locale)}`;
}

/**
 * File extensions by type. A Map: a type comes from another device, and
 * looked up in a plain object, "constructor" or "toString" would find the
 * object's own functions, breaking the whole grid (audit 4 C-2).
 */
const EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

/**
 * A guess, from what the browser says about itself, that it's on an iPhone
 * or iPad (audit 3 F3-3). There, the photo picker likely gives JPEG copies
 * of HEIC photos instead of the originals (every browser on them uses
 * Safari's), which the app can't change, so the page says so. iPads say
 * they're Macs, but only they have a touch screen. Browsers can say
 * anything, so it's only a guess: the hint names the devices it's about.
 */
export function isIPhoneOrIPad(userAgent: string, touchPoints: number): boolean {
  return (
    /\b(?:iPhone|iPad|iPod)\b/.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && touchPoints > 1)
  );
}

/**
 * A file name's extension: a few letters, maybe with digits after the
 * first ("jpg", "heic", "mp4"). Not a number: "holiday.2019" has none
 * (audit 5 F3-10).
 */
const EXTENSION = /\.([A-Za-z][A-Za-z0-9]{0,4})$/;

/** The kind of file, for people: "JPG", "HEIC"… */
export function formatLabel(photo: Pick<Photo, 'name' | 'type'>): string {
  const fromName = EXTENSION.exec(photo.name)?.[1];
  return (
    fromName ??
    EXTENSIONS.get(photo.type) ??
    (photo.type.split('/')[1] || 'file')
  ).toUpperCase();
}

/** The name to save the original as: its own name, made safe, with an extension. */
export function downloadName(photo: Pick<Photo, 'name' | 'type' | 'taken'>): string {
  // Characters files can't have in their names, and invisible ones, become "-".
  // Invisible ones include direction marks, which can make "gpj.exe" show as "exe.jpg".
  const cleaned = [...photo.name]
    .map((char) =>
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char) || '\\/:*?"<>|'.includes(char) ? '-' : char,
    )
    .join('')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\s]+/, '')
    .trim();
  // Cut by whole characters, so an emoji is never cut in half (audit 3 C-6);
  // never ending in a dot or a space, before the extension ("photo..jpg").
  const safe = [...cleaned]
    .slice(0, 120)
    .join('')
    .replace(/[.\s]+$/, '');
  const fallback = `photo-${photo.taken.replace(/[:T]/g, '-')}`;
  const name = safe || fallback;
  const extension = EXTENSIONS.get(photo.type);
  return EXTENSION.test(name) || !extension ? name : `${name}.${extension}`;
}

/** What happened when photos were picked, for a message. */
export interface Added {
  added: number;
  /** Photos that were only online: the same file puts their original back here. */
  restored?: number;
  /** Already in the library (the same file). */
  duplicates: number;
  /** Files that aren't pictures. */
  notPhotos: number;
  /** Couldn't be saved (out of space, or another problem). */
  failed: number;
}

export function addedMessage(
  { added, restored = 0, duplicates, notPhotos, failed }: Added,
  locale?: string,
): string {
  const count = (value: number, one: string, many: string) => countLabel(value, one, many, locale);
  const parts = [
    added > 0 || restored > 0 ? '' : 'No photos were added.',
    added > 0 ? `Added ${count(added, 'photo', 'photos')}.` : '',
    restored > 0 ? `${count(restored, 'original is', 'originals are')} back on this device.` : '',
    duplicates > 0 ? `${count(duplicates, 'photo was', 'photos were')} already here.` : '',
    notPhotos > 0 ? `${count(notPhotos, 'file isn’t a photo', 'files aren’t photos')}.` : '',
    failed > 0 ? `${count(failed, 'photo couldn’t', 'photos couldn’t')} be saved.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
