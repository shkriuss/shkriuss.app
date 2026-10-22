import { describe, expect, it } from 'vitest';
import { exifDate, takenFromExif } from './exif.ts';

/** A tiny JPEG start (SOI) with an Exif segment holding these dates, then image data. */
function jpegWithExif(
  dates: { original?: string; plain?: string },
  little = false,
): Uint8Array<ArrayBuffer> {
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

  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
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
    expect(takenFromExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(takenFromExif(new Uint8Array())).toBeNull();
  });

  it('never reads past the end of a broken file', () => {
    const whole = jpegWithExif({ original: '2019:07:04 18:30:05' });
    for (let length = 0; length < whole.length; length += 1) {
      expect(() => takenFromExif(whole.slice(0, length))).not.toThrow();
    }
    // A pointer that points far away.
    const broken = whole.slice();
    broken[broken.length - 30] = 0xff;
    expect(() => takenFromExif(broken)).not.toThrow();
  });

  it('only takes real dates', () => {
    expect(exifDate('2024:02:29 12:00:00')).toBe('2024-02-29T12:00:00');
    expect(exifDate('2023:02:29 12:00:00')).toBeNull();
    expect(exifDate('2023:13:01 12:00:00')).toBeNull();
    expect(exifDate('2023:01:01 24:00:00')).toBeNull();
    expect(exifDate('    :  :     :  :  ')).toBeNull();
  });
});
