/**
 * Web addresses as people read them (audit F3-10). A browser keeps a name
 * in another alphabet, like "მაღაზია.გე", as "punycode"
 * ("xn--lodaaxko2f.xn--node"), which nobody can read. Shelf shows it in its
 * own letters, but only when that can't make it look like another site, as
 * browsers do: each such part of the name in a single one of a few scripts
 * whose letters don't look like Latin ones. Otherwise (a Cyrillic "аррӏе"
 * looks just like "apple", say) it stays as punycode.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

/** RFC 3492's bias adaptation. */
function adapt(delta: number, points: number, first: boolean): number {
  let scaled = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  scaled += Math.floor(scaled / points);
  let k = 0;
  while (scaled > ((BASE - T_MIN) * T_MAX) / 2) {
    scaled = Math.floor(scaled / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

/** A punycode digit's value ("a"–"z" are 0–25, "0"–"9" are 26–35), or BASE if it isn't one. */
function digitOf(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE;
}

/**
 * Decodes punycode (RFC 3492): the part of a name after "xn--". Null if it
 * isn't valid punycode.
 */
export function decodePunycode(input: string): string | null {
  const delimiter = input.lastIndexOf('-');
  const output: number[] = [];
  for (let index = 0; index < delimiter; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = 0x80;
  let bias = 72;
  let i = 0;
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length;) {
    const before = i;
    for (let weight = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitOf(input.charCodeAt(index));
      index += 1;
      if (digit >= BASE) return null;
      i += digit * weight;
      const threshold = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < threshold) break;
      weight *= BASE - threshold;
      if (!Number.isSafeInteger(i) || !Number.isSafeInteger(weight)) return null;
    }
    const length = output.length + 1;
    bias = adapt(i - before, length, before === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i, 0, n);
    i += 1;
  }
  return output.map((code) => String.fromCodePoint(code)).join('');
}

/**
 * Scripts with no letters that look like Latin ones: a name in one of them
 * can't pass for another site's. Japanese names mix kanji (Han) with kana,
 * and use the prolonged sound mark "ー" and the middle dot "・", which
 * belong to no one script, so those go together, as browsers' own rules
 * have them: before, "コーヒー.jp" and "東京タワー.jp" stayed as "xn--…"
 * (audit 5 F3-4). Korean: whole syllables only, as Korean names are
 * written; its letters on their own ("ㅇ", "ㅣ") pass for "0" and "1".
 */
const READABLE = [
  '\\p{Script=Georgian}',
  '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FB\\u30FC',
  '\\uAC00-\\uD7A3',
].map((letters) => new RegExp(`^[${letters}0-9-]+$`, 'u'));

const KANA = '\\p{Script=Hiragana}\\p{Script=Katakana}';
const JAPANESE = `\\p{Script=Han}${KANA}`;
/** Kanji that pass for a digit or a sign ("〇" for "0", "十" for "+"): Chromium's list. */
const KANJI_SIGNS = '一丨乛七丅十〇工丁丶亅二亠冖宀巛';
/** Kana and kanji that pass for a slash: Chromium's list. */
const SLASHES = 'ノソゾン丶乀乁丿';

/**
 * Where a Japanese name's look-alikes may not stand, from the rules
 * Chromium's address bar follows (its IDN spoof checker), and the kanji "一"
 * next to kana, where it reads as "ー" ("コ一ヒ一" for "コーヒー"). Mixing
 * kanji and kana let these pass (audit 6 C-1).
 */
const LOOK_ALIKES = [
  // "ー" only after kana (or another "ー"): elsewhere it passes for a dash.
  new RegExp(`(?:^|[^${KANA}ー])ー`, 'u'),
  // "・" only between Japanese letters: elsewhere it passes for a dot.
  new RegExp(`^・|・$|[^${JAPANESE}ー]・|・[^${JAPANESE}]`, 'u'),
  // "一" next to kana or "ー" passes for "ー".
  new RegExp(`[${KANA}ー]一|一[${KANA}ー]`, 'u'),
  // Next to a digit or a hyphen, kanji that pass for digits or signs ("1〇〇"
  // for "100"); between them, a slash ("1ノ2" for "1/2").
  new RegExp(`[0-9-][${KANJI_SIGNS}]|[${KANJI_SIGNS}][0-9-]|[0-9-][${SLASHES}][0-9-]`, 'u'),
  // Nothing but digits and kanji that pass for digits: "丨〇" for "10".
  /^[0-9〇丨丩-]+$/u,
];

/**
 * Hiragana "へべぺ" and Katakana "ヘベペ" look the same: one of them among
 * the other kana passes for it ("へルプ" for "ヘルプ"), as Chromium's rules
 * have it.
 */
function mixedHe(label: string): boolean {
  const hiragana = label.match(/\p{Script=Hiragana}/gu) ?? [];
  const katakana = label.match(/\p{Script=Katakana}/gu) ?? [];
  return (
    hiragana.length > 0 &&
    katakana.length > 0 &&
    (hiragana.every((letter) => 'へべぺ'.includes(letter)) ||
      katakana.every((letter) => 'ヘベペ'.includes(letter)))
  );
}

/**
 * Whether a part of a name, decoded, is in one readable script (with digits
 * and hyphens), with no look-alike out of place.
 */
const isReadable = (label: string): boolean =>
  /\P{ASCII}/u.test(label) &&
  READABLE.some((script) => script.test(label)) &&
  !LOOK_ALIKES.some((pattern) => pattern.test(label)) &&
  !mixedHe(label);

/**
 * A host name ("xn--lodaaxko2f.xn--node") as people read it ("მაღაზია.გე"),
 * when every part in punycode is in one readable script; else as it is.
 */
export function readableHost(host: string): string {
  const labels = host.split('.').map((label) => {
    if (!/^xn--/i.test(label)) return label;
    const decoded = decodePunycode(label.slice(4).toLowerCase());
    return decoded !== null && isReadable(decoded) ? decoded : null;
  });
  return labels.every((label) => label !== null) ? labels.join('.') : host;
}
