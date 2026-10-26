import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exifDate, readTaken, takenFromExif } from './exif.ts';

/** A picture a real encoder made (./fixtures/README.md). */
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

interface Dates {
  original?: string;
  plain?: string;
}

/** The camera's details: a TIFF file with these dates. */
function tiffWith(dates: Dates, little = false): number[] {
  const tiff: number[] = [];
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24]
      : [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  const text = (value: string) => [...value].map((char) => char.charCodeAt(0)).concat(0);

  // Header, then IFD0 at 8 with up to two entries: DateTime and the Exif pointer.
  const ifd0Entries = (dates.plain ? 1 : 0) + 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifAt = 8 + ifd0Size;
  const exifSize = 2 + (dates.original ? 1 : 0) * 12 + 4;
  const dataAt = exifAt + exifSize;
  const data: number[] = [];
  const place = (value: string) => {
    const at = dataAt + data.length;
    data.push(...text(value));
    return at;
  };
  const plainAt = dates.plain ? place(dates.plain) : 0;
  const originalAt = dates.original ? place(dates.original) : 0;

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(ifd0Entries));
  if (dates.plain) tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(plainAt));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0));
  tiff.push(...u16(dates.original ? 1 : 0));
  if (dates.original) tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(originalAt));
  tiff.push(...u32(0), ...data);
  return tiff;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];
const bytesOf = (text: string) => [...text].map((char) => char.charCodeAt(0));
const be32 = (value: number) => [
  value >>> 24,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];
const be16 = (value: number) => [value >> 8, value & 0xff];
const le32 = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  value >>> 24,
];
/** An ISO box (HEIF): its size, its type, its contents. */
const box = (type: string, ...contents: number[]) => [
  ...be32(8 + contents.length),
  ...bytesOf(type),
  ...contents,
];

/** A tiny JPEG start (SOI) with an Exif segment holding these dates, then image data. */
function jpegWithExif(dates: Dates, little = false): Uint8Array<ArrayBuffer> {
  const tiff = tiffWith(dates, little);
  const payload = [...EXIF_HEADER, ...tiff];
  const length = payload.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    // A JFIF segment first, as many cameras write.
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...payload,
    0xff,
    0xda,
    0x00,
    0x02,
    0x12,
    0x34,
  ]);
}

/**
 * A tiny HEIF file (as an iPhone's HEIC): ftyp, then a meta box listing an
 * Exif item, placed by its location (iloc, `version` 0 or 1) in the file
 * (mdat) or in the meta box's own data (idat).
 */
function heicWithExif(
  dates: Dates,
  options: { version?: 0 | 1; inMeta?: boolean; infe?: 2 | 3 } = {},
): Uint8Array<ArrayBuffer> {
  const { version = 0, inMeta = false, infe = 2 } = options;
  const item = [...be32(6), ...EXIF_HEADER, ...tiffWith(dates)];
  const ftyp = box('ftyp', ...bytesOf('heic'), 0, 0, 0, 0, ...bytesOf('mif1heic'));
  const entries = [
    // Item 1: the picture; item 2: the Exif data.
    box('infe', infe, 0, 0, 0, ...(infe === 2 ? be16(1) : be32(1)), 0, 0, ...bytesOf('hvc1'), 0),
    box('infe', infe, 0, 0, 0, ...(infe === 2 ? be16(2) : be32(2)), 0, 0, ...bytesOf('Exif'), 0),
  ].flat();
  const iinf = box('iinf', 0, 0, 0, 0, ...be16(2), ...entries);
  // offset_size 4, length_size 4, base_offset_size 0, index_size 0.
  const location = (offset: number, method: number) => [
    ...be16(2),
    ...(version === 1 ? be16(method) : []),
    ...be16(0),
    ...be16(1),
    ...be32(offset),
    ...be32(item.length),
  ];
  const iloc = (offset: number) =>
    box('iloc', version, 0, 0, 0, 0x44, 0x00, ...be16(1), ...location(offset, inMeta ? 1 : 0));
  const idat = inMeta ? box('idat', ...item) : [];
  const meta = (offset: number) => box('meta', 0, 0, 0, 0, ...iinf, ...iloc(offset), ...idat);
  if (inMeta) return new Uint8Array([...ftyp, ...meta(0), ...box('mdat', 1, 2, 3)]);
  // In the file: after ftyp, meta and the mdat box's 8-byte header.
  const offset = ftyp.length + meta(0).length + 8;
  return new Uint8Array([...ftyp, ...meta(offset), ...box('mdat', ...item)]);
}

function pngWithExif(dates: Dates): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: number[]) => [
    ...be32(data.length),
    ...bytesOf(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', new Array<number>(13).fill(0)),
    ...chunk('eXIf', tiffWith(dates, true)),
    ...chunk('IEND', []),
  ]);
}

function webpWithExif(dates: Dates, withHeader = false): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: number[]) => [
    ...bytesOf(type),
    ...le32(data.length),
    ...data,
    ...(data.length % 2 ? [0] : []),
  ];
  const body = [
    ...bytesOf('WEBP'),
    ...chunk('VP8X', new Array<number>(10).fill(0)),
    ...chunk('VP8 ', [1, 2, 3]),
    ...chunk('EXIF', [...(withHeader ? EXIF_HEADER : []), ...tiffWith(dates)]),
  ];
  return new Uint8Array([...bytesOf('RIFF'), ...le32(body.length), ...body]);
}

