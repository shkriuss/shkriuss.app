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
const takenFormat = dateFormat({ dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

// Each label below takes a `locale` too, which tests give, so they pass on a
// computer set to any language (audit 3 J-5). Left out, dates are in
// English (DATE_LOCALE) and numbers in the browser's own language.

/** "2026-10" → "October 2026" */
export const monthLabel = (month: string, locale = DATE_LOCALE): string =>
  monthFormat(locale).format(asWritten(`${month}-01T00:00:00`));

/** "2026-10-21T14:03:22" → "Oct 21, 2026, 2:03 PM" */
export const takenLabel = (taken: string, locale = DATE_LOCALE): string =>
  takenFormat(locale).format(asWritten(taken));

/** A photo's text alternative: what we know is when it was taken. */
export const photoAlt = (photo: Photo, locale = DATE_LOCALE): string =>
  `Photo taken ${takenLabel(photo.taken, locale)}`;

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

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** The kind of file, for people: "JPG", "HEIC"… */
export function formatLabel(photo: Pick<Photo, 'name' | 'type'>): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(photo.name)?.[1];
  return (fromName ?? EXTENSIONS[photo.type] ?? (photo.type.split('/')[1] || 'file')).toUpperCase();
}

/** The name to save the original as: its own name, made safe, with an extension. */
export function downloadName(photo: Pick<Photo, 'name' | 'type' | 'taken'>): string {
  // Characters files can't have in their names, and invisible ones, become "-".
  // Invisible ones include direction marks, which can make "gpj.exe" show as "exe.jpg".
  const safe = [...photo.name]
    .map((char) =>
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char) || '\\/:*?"<>|'.includes(char) ? '-' : char,
    )
    .join('')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120);
  const fallback = `photo-${photo.taken.replace(/[:T]/g, '-')}`;
  const name = safe || fallback;
  const extension = EXTENSIONS[photo.type];
  return /\.[A-Za-z0-9]{1,5}$/.test(name) || !extension ? name : `${name}.${extension}`;
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
