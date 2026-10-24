/**
 * Reading numbers people type, for fields like amounts, prices and hours.
 *
 * Fields are `type="text" inputmode="decimal"`, not `type="number"`: with
 * `type="number"`, the browser quietly drops or reinterprets a comma before
 * the page sees it ("12,50" becomes 1250 in an English browser), and many
 * phone keyboards only offer a comma.
 */

/**
 * A typed number: null when empty, NaN when it isn't one. One point or one
 * comma is the decimal separator; spaces are ignored. Anything ambiguous,
 * like "1.234,50" or "1,500.25", isn't a number, so the person is asked again.
 */
export function parseDecimal(text: string): number | null {
  const compact = text.replace(/\s/g, '');
  if (compact === '') return null;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(compact)) return Number.NaN;
  return Number(compact.replace(',', '.'));
}

// ---------- Money ----------

/** The currencies Budget, Trades and Repairs offer (ISO 4217 codes). */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

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
