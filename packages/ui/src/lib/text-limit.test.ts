import { describe, expect, it } from 'vitest';
import { boxLength, cutMessage, wasCut } from './text-limit.ts';

describe('boxLength', () => {
  it('counts a line break once, however it was written', () => {
    expect(boxLength('ab')).toBe(2);
    expect(boxLength('a\nb')).toBe(3);
    expect(boxLength('a\r\nb\rc')).toBe(5);
  });

  it('counts what the browser counts for maxlength (UTF-16 code units)', () => {
    expect(boxLength('😀')).toBe(2);
  });
});

describe('wasCut', () => {
  it('is true when text that didn’t fit is shorter than wanted', () => {
    // 24,491 characters pasted into an empty box that takes 20,000 (audit F3-3).
    expect(wasCut(24_491, 20_000, 20_000)).toBe(true);
    // A pair of UTF-16 code units isn't split, so one more can go.
    expect(wasCut(24_491, 19_999, 20_000)).toBe(true);
    // Typing at the limit adds nothing: cut too.
    expect(wasCut(201, 200, 200)).toBe(true);
  });

  it('is false when everything fit', () => {
    expect(wasCut(20_000, 20_000, 20_000)).toBe(false);
    expect(wasCut(12, 12, 20_000)).toBe(false);
  });

  it('is false when the page put in all of it itself, past the limit', () => {
    // A fix set the box's value from code, which maxlength doesn't stop.
    expect(wasCut(20_001, 20_001, 20_000)).toBe(false);
  });

  it('is false when the text came out shorter for another reason, within the limit', () => {
    expect(wasCut(150, 140, 200)).toBe(false);
  });
});

describe('cutMessage', () => {
  it('says what fits, and that the rest wasn’t added', () => {
    expect(cutMessage(20_000, true, 'en-US')).toBe(
      'Only part of that fit. This box takes up to 20,000 characters, so the rest wasn’t added.',
    );
    expect(cutMessage(200, false, 'en-US')).toBe(
      'That didn’t fit. This box takes up to 200 characters, so it wasn’t added.',
    );
  });

  it('writes the number in the browser’s language', () => {
    expect(cutMessage(100_000, true, 'de-DE')).toContain('up to 100.000 characters');
  });
});
