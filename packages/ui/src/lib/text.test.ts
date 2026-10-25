import { describe, expect, it } from 'vitest';
import { compareText, foldText } from './text.ts';

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

  it('lowers case the same way on every device', () => {
    // The device language's own lower case makes a Turkish "I" a dotless "ı".
    expect(foldText('Ispanak')).toBe('ispanak');
    expect(foldText('İSTANBUL')).toBe('istanbul');
  });
});
