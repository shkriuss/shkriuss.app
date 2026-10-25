import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  lockedPackages,
  releaseAgeRules,
  tooNew,
  unregisteredPackages,
} from './lockfile-age.ts';

const lockfile = (packages: string[]) => `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^5.0.0
        version: 5.0.4

packages:

${packages.map((key) => `  ${key}:\n    resolution: {integrity: sha512-x}\n`).join('\n')}
snapshots:

  vitest@5.0.4(@types/node@24.3.0):
    dependencies:
      tinyspy: 4.0.0
`;

describe('the lockfile age check', () => {
  it('reads the packages a lockfile lists, scoped ones too', () => {
    expect([...lockedPackages(lockfile(['vitest@5.0.4', "'@types/node@24.3.0'"]))]).toEqual([
      'vitest@5.0.4',
      '@types/node@24.3.0',
    ]);
  });

  it('finds the versions a pull request adds', () => {
    const base = lockfile(['vitest@5.0.4', "'@types/node@24.3.0'"]);
    const head = lockfile(['vitest@5.0.5', "'@types/node@24.3.0'", 'harper.js@2.13.0']);
    expect(addedPackages(base, head)).toEqual([
      ['vitest', '5.0.5'],
      ['harper.js', '2.13.0'],
    ]);
  });

  it('reads the rules from pnpm-workspace.yaml', () => {
    expect(releaseAgeRules('minimumReleaseAge: 10080\nstrictDepBuilds: true\n')).toEqual({
      minutes: 10080,
      exclude: [],
    });
    expect(
      releaseAgeRules(
        "minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - harper.js\n  - '@types/*'\n",
      ),
    ).toEqual({ minutes: 60, exclude: ['harper.js', '@types/*'] });
  });

  it('refuses versions younger than the rule, or with no publish time, unless excluded', () => {
    const day = 24 * 60 * 60_000;
    const now = Date.UTC(2026, 9, 22);
    const added: [string, string][] = [
      ['old', '1.0.0'],
      ['young', '2.0.0'],
      ['unknown', '3.0.0'],
      ['@types/node', '24.4.0'],
    ];
    const published = new Map([
      ['old@1.0.0', now - 8 * day],
      ['young@2.0.0', now - 6 * day],
      ['@types/node@24.4.0', now - day],
    ]);
    expect(tooNew(added, published, { minutes: 10080, exclude: [] }, now)).toEqual([
      'young@2.0.0',
      'unknown@3.0.0',
      '@types/node@24.4.0',
    ]);
    expect(
      tooNew(added, published, { minutes: 10080, exclude: ['@types/*', 'young'] }, now),
    ).toEqual(['unknown@3.0.0']);
  });

  it('finds nothing new in this repository’s own lockfile against itself', async () => {
    const { readFileSync } = await import('node:fs');
    const current = readFileSync('pnpm-lock.yaml', 'utf8');
    expect(lockedPackages(current).size).toBeGreaterThan(100);
    expect(addedPackages(current, current)).toEqual([]);
    expect(unregisteredPackages(current)).toEqual([]);
  });

  it('finds packages from a web address or a git repository, which it can’t check (audit H-1)', () => {
    // What pnpm 10 writes for those, and for a version from the registry.
    const head = `lockfileVersion: '9.0'

packages:

  evil@https://example.com/evil-1.0.0.tgz:
    resolution: {tarball: https://example.com/evil-1.0.0.tgz}
    version: 1.0.0

  sneaky@https://codeload.github.com/someone/sneaky/tar.gz/0123456789abcdef0123456789abcdef01234567:
    resolution: {tarball: https://codeload.github.com/someone/sneaky/tar.gz/0123456789abcdef0123456789abcdef01234567}
    version: 2.0.0

  '@scope/plain@1.2.3-beta.1':
    resolution: {integrity: sha512-x}

  odd@4.5.6:
    resolution: {tarball: https://example.com/odd.tgz}

snapshots:

  evil@https://example.com/evil-1.0.0.tgz: {}
`;
    expect(unregisteredPackages(head)).toEqual([
      'evil@https://example.com/evil-1.0.0.tgz',
      'sneaky@https://codeload.github.com/someone/sneaky/tar.gz/0123456789abcdef0123456789abcdef01234567',
      'odd@4.5.6',
    ]);
  });
});
