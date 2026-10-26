import { describe, expect, it } from 'vitest';
import {
  addedMessage,
  byMonth,
  byNewest,
  downloadName,
  detailsOf,
  formatBytes,
  formatLabel,
  isIPhoneOrIPad,
  isPhotoDetails,
  librarySummary,
  localDateTime,
  monthLabel,
  photoAlt,
  shownLabel,
  takenLabel,
  toPhoto,
  withChanges,
  type Photo,
} from './photos.ts';

/** Numbers and dates in tests: the same on a computer set to any language (audit 3 J-5). */
const EN = 'en-US';

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
    expect(librarySummary([photo({ size: 4_200_000 }), photo({ size: 800_000 })], EN)).toBe(
      '2 photos · 5.0 MB',
    );
    expect(librarySummary([], EN)).toBe('0 photos · 0 bytes');
    expect(formatBytes(999, EN)).toBe('999 bytes');
    expect(formatBytes(820_000, EN)).toBe('820 KB');
    expect(formatBytes(1_300_000_000, EN)).toBe('1.3 GB');
    expect(formatBytes(2_500_000_000_000, EN)).toBe('2.5 TB');
  });

  it('rounds sizes before choosing the unit, so they never read “1,000 KB” (audit 3 F3-9)', () => {
    expect(formatBytes(999_999, EN)).toBe('1.0 MB');
    expect(formatBytes(999_499, EN)).toBe('999 KB');
    expect(formatBytes(999_999_999, EN)).toBe('1.0 GB');
    expect(formatBytes(1_000, EN)).toBe('1.0 KB');
    // Just under 10 rounds to 10, shown without a decimal like other sizes from 10 up.
    expect(formatBytes(9_960, EN)).toBe('10 KB');
    expect(formatBytes(9_940, EN)).toBe('9.9 KB');
    // Terabytes are the biggest unit.
    expect(formatBytes(1_234_000_000_000_000, EN)).toBe('1,234 TB');
  });

  it('writes numbers in the language it’s given (the browser’s own when it isn’t)', () => {
    expect(librarySummary([photo({ size: 1_234_000 })], 'de-DE')).toBe('1 photo · 1,2 MB');
    expect(formatBytes(1_234, 'de-DE')).toBe('1,2 KB');
    expect(librarySummary(Array<Photo>(1234).fill(photo({ size: 0 })), 'de-DE')).toBe(
      '1.234 photos · 0 bytes',
    );
  });
});

