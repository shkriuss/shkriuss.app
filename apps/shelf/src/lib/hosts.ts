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

/** Scripts with no letters that look like Latin ones: a name in one of them can't pass for another site's. */
const READABLE = ['Georgian', 'Han', 'Hiragana', 'Katakana', 'Hangul'].map(
  (script) => new RegExp(`^[\\p{Script=${script}}0-9-]+$`, 'u'),
);

/** Whether a part of a name, decoded, is in one readable script (with digits and hyphens). */
const isReadable = (label: string): boolean =>
  /\P{ASCII}/u.test(label) && READABLE.some((script) => script.test(label));

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
