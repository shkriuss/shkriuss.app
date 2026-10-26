/**
 * Reading numbers people type, for fields like amounts, prices and hours,
 * and writing numbers back into those fields.
 *
 * Fields are `type="text" inputmode="decimal"` (or `"numeric"` for whole
 * numbers), not `type="number"`: with `type="number"`, the browser quietly
 * drops or reinterprets a comma before the page sees it ("12,50" becomes
 * 1250 in an English browser), and many phone keyboards only offer a comma.
 */

// ---------- How a locale writes numbers ----------

/** Arabic's decimal and thousands signs ("١٬٢٣٤٫٥"): they never mean anything else. */
const ARABIC_DECIMAL = '\u066B';
const ARABIC_GROUP = '\u066C';

/** How a locale writes numbers, as they're typed. */
interface Style {
  /** "." or ",": its decimal sign. */
  decimal: '.' | ',';
  /** "." or "," if it groups thousands with one ("1,500" in English); else "". */
  group: '.' | ',' | '';
  /** True if it groups thousands with an apostrophe ("1'500" in Switzerland). */
  apostrophe: boolean;
  /** Digits in each group before the last three: 3, or 2 in India ("12,34,567"). */
  groupSize: number;
}

const styles = new Map<string, Style>();

/** How `locale` writes numbers (the browser's own when it's left out). */
function styleOf(locale: string | undefined): Style {
  let style = styles.get(locale ?? '');
  if (!style) {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567890.5);
    const sign = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    // Typed on a Latin keyboard, Arabic's ٫ and ٬ are "." and ",".
    const latin = (text: string) => text.replace(ARABIC_DECIMAL, '.').replace(ARABIC_GROUP, ',');
    const decimal = latin(sign('decimal')) === ',' ? ',' : '.';
    const group = latin(sign('group'));
    const integers = parts.filter((part) => part.type === 'integer');
    style = {
      decimal,
      group: (group === '.' || group === ',') && group !== decimal ? group : '',
      apostrophe: group === "'" || group === '’',
      groupSize: integers.at(-2)?.value.length ?? 3,
    };
    styles.set(locale ?? '', style);
  }
  return style;
}

// ---------- Reading what's typed ----------

/**
 * A digit in any script (Arabic ٣, Bengali ৩…) as 0 to 9. Unicode keeps
 * each script's digits together, from 0 to 9, so its value is how far it
 * is from the start of that run.
 */
function latinDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  let zero = code;
  while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return String((code - zero) % 10);
}

/** Thousands grouped right: "1,500" (one group), or "12,345,678" ("12,34,567" in India). */
function isGrouped(groups: readonly string[], size: number): boolean {
  const [first = '', ...rest] = groups;
  const last = rest.pop();
  if (last === undefined || !/^\d{3}$/.test(last)) return false;
  // One sign: one to three digits before it, whatever the locale.
  const most = rest.length === 0 ? 3 : size;
  return (
    new RegExp(`^[1-9]\\d{0,${most - 1}}$`).test(first) &&
    rest.every((group) => group.length === size && /^\d+$/.test(group))
  );
}

/** What a sign between digits is: the decimal sign, one that groups thousands, or neither. */
function kindOf(character: string, style: Style): 'decimal' | 'group' | null {
  if (character === ARABIC_DECIMAL) return 'decimal';
  if (character === ARABIC_GROUP || character === ' ') return 'group';
  if (character === "'" || character === '’') return style.apostrophe ? 'group' : null;
  // A comma or a point that doesn't group thousands in this locale is a decimal sign.
  return character === style.group ? 'group' : 'decimal';
}

/** How parseDecimal reads a typed number. */
export interface ParseOptions {
  /**
   * For amounts kept to the cent (or to the yen), like Budget's: a point or
   * a comma that's neither the locale's decimal sign nor its thousands
   * separator, before exactly three digits, isn't read. "1.500" typed in
   * French could be 1.5 (a phone keyboard's only point) or 1500 (written
   * the German way), and three decimals can't be what's kept, so the person
   * is asked which (whichAmount, audit 3 F2-3).
   */
  cents?: boolean;
}