describe('when a photo was taken', () => {
  it('reads DateTimeOriginal, in either byte order', () => {
    const dates = { original: '2019:07:04 18:30:05', plain: '2020:01:01 00:00:00' };
    expect(takenFromExif(jpegWithExif(dates))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(jpegWithExif(dates, true))).toBe('2019-07-04T18:30:05');
  });

  it('falls back to DateTime', () => {
    expect(takenFromExif(jpegWithExif({ plain: '2021:12:31 23:59:59' }))).toBe(
      '2021-12-31T23:59:59',
    );
  });

  it('gives null without a date, or for anything that isn’t a JPEG with Exif', () => {
    expect(takenFromExif(jpegWithExif({}))).toBeNull();
    expect(takenFromExif(jpegWithExif({ original: '0000:00:00 00:00:00' }))).toBeNull();
    expect(takenFromExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(takenFromExif(new Uint8Array([0, 0, 0, 8, ...bytesOf('ftyp')]))).toBeNull();
    expect(takenFromExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(takenFromExif(new Uint8Array())).toBeNull();
  });

  it('reads HEIC and other HEIF files, as iPhones save photos (audit 4 F3-3)', () => {
    const dates = { original: '2019:07:04 18:30:05' };
    expect(takenFromExif(heicWithExif(dates))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(heicWithExif(dates, { version: 1 }))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(heicWithExif(dates, { version: 1, inMeta: true }))).toBe(
      '2019-07-04T18:30:05',
    );
    expect(takenFromExif(heicWithExif(dates, { infe: 3 }))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(heicWithExif({ plain: '2021:12:31 23:59:59' }))).toBe(
      '2021-12-31T23:59:59',
    );
    expect(takenFromExif(heicWithExif({}))).toBeNull();
  });

  it('reads pictures made by real encoders', () => {
    for (const name of ['libheif.heic', 'pillow.png', 'pillow.webp']) {
      expect(takenFromExif(fixture(name)), name).toBe('2019-07-04T18:30:05');
    }
  });

  it('reads PNG and WebP files too', () => {
    const dates = { original: '2019:07:04 18:30:05' };
    expect(takenFromExif(pngWithExif(dates))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(webpWithExif(dates))).toBe('2019-07-04T18:30:05');
    expect(takenFromExif(webpWithExif(dates, true))).toBe('2019-07-04T18:30:05');
  });

  // Checked without takenFromExif's safety net, which would hide a read past
  // the end (as the review of audit 4 F3-3 found).
  it('never reads past the end of a broken HEIF, PNG or WebP file', () => {
    const dates = { original: '2019:07:04 18:30:05' };
    for (const whole of [
      heicWithExif(dates),
      heicWithExif(dates, { version: 1, inMeta: true }),
      pngWithExif(dates),
      webpWithExif(dates),
    ]) {
      for (let length = 0; length < whole.length; length += 1) {
        expect(() => readTaken(whole.slice(0, length))).not.toThrow();
      }
      // Each byte changed in turn: still nothing thrown.
      for (let at = 0; at < whole.length; at += 1) {
        const broken = whole.slice();
        broken[at] = 0xff;
        expect(() => readTaken(broken)).not.toThrow();
      }
    }
  });

  it('never reads past the end of a broken file', () => {
    const whole = jpegWithExif({ original: '2019:07:04 18:30:05' });
    for (let length = 0; length < whole.length; length += 1) {
      expect(() => readTaken(whole.slice(0, length))).not.toThrow();
    }
    // A pointer that points far away.
    const broken = whole.slice();
    broken[broken.length - 30] = 0xff;
    expect(() => readTaken(broken)).not.toThrow();
  });

  it('gives up at once on a HEIF file whose item pieces take no bytes', () => {
    // An item list (iloc) whose offsets and lengths take 0 bytes, with
    // thousands of items of 65,535 pieces each: the reader went round 65,535
    // times an item, reading nothing, which took minutes for a few-MB file
    // (review of audit 4 F3-3).
    const ftyp = box('ftyp', ...bytesOf('heic'), 0, 0, 0, 0, ...bytesOf('mif1heic'));
    const infe = box('infe', 2, 0, 0, 0, ...be16(2), 0, 0, ...bytesOf('Exif'), 0);
    const iinf = box('iinf', 0, 0, 0, 0, ...be16(1), ...infe);
    const items = 20_000;
    // Each item (version 0): its id, a data reference and 65,535 pieces of nothing.
    const entries = Array.from({ length: items }, (_, index) => [
      ...be16(index + 3),
      ...be16(0),
      ...be16(0xffff),
    ]).flat();
    const iloc = box('iloc', 0, 0, 0, 0, 0x00, 0x00, ...be16(items), ...entries);
    const file = new Uint8Array([...ftyp, ...box('meta', 0, 0, 0, 0, ...iinf, ...iloc)]);
    const started = performance.now();
    expect(readTaken(file)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    // Pieces that do take bytes, but more than the list has: null too, at once.
    const short = box(
      'iloc',
      0,
      0,
      0,
      0,
      0x44,
      0x00,
      ...be16(1),
      ...be16(3),
      ...be16(0),
      ...be16(0xffff),
    );
    const shortFile = new Uint8Array([...ftyp, ...box('meta', 0, 0, 0, 0, ...iinf, ...short)]);
    expect(readTaken(shortFile)).toBeNull();
  });

  it('only takes real dates', () => {
    expect(exifDate('2024:02:29 12:00:00')).toBe('2024-02-29T12:00:00');
    expect(exifDate('2023:02:29 12:00:00')).toBeNull();
    expect(exifDate('2023:13:01 12:00:00')).toBeNull();
    expect(exifDate('2023:01:01 24:00:00')).toBeNull();
    expect(exifDate('    :  :     :  :  ')).toBeNull();
  });
});
