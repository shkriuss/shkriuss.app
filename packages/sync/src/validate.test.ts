import { describe, expect, it } from 'vitest';
import { FILE_ID, MAX_FILES, MAX_FILES_BYTES, roomFor, type FileIndex } from './validate.ts';

describe('files', () => {
  it('takes ids like a photo’s, and nothing that could be a path', () => {
    for (const id of ['6f1c2d3e-0000-4000-8000-000000000000.thumb', 'p1', 'A_b-c.d']) {
      expect(FILE_ID.test(id), id).toBe(true);
    }
    for (const id of ['', '.', '..', '.hidden', 'a/b', 'a%2Fb', 'a b', 'x'.repeat(81)]) {
      expect(FILE_ID.test(id), id).toBe(false);
    }
  });

  it('has room until the account’s limits, counting a replaced file once', () => {
    const half = MAX_FILES_BYTES / 2;
    const files: FileIndex = { a: [half, 1], b: [half - 10, 2] };
    expect(roomFor(files, 'c', 10)).toBe(true);
    expect(roomFor(files, 'c', 11)).toBe(false);
    expect(roomFor(files, 'b', half)).toBe(true);
    const many: FileIndex = Object.fromEntries(
      Array.from({ length: MAX_FILES }, (_, index) => [`f${index}`, [1, 1]]),
    );
    expect(roomFor(many, 'one-more', 1)).toBe(false);
    expect(roomFor(many, 'f0', 1)).toBe(true);
  });
});
