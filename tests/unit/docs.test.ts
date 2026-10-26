/**
 * The docs are read by every AI session before it changes anything (CLAUDE.md,
 * "Keep the docs true"), so a file they point to must still be there: every
 * link between the repository's Markdown files, with its heading, and every
 * file path written in backticks, like `packages/sync/src/client.ts`. A file
 * that's renamed, moved or deleted then fails here until its docs follow.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

const docs = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** A doc without its fenced code blocks (examples, not links). */
const prose = (doc: string): string =>
  readFileSync(join(repoRoot, doc), 'utf8').replace(/^```[\s\S]*?^```/gm, '');

/** The anchors GitHub gives a doc's headings: "## Rolling back" is #rolling-back. */
function anchors(doc: string): Set<string> {
  const seen = new Map<string, number>();
  const found = new Set<string>();
  for (const [, heading = ''] of prose(doc).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = heading
      .replace(/`/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const times = seen.get(slug) ?? 0;
    seen.set(slug, times + 1);
    found.add(times === 0 ? slug : `${slug}-${times}`);
  }
  return found;
}

/** Whether git leaves a path out on purpose (the build makes it), so a doc may name it. */
function madeByBuild(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** Where a path in a doc may be from: the repository, or the doc's own app or package. */
function bases(doc: string): string[] {
  const own = /^(apps|packages)\/[^/]+\//.exec(doc)?.[0];
  return own ? ['', own] : [''];
}

describe('the docs', () => {
  it('are all found', () => {
    expect(docs.length).toBeGreaterThan(30);
  });

  it('link only to files and headings that exist', () => {
    const broken: string[] = [];
    for (const doc of docs) {
      for (const [, link = ''] of prose(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [path = '', anchor] = link.split('#');
        const target = path ? normalize(join(dirname(doc), decodeURI(path))) : doc;
        if (!existsSync(join(repoRoot, target))) broken.push(`${doc}: ${link}`);
        else if (anchor && target.endsWith('.md') && !anchors(target).has(anchor)) {
          broken.push(`${doc}: ${link} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('name only files that exist', () => {
    const missing: string[] = [];
    for (const doc of docs) {
      // An app's or package's own docs also name its files from its folder,
      // like `src/lib/photos.ts` (audit 3 J-8).
      const own = bases(doc).length > 1 ? '|src|e2e|public' : '';
      const named = new RegExp(
        `\`((?:apps|packages|scripts|tests|docs|templates|\\.github${own})\\/[\\w./@-]+)\``,
        'g',
      );
      for (const [, path = ''] of prose(doc).matchAll(named)) {
        const clean = path.replace(/[/.]+$/, '');
        const exists = (base: string) =>
          existsSync(join(repoRoot, base, clean)) || madeByBuild(join(base, clean));
        if (!bases(doc).some(exists)) missing.push(`${doc}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