describe('changes to the list (audit 4 J-1)', () => {
  /** A library of `count` photos taken at random moments, newest first. */
  function library(count: number, seed = 7): Photo[] {
    let state = seed;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const pad = (n: number) => String(n).padStart(2, '0');
    return Array.from({ length: count }, (_, index) => {
      const at = new Date(Date.UTC(2010, 0, 1) + Math.floor(random() * 16 * 365) * 86_400_000);
      const taken = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T12:00:00`;
      return photo({ id: `p${index}`, taken, added: index % 5 });
    }).sort(byNewest);
  }

  it('give the same list as sorting it all again, for any mix of changes', () => {
    const before = library(300);
    const changes: [Photo[], string[]][] = [
      [[photo({ id: 'new', taken: '2015-06-01T12:00:00' })], []],
      [[], ['p3', 'p10', 'nope']],
      // A photo changed in place (its place online, say), and one moved in time.
      [
        [
          { ...(before[5] as Photo), here: false },
          { ...(before[7] as Photo), taken: '2030-01-01T00:00:00' },
        ],
        [],
      ],
      // Many at once: a page of changes from other devices.
      [
        library(40, 99).map((one, index) => ({ ...one, id: `q${index}` })),
        before.slice(0, 20).map((one) => one.id),
      ],
    ];
    for (const [save, remove] of changes) {
      const gone = new Set([...remove, ...save.map((one) => one.id)]);
      const expected = [...before.filter((one) => !gone.has(one.id)), ...save].sort(byNewest);
      expect(withChanges(before, save, remove)).toEqual(expected);
    }
    // The list given isn't changed.
    expect(before).toEqual(library(300));
  });

  it('keep a photo both saved and taken out, as saved; and the last change to each', () => {
    const before = library(50);
    const kept = { ...(before[9] as Photo), here: false };
    const moved = { ...(before[20] as Photo), taken: '2001-01-01T00:00:00' };
    const next = withChanges(
      before,
      [{ ...kept, here: true }, kept, { ...moved, here: false }, moved],
      [kept.id, moved.id, 'p30'],
    );
    expect(next).toHaveLength(49);
    expect(next.filter((one) => one.id === kept.id)).toEqual([kept]);
    expect(next.filter((one) => one.id === moved.id)).toEqual([moved]);
    expect(next.at(-1)).toEqual(moved);
    expect(next.some((one) => one.id === 'p30')).toBe(false);
  });

  it('don’t sort the whole library for one photo', () => {
    const big = library(100_000);
    let comparisons = 0;
    const counted = (a: Photo, b: Photo) => {
      comparisons += 1;
      return byNewest(a, b);
    };
    const added = photo({ id: 'new', taken: '2020-02-02T12:00:00' });
    const next = withChanges(big, [added], [], counted);
    expect(next).toHaveLength(100_001);
    expect(comparisons).toBeLessThan(40);
    const at = next.indexOf(added);
    expect(byNewest(next[at - 1] as Photo, added)).toBeLessThanOrEqual(0);
    expect(byNewest(added, next[at + 1] as Photo)).toBeLessThanOrEqual(0);
  });

  it('find a photo uploaded where it is, without looking through every photo', () => {
    let looks = 0;
    const big = library(100_000).map(({ id, ...rest }) =>
      Object.defineProperty(rest, 'id', {
        enumerable: true,
        get: () => {
          looks += 1;
          return id;
        },
      }),
    ) as Photo[];
    const uploaded = { ...(big[54_321] as Photo), online: { key: 'k', parts: [1, 2, 3] } };
    looks = 0;
    const next = withChanges(big, [uploaded]);
    expect(next[54_321]).toBe(uploaded);
    expect(next).toHaveLength(100_000);
    expect(looks).toBeLessThan(100);
  });
});

describe('for people', () => {
  it('names months and moments as written, whatever the time zone', () => {
    expect(monthLabel('2026-10', EN)).toBe('October 2026');
    expect(takenLabel('2026-10-21T14:03:22', EN)).toBe('Oct 21, 2026, 2:03:22 PM');
    expect(photoAlt(photo({}), EN)).toBe('Photo taken Oct 21, 2026, 2:03:22 PM');
    // Months and moments are in English, in the person's own kind (a British one here).
    expect(takenLabel('2026-10-21T14:03:22', 'en-GB')).toBe('21 Oct 2026, 14:03:22');
  });

  it('names photos taken in the same minute apart, and says which one the viewer shows (audit 3 G-8)', () => {
    const burst = ['2026-10-20T14:05:01', '2026-10-20T14:05:03', '2026-10-20T14:05:07'].map(
      (taken) => photoAlt(photo({ taken }), EN),
    );
    expect(new Set(burst).size).toBe(3);
    expect(shownLabel(photo({ taken: '2026-10-20T14:05:03' }), 1, 3, EN)).toBe(
      'Photo 2 of 3, taken Oct 20, 2026, 2:05:03 PM',
    );
    expect(shownLabel(photo({}), 1233, 20_000, EN)).toBe(
      'Photo 1,234 of 20,000, taken Oct 21, 2026, 2:03:22 PM',
    );
  });

  it('guesses when it’s on an iPhone or iPad, where picked photos may be JPEG copies (audit 3 F3-3)', () => {
    const safari = (device: string) =>
      `Mozilla/5.0 (${device}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`;
    expect(isIPhoneOrIPad(safari('iPhone; CPU iPhone OS 17_5 like Mac OS X'), 5)).toBe(true);
    expect(isIPhoneOrIPad(safari('iPad; CPU OS 17_5 like Mac OS X'), 5)).toBe(true);
    // Chrome and other browsers there use the same photo picker.
    expect(
      isIPhoneOrIPad(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
        5,
      ),
    ).toBe(true);
    // An iPad says it's a Mac, but Macs have no touch screen.
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(isIPhoneOrIPad(mac, 5)).toBe(true);
    expect(isIPhoneOrIPad(mac, 0)).toBe(false);
    expect(
      isIPhoneOrIPad(
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        5,
      ),
    ).toBe(false);
  });

  it('says what kind of file it is', () => {
    expect(formatLabel({ name: 'IMG_0001.HEIC', type: 'image/heic' })).toBe('HEIC');
    expect(formatLabel({ name: 'scan', type: 'image/png' })).toBe('PNG');
    expect(formatLabel({ name: 'scan', type: '' })).toBe('FILE');
  });

  it('takes a type that’s the name of an object’s own function for an unknown one (audit 4 C-2)', () => {
    // From another device: in a plain object, these found functions and broke the grid.
    for (const type of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(isPhotoDetails(photo({ name: 'IMG_0001', type }))).toBe(true);
      expect(formatLabel({ name: 'IMG_0001', type })).toBe('FILE');
      expect(downloadName(photo({ name: 'IMG_0001', type }))).toBe('IMG_0001');
    }
    expect(formatLabel({ name: 'IMG_0001', type: 'image/x-portable' })).toBe('X-PORTABLE');
    // Longer than any real type: not a photo's details.
    expect(isPhotoDetails(photo({ type: `image/${'x'.repeat(95)}` }))).toBe(false);
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

  it('cuts a long name between whole characters, never in the middle of an emoji (audit 3 C-6)', () => {
    // The 120th character is an emoji, which is two of JavaScript's units long.
    const saved = downloadName(photo({ name: `${'a'.repeat(119)}😀😀 more.jpg` }));
    expect(saved).toBe(`${'a'.repeat(119)}😀.jpg`);
    expect(saved).not.toMatch(/\p{Cs}/u);
    // Nor ends the name with a space before the extension.
    expect(downloadName(photo({ name: `${'b'.repeat(119)} end.jpg` }))).toBe(
      `${'b'.repeat(119)}.jpg`,
    );
  });

  it('says what happened when photos were picked', () => {
    expect(addedMessage({ added: 3, duplicates: 0, notPhotos: 0, failed: 0 }, EN)).toBe(
      'Added 3 photos.',
    );
    expect(addedMessage({ added: 1, duplicates: 2, notPhotos: 1, failed: 1 }, EN)).toBe(
      'Added 1 photo. 2 photos were already here. 1 file isn’t a photo. 1 photo couldn’t be saved.',
    );
    expect(addedMessage({ added: 0, duplicates: 1, notPhotos: 0, failed: 0 }, EN)).toBe(
      'No photos were added. 1 photo was already here.',
    );
  });

  it('says when picking a photo again put its original back', () => {
    const none = { added: 0, duplicates: 0, notPhotos: 0, failed: 0 };
    expect(addedMessage({ ...none, restored: 1 }, EN)).toBe('1 original is back on this device.');
    expect(addedMessage({ ...none, added: 2, restored: 3, duplicates: 1 }, EN)).toBe(
      'Added 2 photos. 3 originals are back on this device. 1 photo was already here.',
    );
  });
});
