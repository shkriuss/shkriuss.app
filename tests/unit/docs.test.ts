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
      for (const [, path = ''] of prose(doc).matchAll(
        /`((?:apps|packages|scripts|tests|docs|templates|\.github)\/[\w./@-]+)`/g,
      )) {
        const clean = path.replace(/[/.]+$/, '');
        if (!bases(doc).some((base) => existsSync(join(repoRoot, base, clean)))) {
          missing.push(`${doc}: ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
