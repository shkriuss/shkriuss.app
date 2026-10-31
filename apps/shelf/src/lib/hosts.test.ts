import { domainToASCII, domainToUnicode } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePunycode, readableHost } from './hosts.ts';

/** A name's first part as browsers keep it ("xn--…"), made by Node's own IDNA code. */
const punycodeOf = (name: string): string => domainToASCII(`${name}.example`).split('.')[0] ?? '';

describe('decodePunycode', () => {
  it('decodes what browsers make, as Node does', () => {
    const names = [
      'მაღაზია',
      'გე',
      'ქართული-ენა',
      '日本語',
      'なぜみんな日本語を話してくれないのか',
      '한국어',
      'bücher',
      'почемужеонинеговорятпорусски',
      'ليهمابتكلموشعربي',
      'tbilisi-მაღაზია-2024',
      '😀',
      '𠜎𠜱',
    ];
    for (const name of names) {
      const ascii = punycodeOf(name);
      expect(ascii.startsWith('xn--')).toBe(true);
      expect(decodePunycode(ascii.slice(4))).toBe(
        domainToUnicode(`${ascii}.example`).split('.')[0],
      );
    }
  });

  it('refuses what isn’t punycode', () => {
    expect(decodePunycode('-abc')).toBeNull();
    expect(decodePunycode('a!')).toBeNull();
    expect(decodePunycode('99999999999')).toBeNull();
    expect(decodePunycode('ab-ç')).toBeNull();
  });
});

describe('readableHost', () => {
  it('shows a Georgian (or Chinese, Japanese, Korean) name in its own letters', () => {
    // Typed as "მაღაზია.გე", kept by the browser as punycode (audit F3-10).
    expect(readableHost('xn--lodaaxko2f.xn--node')).toBe('მაღაზია.გე');
    expect(readableHost(`${punycodeOf('ქართული-ენა')}.ge`)).toBe('ქართული-ენა.ge');
    expect(readableHost(`${punycodeOf('日本語')}.jp`)).toBe('日本語.jp');
    expect(readableHost(`shop.${punycodeOf('한국어')}`)).toBe('shop.한국어');
    expect(readableHost('shop.ge')).toBe('shop.ge');
  });

  it('shows Japanese names, which mix kanji and kana and use “ー” (audit 5 F3-4)', () => {
    // The prolonged sound mark belongs to no script, and most names mix
    // scripts: these stayed as "xn--…".
    for (const name of [
      'コーヒー',
      'ソニー',
      'ラーメン',
      '東京タワー',
      'お寿司',
      'どこでも',
      'ドコモ',
      '々',
      'ゝ',
      'セブン-11',
    ]) {
      expect(readableHost(`${punycodeOf(name)}.jp`), name).toBe(`${name}.jp`);
    }
    expect(readableHost(`${punycodeOf('コーヒー・ショップ')}.jp`)).toBe('コーヒー・ショップ.jp');
  });

  it('keeps punycode where the letters could pass for another site’s', () => {
    // Cyrillic "аррӏе" looks like "apple".
    expect(readableHost('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com');
    // Latin letters with accents, Greek, Arabic, mixed scripts (also Latin
    // letters among kana, or Japanese with Georgian or Korean), emoji.
    for (const name of [
      'bücher',
      'αβγ',
      'العربية',
      'shopმაღაზია',
      'მაღაზია日本',
      'shopコーヒー',
      'コーヒー한국',
      '😀',
    ]) {
      const host = `${punycodeOf(name)}.ge`;
      expect(readableHost(host), name).toBe(host);
    }
    // One part that can't be shown keeps the whole name as it is.
    const host = `${punycodeOf('მაღაზია')}.${punycodeOf('bücher')}.ge`;
    expect(readableHost(host)).toBe(host);
    // Not punycode at all.
    expect(readableHost('xn--zz.ge')).toBe('xn--zz.ge');
  });
});
