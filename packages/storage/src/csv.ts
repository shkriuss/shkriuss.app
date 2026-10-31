/**
 * Spreadsheet (CSV) files for apps to download with downloadFile(), like
 * Budget's, Repairs' and Trades' "Download a spreadsheet":
 *
 *   import { csvFile } from '@shkriuss/storage/csv';
 *   downloadFile('budget.csv', csvFile([['Date', 'Note'], ...rows]), 'text/csv');
 */

/** What a cell holds: text, a number, or nothing (an empty cell). */
export type CsvValue = string | number | null;

/**
 * "." or ",": how `locale` (the browser's own when left out) writes decimals.
 * Where it's a comma, spreadsheets split a CSV file's cells at ";", as Excel
 * does in German, French, Georgian and most European settings.
 */
export function decimalSignOf(locale?: string): '.' | ',' {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
  return parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.';
}

/**
 * A number with all its digits and never an exponent: "0.0000000015", not
 * "1.5e-9", which a spreadsheet may read as text, and as the page shows it.
 * Written as decimalText (@shkriuss/ui/numbers) writes it, which this
 * package can't import, as that one imports this (audit 5 F2-6).
 */
function plainDigits(value: number): string {
  const [mantissa = '', exponent = '0'] = String(Math.abs(value)).split('e');
  const [before = '', after = ''] = mantissa.split('.');
  // Where the decimal point goes in all the digits, once the exponent is undone.
  const point = before.length + Number(exponent);
  const digits = `${'0'.repeat(Math.max(0, 1 - point))}${before}${after}`.padEnd(point, '0');
  const at = Math.max(1, point);
  const whole = digits.slice(0, at).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(at).replace(/0+$/, '');
  const sign = value < 0 ? '-' : '';
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * One cell. Numbers stay numbers, negative too, with every digit written
 * out (plainDigits) and `decimal` as their decimal sign. Text is quoted
 * when it holds a quote, a comma, a semicolon or a line break, whichever
 * sign the file splits cells at, so a
 * spreadsheet that splits at the other one keeps it whole. Text that a
 * spreadsheet would run as a formula gets a ' in front: at its start (=, +,
 * -, @, a tab or a carriage return), so a note typed as "=HYPERLINK(…)"
 * stays text when the file is opened, and after a comma, a semicolon, a tab
 * or a line break inside it ("Lunch;=1+1"), where a spreadsheet splitting
 * there would start a new cell (audit 4 F2-9). After a comma too, as a file
 * split at ";" can be opened by a spreadsheet that splits at ",": it doesn't
 * see the quotes then, as they're in the middle of its cell.
 */
export function csvCell(value: CsvValue, decimal: '.' | ',' = '.'): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    const text = Number.isFinite(value) ? plainDigits(value) : String(value);
    return decimal === ',' ? text.replace('.', ',') : text;
  }
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  text = text.replace(/([,;\t\r\n])([=+\-@])/g, "$1'$2");
  return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Rows of cells (the header first) as a CSV file, as a spreadsheet in the
 * language of `locale` (the browser's own when left out) reads it: cells
 * split by "," and numbers like "12.5", or, where decimals are written with
 * a comma, by ";" and "12,5". Otherwise every row ended up in one cell
 * there, and amounts weren't numbers (audit 4 F2-9). Lines end in CRLF, the
 * last one too. It starts with a byte-order mark (U+FEFF): without it, Excel
 * reads the file in the computer's older encoding, so anything beyond plain
 * English letters comes out garbled ("Mike’s bus" as "Mikeâ€™s bus", and
 * Georgian names). Numbers, Google Sheets and LibreOffice read it too
 * (audit 3 F2-6).
 */
export function csvFile(rows: readonly (readonly CsvValue[])[], locale?: string): string {
  const decimal = decimalSignOf(locale);
  const separator = decimal === ',' ? ';' : ',';
  return (
    '\uFEFF' +
    rows.map((row) => row.map((cell) => csvCell(cell, decimal)).join(separator)).join('\r\n') +
    '\r\n'
  );
}
