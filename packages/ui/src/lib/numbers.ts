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
