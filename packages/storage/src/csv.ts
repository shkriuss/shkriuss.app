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
 * One cell, quoted when it holds a quote, comma or line break. Text that a
 * spreadsheet would run as a formula (starting with =, +, -, @, a tab or a
 * carriage return) gets a ' in front, so a note typed as "=HYPERLINK(…)"
 * stays text when the file is opened. Numbers stay numbers, negative too.
 */
export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows of cells (the header first) as a CSV file: lines end in CRLF, the last one too. */
export const csvFile = (rows: readonly (readonly CsvValue[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
