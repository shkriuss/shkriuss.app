/**
 * Astro scopes each file's styles to the elements written in that file. An
 * icon comes from the <Icon> component, so a page rule like `.mark svg` never
 * reaches it (audit G-5: Habits showed a tick on every day). Such rules need
 * `.mark :global(svg)`.
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

/** Selectors in a file's scoped styles that name an `svg` the file doesn't draw itself. */
function unscopedIconRules(source: string): string[] {
  if (/<svg[\s>]/.test(source.replace(/<style[\s\S]*?<\/style>/g, ''))) return [];
  const found: string[] = [];
  for (const [, attributes = '', css = ''] of source.matchAll(
    /<style([^>]*)>([\s\S]*?)<\/style>/g,
  )) {
    if (attributes.includes('is:global')) continue;
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors = ''] of rules.matchAll(/([^{}]+)\{/g)) {
      for (const selector of selectors.split(',')) {
        const own = selector.replace(/:global\([^)]*\)/g, '');
        if (/(^|[\s>+~])svg\b/.test(own.trim())) found.push(selector.trim());
      }
    }
  }
  return found;
}

describe('scoped styles', () => {
  it('spots a rule for an icon drawn by another component', () => {
    const page =
      '<span class="mark"><Icon name="check" /></span>\n<style>\n  .mark svg { visibility: hidden; }\n  .mark :global(svg) { width: 1rem; }\n</style>';
    expect(unscopedIconRules(page)).toEqual(['.mark svg']);
    expect(unscopedIconRules(page.replace('<Icon name="check" />', '<svg></svg>'))).toEqual([]);
    expect(unscopedIconRules(page.replace('<style>', '<style is:global>'))).toEqual([]);
  });

  it('every page and component reaches its icons with :global(svg)', () => {
    const files = globSync(['apps/*/src/**/*.astro', 'packages/ui/src/**/*.astro'], {
      cwd: repoRoot,
    });
    expect(files.length).toBeGreaterThan(15);
    const problems = files.flatMap((file) =>
      unscopedIconRules(readFileSync(join(repoRoot, file), 'utf8')).map(
        (selector) => `${file}: ${selector}`,
      ),
    );
    expect(problems).toEqual([]);
  });
});
