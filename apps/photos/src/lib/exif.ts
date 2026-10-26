/**
 * When a photo was taken, from what the camera wrote into it (Exif).
 *
 * The camera's details are a small TIFF file: lists of tagged values (IFDs).
 * The date the photo was taken is DateTimeOriginal (in the Exif list), else
 * DateTime (in the first list), as "YYYY:MM:DD HH:MM:SS" in the camera's
 * local time, with no time zone. Where that TIFF file is depends on the kind
 * of image:
 *
 * - JPEG: a list of segments; it's in the APP1 segment that starts with "Exif".
 * - HEIF (HEIC, as iPhones save photos, and AVIF): a tree of boxes. The meta
 *   box lists the file's items (iinf); the one of type "Exif" is found by
 *   where the item list says it is (iloc), and starts with how far after that
 *   the TIFF file begins (audit 4 F3-3: HEIC photos were dated by the file).
 * - PNG: an eXIf chunk. WebP: an EXIF chunk.
 *
 * Anything malformed gives null.
 */

const SOI = 0xffd8;
const APP1 = 0xffe1;
const SOS = 0xffda;
const EXIF_IFD = 0x8769;
const DATE_TIME = 0x0132;
const DATE_TIME_ORIGINAL = 0x9003;
const ASCII = 2;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The date and time a photo was taken, as "YYYY-MM-DDTHH:MM:SS", or null. */
export function takenFromExif(bytes: Uint8Array): string | null {
  try {
    return readTaken(bytes);
  } catch {
    // Every read is checked first; this is only a safety net for a file nobody expected.
  }
  return null;
}

/**
 * takenFromExif without its safety net: a read past the end throws. Only for
 * tests, which show that none does.
 */
export function readTaken(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && view.getUint16(0) === SOI) return fromJpeg(bytes, view);
  if (bytes.length >= 12 && fourCC(view, 4) === 'ftyp') return fromHeif(bytes, view);
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return fromPng(bytes, view);
  if (bytes.length >= 12 && fourCC(view, 0) === 'RIFF' && fourCC(view, 8) === 'WEBP') {
    return fromWebp(bytes, view);
  }
  return null;
}

const fourCC = (view: DataView, at: number): string =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

/** The TIFF file `length` bytes long at `at`, as a view of its own. */
const tiffAt = (bytes: Uint8Array, at: number, length: number): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset + at, length);

function fromJpeg(bytes: Uint8Array, view: DataView): string | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    const marker = view.getUint16(at);
    if ((marker & 0xff00) !== 0xff00 || marker === SOS) return null;
    const length = view.getUint16(at + 2);
    const start = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === APP1 && end - start >= 14 && isExifHeader(bytes, start)) {
      return fromTiff(tiffAt(bytes, start + 6, end - start - 6));
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

// ---------- HEIF (HEIC, AVIF) ----------

/** A box's type and where its contents are, [start, end). */
interface Box {
  type: string;
  start: number;
  end: number;
}

/** The boxes one after another in [start, end), until one doesn't fit. */
function* eachBox(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      // A 64-bit size: more than 4 GB is more than any photo here.
      if (at + 16 > end || view.getUint32(at + 8) !== 0) return;
      size = view.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type: fourCC(view, at + 4), start: at + header, end: at + size };
    at += size;
  }
}

function fromHeif(bytes: Uint8Array, view: DataView): string | null {
  let meta: Box | undefined;
  for (const box of eachBox(view, 0, bytes.length)) {
    if (box.type === 'meta') {
      meta = box;
      break;
    }
  }
  // A "full box": its version and flags come first.
  if (!meta || meta.start + 4 > meta.end) return null;
  const inside = [...eachBox(view, meta.start + 4, meta.end)];
  const box = (type: string) => inside.find((found) => found.type === type);
  const id = exifItem(view, box('iinf'));
  if (id === null) return null;
  const place = itemPlace(view, box('iloc'), id, box('idat'));
  if (!place) return null;
  const [start, length] = place;
  if (length < 4 || start + length > bytes.length) return null;
  // The item starts with how far after these 4 bytes its TIFF file begins
  // (past "Exif\0\0", usually).
  const tiff = start + 4 + view.getUint32(start);
  const end = start + length;
  if (tiff >= end) return null;
  return fromTiff(tiffAt(bytes, tiff, end - tiff));
}