/**
 * What's typed, as plain digits for Number(): "-1234.5", or "" when nothing
 * is typed. Null when it isn't a number. `whole`: no decimal sign allowed.
 */
function plainDigits(
  text: string,
  style: Style,
  whole: boolean,
  { cents = false }: ParseOptions = {},
): string | null {
  // Full-width digits and signs are plain ones, and any script's digits are 0 to 9.
  const compact = text
    .normalize('NFKC')
    .replace(/(?![0-9])\p{Nd}/gu, latinDigit)
    .trim()
    // A space between digits (or a no-break space, as some locales group
    // with) groups thousands, checked like a comma: "1 500" is 1500, but
    // "12 50" isn't a number (audit 3 F2-4). Other spaces are left out.
    .replace(/\s+/g, (space: string, at: number, all: string) =>
      /\d/.test(all.charAt(at - 1)) && /\d/.test(all.charAt(at + space.length)) ? ' ' : '',
    );
  if (compact === '') return '';
  const match = /^([+-]?)([\d.,'’ \u066B\u066C]+)$/.exec(compact);
  const [, minus = '', body = ''] = match ?? [];
  if (!/\d/.test(body)) return null;
  const signs = [...body.matchAll(/\D/g)].map((found) => ({
    at: found.index,
    kind: kindOf(found[0], style),
  }));
  if (signs.some((sign) => sign.kind === null)) return null;
  // One comma or point that can't group thousands ("12,50", "1,5000", or
  // "1 234,5", after a space that does) is a decimal sign.
  const [only, ...more] = signs.filter((sign) => /^[.,]$/.test(body.charAt(sign.at)));
  if (only && more.length === 0) {
    if (!isGrouped([body.slice(0, only.at), body.slice(only.at + 1)], 3)) only.kind = 'decimal';
    // Kept to the cent, it's read as a decimal sign only if it's this
    // locale's own: "1.500" in French could as well be thousands (ParseOptions).
    else if (cents && only.kind === 'decimal' && body.charAt(only.at) !== style.decimal) {
      return null;
    }
  }
  const points = signs.filter((sign) => sign.kind === 'decimal');
  if (points.length > (whole ? 0 : 1)) return null;
  const at = points[0]?.at ?? body.length;
  const fraction = body.slice(at + 1);
  if (/\D/.test(fraction)) return null;
  // Before the decimal sign: digits grouped right, with one sign throughout.
  let digits = body.slice(0, at);
  if (/\D/.test(digits)) {
    const groups = digits.split(/\D/);
    if (new Set(digits.match(/\D/g)).size > 1 || !isGrouped(groups, style.groupSize)) return null;
    digits = groups.join('');
  }
  return `${minus}${digits || '0'}${fraction ? `.${fraction}` : ''}`;
}

/**
 * A typed number: null when empty, NaN when it isn't one. It's read the way
 * `locale` (the browser's own when it's left out) writes numbers, in its
 * own digits too (Arabic "١٢٫٥" is 12.5):
 *
 * - One comma or point is a decimal sign: "12,50" and "12.50" are 12.5
 *   everywhere, as many phone keyboards have only one of them.
 * - Except one followed by exactly three digits, after one to three others
 *   (not starting with 0), when it's the locale's thousands separator:
 *   "1,500" is 1500 in English and 1.5 in German, "1.500" the other way
 *   round.
 * - A number written in the locale's style is read too: "1,234.50" in
 *   English, "1.234,50" in German. Mixed or wrong grouping isn't a number
 *   ("1.234.50", or "1,23,456" outside India), so the person is asked
 *   again. A space between digits groups thousands in any locale, and is
 *   checked the same way: "1 234,50" (French) is 1234.5, "12 50" isn't a
 *   number.
 * - Exponents ("1e3"), "Infinity" and anything else aren't numbers.
 * - With `cents`, for amounts kept to the cent: what could be read two ways
 *   isn't a number ("1.500" in French: see ParseOptions).
 */
export function parseDecimal(text: string, locale?: string, options?: ParseOptions): number | null {
  const digits = plainDigits(text, styleOf(locale), false, options);
  if (digits === '') return null;
  return digits === null ? Number.NaN : Number(digits);
}

/**
 * What to ask when an amount kept to the cent could be two numbers, so
 * parseDecimal with `cents` didn't read it: for "1.500" in French, "Enter
 * 1500 or 1,5 to show which you mean." Null when it's one number, or none.
 */
export function whichAmount(text: string, locale?: string): string | null {
  const style = styleOf(locale);
  const digits = plainDigits(text, style, false);
  if (!digits || plainDigits(text, style, false, { cents: true }) !== null) return null;
  // Read the other way, its point groups thousands: the same digits without it.
  const thousands = Number(digits.replace('.', ''));
  return `Enter ${decimalText(thousands, locale)} or ${decimalText(Number(digits), locale)} to show which you mean.`;
}

/**
 * A typed whole number, like a mileage, read as parseDecimal reads it, but
 * with no decimal sign: "120.000" is 120000 in German, and isn't a whole
 * number in English (so the person is asked again). Null when empty, NaN
 * when it isn't one.
 */
export function parseWhole(text: string, locale?: string): number | null {
  const digits = plainDigits(text, styleOf(locale), true);
  if (digits === '') return null;
  return digits === null ? Number.NaN : Number(digits);
}

// ---------- Writing numbers into fields ----------

/**
 * A number as a person would type it, to fill in a form: plain digits with
 * the decimal sign of `locale` ("1234.5", or "1234,5" in German), never
 * grouped or written with an exponent ("0.0000000015", not "1.5e-9"), with
 * the fewest digits that are exactly this number. parseDecimal reads it back
 * as the same number.
 */
export function decimalText(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  const [mantissa = '', exponent = '0'] = String(Math.abs(value)).split('e');
  const [before = '', after = ''] = mantissa.split('.');
  // Where the decimal point goes in all the digits, once the exponent is undone.
  const point = before.length + Number(exponent);
  const digits = `${'0'.repeat(Math.max(0, 1 - point))}${before}${after}`.padEnd(point, '0');
  const at = Math.max(1, point);
  const whole = digits.slice(0, at).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(at).replace(/0+$/, '');
  const sign = value < 0 ? '-' : '';
  return fraction ? `${sign}${whole}${styleOf(locale).decimal}${fraction}` : `${sign}${whole}`;
}

// ---------- Rounding ----------

/**
 * `value` rounded to `digits` decimals, half away from zero, by its decimal
 * digits as written (1.005 is 1.01: Math.round(1.005 * 100) is 100, as
 * 1.005 * 100 is 100.49999999999999). Never -0, which Intl shows as "-0.00".
 */
export function roundDecimal(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const shift = (number: number, places: number): number => {
    const [mantissa = '', exponent = '0'] = String(number).split('e');
    return Number(`${mantissa}e${Number(exponent) + places}`);
  };
  return Math.sign(value) * shift(Math.round(shift(Math.abs(value), digits)), -digits) || 0;
}

// ---------- Money ----------

/** The currencies Budget, Trades and Repairs offer (ISO 4217 codes). */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** The decimals a currency has: 2 for dollars (cents), 0 for yen. Any ISO 4217 code works. */
export const currencyDigits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;

export interface MoneyOptions {
  /** "+$480.00" and "-$120.00" (zero has no sign). */
  signed?: boolean;
  /** The person's own style when left out. */
  locale?: string | undefined;
}

// One formatter for each way money is shown: making one for each amount is
// slow on a long list.
const moneyFormats = new Map<string, Intl.NumberFormat>();

/** "$1,234.50"; with `signed`, "+$480.00" or "-$120.00". Any ISO 4217 code works. */
export function formatMoney(
  amount: number,
  currency: string,
  { signed = false, locale }: MoneyOptions = {},
): string {
  const key = `${locale ?? ''} ${currency} ${signed}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}
