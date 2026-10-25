/**
 * People can type in any language. A box for their own words follows the
 * words' direction (dir="auto"), so Hebrew or Arabic reads right to left,
 * with its full stop or "!" at its own end (audit Z-10). Boxes for numbers
 * (inputmode="decimal" or "numeric"), dates, times and the like don't need it.
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

/** Text boxes in a file's markup without dir="auto", as `<tag id>` for the message. */
function boxesWithoutDirection(source: string): string[] {
  const found: string[] = [];
  // An attribute value in {…} may hold ">", so tags are read up to a ">" outside braces.
  for (const [, tag = '', attributes = ''] of source.matchAll(
    /<(input|textarea)\b((?:[^>{]|\{[^}]*\})*)>/g,
  )) {
    if (tag === 'input') {
      // No type is a text box too, and a type worked out in {…} may be one (audit J-14).
      const type = /\stype=(?:"([^"]*)"|\{)/.exec(attributes)?.[1] ?? 'text';
      if (type !== 'text' && type !== 'search') continue;
      if (/\sinputmode="(decimal|numeric)"/.test(attributes)) continue;
    }
    if (/\sdir="auto"/.test(attributes)) continue;
    const name = /\s(?:id|name)="([^"]*)"/.exec(attributes)?.[1] ?? '';
    found.push(`<${tag} ${name}>`.replace(' >', '>'));
  }
  return found;
}

describe('text people type', () => {
  it('spots a text box without dir="auto"', () => {
    expect(boxesWithoutDirection('<input class="input" type="text" id="name" />')).toEqual([
      '<input name>',
    ]);
    expect(boxesWithoutDirection('<textarea\n  id="notes"\n></textarea>')).toEqual([
      '<textarea notes>',
    ]);
    expect(boxesWithoutDirection('<input dir="auto" type="search" id="search" />')).toEqual([]);
    expect(boxesWithoutDirection('<input type="text" inputmode="decimal" id="price" />')).toEqual(
      [],
    );
    expect(boxesWithoutDirection('<input type="date" id="day" />')).toEqual([]);
    expect(boxesWithoutDirection('<input id="nickname" />')).toEqual(['<input nickname>']);
    expect(boxesWithoutDirection('<input type={kind} id="answer" />')).toEqual(['<input answer>']);
  });

  it('is shown in its own direction in every text box', () => {
    const files = globSync(
      ['apps/*/src/**/*.astro', 'packages/ui/src/**/*.astro', 'templates/app/src/**/*.astro'],
      { cwd: repoRoot },
    );
    expect(files.length).toBeGreaterThan(15);
    const problems = files.flatMap((file) =>
      boxesWithoutDirection(readFileSync(join(repoRoot, file), 'utf8')).map(
        (box) => `${file}: ${box}`,
      ),
    );
    expect(problems).toEqual([]);
  });
});
