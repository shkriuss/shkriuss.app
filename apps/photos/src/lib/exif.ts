/**
 * When a photo was taken, from what the camera wrote into a JPEG (Exif).
 *
 * A JPEG is a list of segments; the camera's details are in the APP1 segment
 * that starts with "Exif". Inside is a small TIFF file: lists of tagged values
 * (IFDs). The date the photo was taken is DateTimeOriginal (in the Exif list),
 * else DateTime (in the first list), as "YYYY:MM:DD HH:MM:SS" in the camera's
 * local time, with no time zone. Anything malformed gives null.
 */

const SOI = 0xffd8;
const APP1 = 0xffe1;
const SOS = 0xffda;
const EXIF_IFD = 0x8769;
const DATE_TIME = 0x0132;
const DATE_TIME_ORIGINAL = 0x9003;
const ASCII = 2;

/** The date and time a JPEG was taken, as "YYYY-MM-DDTHH:MM:SS", or null. */
export function takenFromExif(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== SOI) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    const marker = view.getUint16(at);
    if ((marker & 0xff00) !== 0xff00 || marker === SOS) return null;
    const length = view.getUint16(at + 2);
    const start = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === APP1 && end - start >= 14 && isExifHeader(bytes, start)) {
      return fromTiff(new DataView(bytes.buffer, bytes.byteOffset + start + 6, end - start - 6));
    }
    at = end;
  }
  return null;
}

/** "Exif\0\0" */
const isExifHeader = (bytes: Uint8Array, at: number): boolean =>
  at + 6 <= bytes.length &&
  bytes[at] === 0x45 &&
  bytes[at + 1] === 0x78 &&
  bytes[at + 2] === 0x69 &&
  bytes[at + 3] === 0x66 &&
  bytes[at + 4] === 0 &&
  bytes[at + 5] === 0;

function fromTiff(tiff: DataView): string | null {
  if (tiff.byteLength < 8) return null;
  const order = tiff.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => tiff.getUint16(at, little);
  const u32 = (at: number) => tiff.getUint32(at, little);
  if (u16(2) !== 42) return null;

  /** The entries of the list at `offset`: tag → where its 12-byte entry starts. */
  function entries(offset: number): Map<number, number> | null {
    if (offset + 2 > tiff.byteLength) return null;
    const count = u16(offset);
    if (offset + 2 + count * 12 > tiff.byteLength) return null;
    const found = new Map<number, number>();
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      found.set(u16(entry), entry);
    }
    return found;
  }

  function date(entry: number | undefined): string | null {
    if (entry === undefined || u16(entry + 2) !== ASCII) return null;
    // At least "YYYY:MM:DD HH:MM:SS", so it's stored elsewhere (only 4 bytes fit in the entry).
    if (u32(entry + 4) < 19) return null;
    const at = u32(entry + 8);
    if (at + 19 > tiff.byteLength) return null;
    let text = '';
    for (let index = 0; index < 19; index += 1)
      text += String.fromCharCode(tiff.getUint8(at + index));
    return exifDate(text);
  }

  const first = entries(u32(4));
  if (!first) return null;
  const exifEntry = first.get(EXIF_IFD);
  const exif = exifEntry === undefined ? null : entries(u32(exifEntry + 8));
  return date(exif?.get(DATE_TIME_ORIGINAL)) ?? date(first.get(DATE_TIME));
}

/** "2026:10:21 14:03:22" → "2026-10-21T14:03:22"; null if it isn't a real date and time. */
export function exifDate(text: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day, hour, minute, second));
  const real =
    (year ?? 0) >= 1900 &&
    date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day &&
    (hour ?? 0) < 24 &&
    (minute ?? 0) < 60 &&
    (second ?? 0) < 60;
  if (!real) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
