import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayOf, lastUpdated, laterDay, mergedDay } from './last-updated.ts';

describe('dayOf', () => {
  it('gives the day where the commit was made', () => {
    expect(dayOf('2026-10-31T19:46:57+04:00')).toBe('31 October 2026');
    // Just after midnight in Tbilisi is still 31 October in UTC: the page
    // says the day the person merging it had.
    expect(dayOf('2026-11-01T01:05:00+04:00')).toBe('1 November 2026');
    expect(dayOf('not a time')).toBeNull();
    expect(dayOf('2026-13-01T00:00:00Z')).toBeNull();
  });
});

describe('laterDay', () => {
  it('shows the day it was merged, when that’s later than the day it was written', () => {
    // The fifth audit's text (audit 6 D-2).
    expect(laterDay('27 October 2026', '31 October 2026')).toBe('31 October 2026');
    expect(laterDay('31 December 2026', '1 January 2027')).toBe('1 January 2027');
  });

  it('keeps the day it was written otherwise', () => {
    expect(laterDay('1 November 2026', '31 October 2026')).toBe('1 November 2026');
    expect(laterDay('1 November 2026', '1 November 2026')).toBe('1 November 2026');
    expect(laterDay('1 November 2026', null)).toBe('1 November 2026');
    expect(laterDay('1 November 2026', 'soon')).toBe('1 November 2026');
  });
});

describe('mergedDay', () => {
  const root = mkdtempSync(join(tmpdir(), 'shkriuss-last-updated-'));
  const repo = join(root, 'repo');
  const page = 'apps/hub/src/pages/privacy.astro';
  const run = (cwd: string, args: string[], time = '2026-10-20T10:00:00+04:00') =>
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: {
        ...process.env,
        // Not the computer's own settings (signing, hooks, a default branch).
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: time,
        GIT_COMMITTER_DATE: time,
      },
    });
  const commit = (text: string, time: string) => {
    writeFileSync(join(repo, page), text);
    run(repo, ['add', '.'], time);
    run(repo, ['commit', '-q', '-m', 'change', '--no-verify'], time);
  };
  const source = (date: string, words: string) =>
    `---\nconst LAST_UPDATED = '${date}'; // text 0123456789abcdef\n---\n<p>${words}</p>\n`;

  beforeAll(() => {
    mkdirSync(join(repo, 'apps/hub/src/pages'), { recursive: true });
    run(repo, ['init', '-q']);
    commit(source('20 October 2026', 'First words.'), '2026-10-20T10:00:00+04:00');
    // Written on the 27th, merged on the 31st, as the fifth audit's text was.
    commit(source('27 October 2026', 'New words.'), '2026-10-31T19:46:57+04:00');
    // A later change elsewhere on the page that isn't its text (a style).
    writeFileSync(join(repo, 'README.md'), 'Other work.\n');
    commit(
      `${source('27 October 2026', 'New words.')}<style></style>\n`,
      '2026-11-05T09:00:00+04:00',
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the day the text last changed on the branch (audit 6 D-2)', () => {
    expect(mergedDay(repo)).toBe('31 October 2026');
    expect(lastUpdated('27 October 2026', repo)).toBe('31 October 2026');
    // From inside the repository, as the build runs it (apps/hub).
    expect(mergedDay(join(repo, 'apps/hub'))).toBe('31 October 2026');
  });

  it('can’t tell from a clone without that history, so the page keeps its own day', () => {
    const shallow = join(root, 'shallow');
    run(root, ['clone', '-q', '--depth', '1', `file://${repo}`, shallow]);
    expect(mergedDay(shallow)).toBeNull();
    expect(lastUpdated('27 October 2026', shallow)).toBe('27 October 2026');
  });

  it('can’t tell outside a repository', () => {
    expect(mergedDay(root)).toBeNull();
    expect(lastUpdated('27 October 2026', root)).toBe('27 October 2026');
  });
});
