import { describe, expect, it } from 'vitest';
import { csvCell, csvFile, decimalSignOf } from './csv.ts';

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

  // Audit 4 F2-9: a spreadsheet that splits cells at ";" started a new cell,
  // a formula, inside the note "Lunch;=1+1".
  it('keeps a cell whole and inert wherever a spreadsheet splits cells', () => {
    expect(csvCell('Lunch;=1+1')).toBe(`"Lunch;'=1+1"`);
    expect(csvCell('a\t+1')).toBe("a\t'+1");
    expect(csvCell('two\n@lines')).toBe(`"two\n'@lines"`);
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('a; b')).toBe('"a; b"');
    // Signs elsewhere are text as they are.
    expect(csvCell('Pads - front')).toBe('Pads - front');
  });

  it('quotes cells with quotes, commas, semicolons or line breaks, and leaves the rest', () => {
    expect(csvCell('Fixed, "properly"')).toBe('"Fixed, ""properly"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('Brakes')).toBe('Brakes');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
  });

  it('ends every line with CRLF, the last one too', () => {
    expect(
      csvFile(
        [
          ['Date', 'Amount', 'Note'],
          ['2026-10-03', 2000, '=pay'],
          ['2026-10-04', null, 'a, b'],
        ],
        'en-US',
      ),
    ).toBe('\uFEFFDate,Amount,Note\r\n2026-10-03,2000,\'=pay\r\n2026-10-04,,"a, b"\r\n');
    expect(csvFile([['Only a header']], 'en-US')).toBe('\uFEFFOnly a header\r\n');
  });

  // Audit 4 F2-9: Excel opens a CSV file at the computer's own list
  // separator, ";" where decimals are written with a comma. There each row
  // landed in one cell, and amounts weren't numbers.
  it('splits cells and writes numbers as the person’s language does', () => {
    const rows = [
      ['Date', 'Amount', 'Note'],
      ['2026-10-03', -12.5, 'Lunch; with Ana'],
      ['2026-10-04', 1500, ''],
    ];
    for (const locale of ['de-DE', 'fr-FR', 'ka-GE', 'ru-RU', 'es-ES']) {
      expect(decimalSignOf(locale), locale).toBe(',');
      expect(csvFile(rows, locale), locale).toBe(
        '\uFEFFDate;Amount;Note\r\n2026-10-03;-12,5;"Lunch; with Ana"\r\n2026-10-04;1500;\r\n',
      );
    }
    for (const locale of ['en-US', 'en-GB', 'ja-JP', 'de-CH']) {
      expect(decimalSignOf(locale), locale).toBe('.');
      expect(csvFile(rows, locale), locale).toBe(
        '\uFEFFDate,Amount,Note\r\n2026-10-03,-12.5,"Lunch; with Ana"\r\n2026-10-04,1500,\r\n',
      );
    }
  });

  // Audit 3 F2-6: without it, Excel showed "Mike’s bus" as "Mikeâ€™s bus".
  it('starts with a byte-order mark, once, so Excel reads it as UTF-8', async () => {
    const file = csvFile(
      [
        ['Vehicle', 'Parts'],
        ['Mike’s bus', 'Brake pads × 2'],
        ['ავტობუსი', ''],
      ],
      'en-US',
    );
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
