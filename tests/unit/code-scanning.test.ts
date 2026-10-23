/**
 * Code scanning (CodeQL) skips folders whose names start with a dot, so code
 * in one is never checked for security problems: the hub's security.txt page,
 * once in `.well-known/`, was the one file it didn't read.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

describe('code scanning', () => {
  it('reads every script: none is in a folder whose name starts with a dot', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.filter((file) =>
        file
          .split('/')
          .slice(0, -1)
          .some((folder) => folder.startsWith('.')),
      ),
    ).toEqual([]);
  });
});
