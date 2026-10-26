import { describe, expect, it } from 'vitest';
import { compareText, cutToLength, foldText } from './text.ts';

describe('compareText', () => {
  it('sorts like localeCompare, ignoring case and accents, with numbers in order', () => {
    const names = ['item 10', 'Item 2', 'éclair', 'Banana', 'apple', 'eclair'];
    expect([...names].sort(compareText)).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
      ),
    );
    expect(compareText('Café', 'cafe')).toBe(0);
    expect(compareText('Bus 2', 'Bus 10')).toBeLessThan(0);
  });
});

describe('foldText', () => {
  it('drops case, accents and extra spaces', () => {
    expect(foldText('  Café  au   Lait ')).toBe('cafe au lait');
    expect(foldText('Crème\tbrûlée\n')).toBe('creme brulee');
    expect(foldText('ÇAĞRI')).toBe(foldText('çağri'));
    expect(foldText('Ελλάδα')).toBe(foldText('ελλαδα'));
    expect(foldText('Ёлка')).toBe(foldText('ёлка'));
    expect(foldText('')).toBe('');
  });

  // Audit F2-2: vowel signs were dropped like accents, making different words the same.
  it('keeps the vowel signs and other marks that are letters', () => {
    const different = [
      ['चीनी', 'चना'], // Hindi: sugar, chickpeas
      ['दाल', 'दल'], // Hindi: lentils, a group
      ['ไก่', 'ไก'], // Thai: chicken, and the same without its tone mark
      ['ข้าว', 'ขาว'], // Thai: rice, white
      ['பால்', 'பல'], // Tamil: milk, many
      ['মাছ', 'মছ'], // Bengali: fish
      ['が', 'か'], // Japanese: ga, ka
    ];
    for (const [a = '', b = ''] of different) {
      expect(foldText(a), `${a} ${b}`).not.toBe(foldText(b));
    }
    // The same word, typed the same, is still the same.
    expect(foldText(' चीनी ')).toBe(foldText('चीनी'));
    // Vietnamese tone marks are accents to foldText: butter and beef are one word.
    expect(foldText('Bơ')).toBe(foldText('Bò'));
  });

  it('makes wide and narrow letters ordinary ones (audit 4 F3-6)', () => {
    // What Japanese and Chinese keyboards type: full-width letters, digits
    // and spaces, and half-width katakana.
    expect(foldText('ＵＮＩＱＬＯ　shirts')).toBe('uniqlo shirts');
    expect(foldText('Ｍｅｅｔｉｎｇ ２０２６')).toBe('meeting 2026');
    expect(foldText('ｺｰﾋｰ')).toBe(foldText('コーヒー'));
    // A voiced mark typed apart ("ﾋﾞ") is the letter with it ("ビ").
    expect(foldText('ﾋﾞｰﾙ')).toBe(foldText('ビール'));
    // Still different words: ka and ga.
    expect(foldText('ｶ')).not.toBe(foldText('ガ'));
  });

  it('lowers case the same way on every device', () => {
    // The device language's own lower case makes a Turkish "I" a dotless "ı".
    expect(foldText('Ispanak')).toBe('ispanak');
    expect(foldText('İSTANBUL')).toBe('istanbul');
  });
});

describe('cutToLength (audit 4 F3-4)', () => {
  /** A lone half of an emoji: what cutting in the middle of one leaves. */
  const halfEmoji = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('keeps everything a box with that maxlength lets in, in any browser', () => {
    // Safari counts characters as people see them: 120 thumbs-up with a skin
    // tone are 120, though JavaScript counts 480.
    const thumbs = '👍🏽'.repeat(120);
    expect(cutToLength(thumbs, 200)).toBe(thumbs);
    expect(cutToLength('🇬🇪'.repeat(150), 200)).toBe('🇬🇪'.repeat(150));
    const hindi = 'नमस्ते '.repeat(30);
    expect(cutToLength(hindi, 200)).toBe(hindi);
    expect(cutToLength('Plain text', 200)).toBe('Plain text');
    expect(cutToLength('', 0)).toBe('');
  });

  it('cuts between whole characters, never in half of one', () => {
    expect(cutToLength(`${'a'.repeat(199)}😀😀`, 200)).toBe(`${'a'.repeat(199)}😀`);
    expect(cutToLength('👨‍👩‍👧‍👦'.repeat(3), 2)).toBe('👨‍👩‍👧‍👦'.repeat(2));
    for (const text of [`${'a'.repeat(199)}😀😀`, 'é'.normalize('NFD').repeat(300)]) {
      const cut = cutToLength(text, 200);
      expect(halfEmoji.test(cut)).toBe(false);
      expect(text.startsWith(cut)).toBe(true);
    }
    // A letter and its accent stay together.
    expect(cutToLength('é'.normalize('NFD').repeat(300), 200)).toBe(
      'é'.normalize('NFD').repeat(200),
    );
  });
});
