import { describe, expect, it } from 'vitest';
import { csvCell, csvFile } from './csv.ts';

describe('spreadsheet files', () => {
  it('never lets text run as a formula', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${start}SUM(A1)`).replace(/^"/, '')).toMatch(/^'/);
    }
    expect(csvCell('=HYPERLINK("https://x.example")')).toBe(`"'=HYPERLINK(""https://x.example"")"`);
    // Numbers stay numbers, negative too; text that only contains a sign is fine.
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell('Fixed = done')).toBe('Fixed = done');
  });

  it('quotes cells with quotes, commas or line breaks, and leaves the rest', () => {
    expect(csvCell('Fixed, "properly"')).toBe('"Fixed, ""properly"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('Brakes')).toBe('Brakes');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
  });

  it('ends every line with CRLF, the last one too', () => {
    expect(
      csvFile([
        ['Date', 'Amount', 'Note'],
        ['2026-10-03', 2000, '=pay'],
        ['2026-10-04', null, 'a, b'],
      ]),
    ).toBe('\uFEFFDate,Amount,Note\r\n2026-10-03,2000,\'=pay\r\n2026-10-04,,"a, b"\r\n');
    expect(csvFile([['Only a header']])).toBe('\uFEFFOnly a header\r\n');
  });

  // Audit 3 F2-6: without it, Excel showed "Mike’s bus" as "Mikeâ€™s bus".
  it('starts with a byte-order mark, once, so Excel reads it as UTF-8', async () => {
    const file = csvFile([
      ['Vehicle', 'Parts'],
      ['Mike’s bus', 'Brake pads × 2'],
      ['ავტობუსი', ''],
    ]);
    // What the browser writes: the Blob's bytes.
    const bytes = new Uint8Array(await new Blob([file], { type: 'text/csv' }).arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 'V'.charCodeAt(0)]);
    expect(file.match(/\uFEFF/g)).toHaveLength(1);
    // Read back as UTF-8 (the mark is dropped), the text is as it was.
    expect(new TextDecoder().decode(bytes).split('\r\n')).toEqual([
      'Vehicle,Parts',
      'Mike’s bus,Brake pads × 2',
      'ავტობუსი,',
      '',
    ]);
  });
});
