import { describe, expect, it } from 'vitest';
import {
  addedMessage,
  byMonth,
  byNewest,
  downloadName,
  detailsOf,
  fitWithin,
  formatBytes,
  formatLabel,
  isPhotoDetails,
  librarySummary,
  localDateTime,
  monthLabel,
  photoAlt,
  takenLabel,
  toPhoto,
  type Photo,
} from './photos.ts';

const photo = (overrides: Partial<Photo>): Photo => ({
  id: 'p',
  taken: '2026-10-21T14:03:22',
  added: 1,
  name: 'IMG_0001.JPG',
  type: 'image/jpeg',
  size: 4_200_000,
  width: 4032,
  height: 3024,
  hash: 'abc',
  online: null,
  here: true,
  ...overrides,
});

describe('a photo’s details', () => {
  it('are checked when read back', () => {
    expect(isPhotoDetails(photo({}))).toBe(true);
    expect(isPhotoDetails(photo({ width: null, height: null }))).toBe(true);
    expect(isPhotoDetails(photo({ taken: '2026-10-21' }))).toBe(false);
    expect(isPhotoDetails(photo({ id: '' }))).toBe(false);
    expect(isPhotoDetails(photo({ size: -1 }))).toBe(false);
    expect(isPhotoDetails(photo({ width: 0 }))).toBe(false);
    expect(isPhotoDetails({ ...photo({}), hash: undefined })).toBe(false);
    expect(isPhotoDetails(null)).toBe(false);
  });

  it('say where the photo is; ones saved before the online library are here only', () => {
    const { online: _online, here: _here, ...before } = photo({});
    expect(toPhoto(before)).toEqual(photo({}));
    const place = { key: 'k1', parts: [100, 0, 4_200_028] };
    expect(toPhoto(photo({ online: place, here: false }))).toEqual(
      photo({ online: place, here: false }),
    );
    expect(toPhoto({ ...photo({}), online: { key: 'k1', parts: [1] } })).toEqual(photo({}));
    expect(toPhoto({ id: 'p' })).toBeNull();
  });

  it('go online without where the photo is', () => {
    const details = detailsOf(photo({ online: { key: 'k1', parts: [1, 2, 3] }, here: false }));
    expect(details).not.toHaveProperty('online');
    expect(details).not.toHaveProperty('here');
    expect(details.hash).toBe('abc');
  });

  it('keep the time as this device shows it', () => {
    expect(localDateTime(new Date(2026, 9, 21, 9, 5, 7))).toBe('2026-10-21T09:05:07');
  });
});

describe('the library', () => {
  it('shows the newest taken first, in groups by month', () => {
    const photos = [
      photo({ id: 'a', taken: '2026-09-30T23:59:59' }),
      photo({ id: 'b', taken: '2026-10-01T00:00:00' }),
      photo({ id: 'c', taken: '2026-10-21T14:03:22', added: 1 }),
      photo({ id: 'd', taken: '2026-10-21T14:03:22', added: 2 }),
      photo({ id: 'e', taken: '2025-10-05T10:00:00' }),
    ].sort(byNewest);
    expect(photos.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
    expect(byMonth(photos).map(({ month, photos: list }) => [month, list.length])).toEqual([
      ['2026-10', 3],
      ['2026-09', 1],
      ['2025-10', 1],
    ]);
    expect(byMonth([])).toEqual([]);
  });

  it('says how many and how much space', () => {
    expect(librarySummary([photo({ size: 4_200_000 }), photo({ size: 800_000 })])).toBe(
      '2 photos · 5.0 MB',
    );
    expect(librarySummary([])).toBe('0 photos · 0 bytes');
    expect(formatBytes(999)).toBe('999 bytes');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(1_300_000_000)).toBe('1.3 GB');
    expect(formatBytes(2_500_000_000_000)).toBe('2.5 TB');
  });
});

describe('for people', () => {
  it('names months and moments as written, whatever the time zone', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(takenLabel('2026-10-21T14:03:22')).toBe('Oct 21, 2026, 2:03 PM');
    expect(photoAlt(photo({}))).toBe('Photo taken Oct 21, 2026, 2:03 PM');
  });

  it('says what kind of file it is', () => {
    expect(formatLabel({ name: 'IMG_0001.HEIC', type: 'image/heic' })).toBe('HEIC');
    expect(formatLabel({ name: 'scan', type: 'image/png' })).toBe('PNG');
    expect(formatLabel({ name: 'scan', type: '' })).toBe('FILE');
  });

  it('saves the original under its own name, made safe', () => {
    expect(downloadName(photo({}))).toBe('IMG_0001.JPG');
    expect(downloadName(photo({ name: '../a/b:c.jpg' }))).toBe('-a-b-c.jpg');
    expect(downloadName(photo({ name: 'holiday', type: 'image/heic' }))).toBe('holiday.heic');
    expect(downloadName(photo({ name: '', type: 'image/png' }))).toBe(
      'photo-2026-10-21-14-03-22.png',
    );
    // Invisible direction marks and zero-width characters, which can hide the real extension.
    expect(downloadName(photo({ name: 'holiday‮gpj.exe' }))).toBe('holiday-gpj.exe');
    expect(downloadName(photo({ name: 'a​b⁦c.jpg' }))).toBe('a-b-c.jpg');
  });

  it('makes pictures smaller, never bigger', () => {
    expect(fitWithin(4032, 3024, 512)).toEqual({ width: 512, height: 384 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });

  it('says what happened when photos were picked', () => {
    expect(addedMessage({ added: 3, duplicates: 0, notPhotos: 0, failed: 0 })).toBe(
      'Added 3 photos.',
    );
    expect(addedMessage({ added: 1, duplicates: 2, notPhotos: 1, failed: 1 })).toBe(
      'Added 1 photo. 2 photos were already here. 1 file isn’t a photo. 1 photo couldn’t be saved.',
    );
    expect(addedMessage({ added: 0, duplicates: 1, notPhotos: 0, failed: 0 })).toBe(
      'No photos were added. 1 photo was already here.',
    );
  });
});