/** The id of the item of type "Exif", from the item list (iinf), or null. */
function exifItem(view: DataView, iinf: Box | undefined): number | null {
  if (!iinf || iinf.start + 4 > iinf.end) return null;
  const countSize = view.getUint8(iinf.start) === 0 ? 2 : 4;
  for (const infe of eachBox(view, iinf.start + 4 + countSize, iinf.end)) {
    if (infe.type !== 'infe' || infe.start + 4 > infe.end) continue;
    // Versions 2 and 3 have an item type; older ones don't name Exif.
    const version = view.getUint8(infe.start);
    if (version !== 2 && version !== 3) continue;
    const idSize = version === 2 ? 2 : 4;
    const typeAt = infe.start + 4 + idSize + 2;
    if (typeAt + 4 > infe.end) continue;
    if (fourCC(view, typeAt) !== 'Exif') continue;
    return idSize === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
  }
  return null;
}

/**
 * Where item `id` is: [start in the file, length], from the item locations
 * (iloc). Only an item in one piece, in the file or in the meta box's own
 * data (idat): an Exif item is small.
 */
function itemPlace(
  view: DataView,
  iloc: Box | undefined,
  id: number,
  idat: Box | undefined,
): [number, number] | null {
  if (!iloc || iloc.start + 6 > iloc.end) return null;
  const version = view.getUint8(iloc.start);
  if (version > 2) return null;
  const sizes = view.getUint16(iloc.start + 4);
  const offsetSize = sizes >> 12;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseSize = (sizes >> 4) & 0xf;
  const indexSize = version === 0 ? 0 : sizes & 0xf;
  let at = iloc.start + 6;
  /** A number `size` bytes long (0, 2, 4, or 8 under 4 GB), or null past the box. */
  const read = (size: number): number | null => {
    if (at + size > iloc.end) return null;
    let value: number | null = null;
    if (size === 0) value = 0;
    else if (size === 2) value = view.getUint16(at);
    else if (size === 4) value = view.getUint32(at);
    else if (size === 8 && view.getUint32(at) === 0) value = view.getUint32(at + 4);
    at += size;
    return value;
  };
  // Each piece (extent) of an item is an index, an offset and a length. One
  // of no bytes at all can't say where anything is, and let a crafted file
  // make the reader go round 65,535 times an item, reading nothing: minutes
  // for a small file. Other items' pieces are stepped over, not read.
  const extentSize = indexSize + offsetSize + lengthSize;
  if (extentSize === 0) return null;
  const count = read(version < 2 ? 2 : 4);
  if (count === null) return null;
  for (let item = 0; item < count; item += 1) {
    const itemId = read(version < 2 ? 2 : 4);
    const method = version === 0 ? 0 : read(2);
    const reference = read(2);
    const base = read(baseSize);
    const extents = read(2);
    if (itemId === null || method === null || reference === null) return null;
    if (base === null || extents === null) return null;
    if (at + extents * extentSize > iloc.end) return null;
    if (itemId !== id) {
      at += extents * extentSize;
      continue;
    }
    if (extents !== 1 || reference !== 0) return null;
    if (indexSize > 0 && read(indexSize) === null) return null;
    const offset = read(offsetSize);
    const length = read(lengthSize);
    if (offset === null || length === null) return null;
    const first: [number, number] = [base + offset, length];
    const construction = method & 0xf;
    if (construction === 0) return first;
    // In the meta box's own data.
    if (construction === 1 && idat && idat.start + first[0] + first[1] <= idat.end) {
      return [idat.start + first[0], first[1]];
    }
    return null;
  }
  return null;
}

// ---------- PNG and WebP ----------

/** A PNG: chunks of a length, a name, the data and a checksum. */
function fromPng(bytes: Uint8Array, view: DataView): string | null {
  let at = PNG_SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const start = at + 8;
    if (start + length + 4 > bytes.length) return null;
    if (fourCC(view, at + 4) === 'eXIf') return fromTiff(tiffAt(bytes, start, length));
    at = start + length + 4;
  }
  return null;
}

/** A WebP: "RIFF", a size, "WEBP", then chunks of a name, a size and data padded to even. */
function fromWebp(bytes: Uint8Array, view: DataView): string | null {
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > bytes.length) return null;
    if (fourCC(view, at) === 'EXIF') {
      // Some writers keep a JPEG's "Exif\0\0" in front.
      const skip = isExifHeader(bytes, start) ? 6 : 0;
      return size > skip ? fromTiff(tiffAt(bytes, start + skip, size - skip)) : null;
    }
    at = start + size + (size % 2);
  }
  return null;
}

// ---------- The TIFF file ----------

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
