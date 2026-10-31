import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  changedPackages,
  changedSourceSettings,
  lockedPackages,
  npmrcFiles,
  registryIntegrity,
  releaseAgeRules,
  saysWhereFrom,
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
    // Written as YAML allows too (audit 5 H-1), and refused when it isn't a number.
    expect(
      releaseAgeRules("minimumReleaseAge: 60\nminimumReleaseAgeExclude: [harper.js, '@types/*']\n"),
    ).toEqual({ minutes: 60, exclude: ['harper.js', '@types/*'] });
    expect(() => releaseAgeRules('minimumReleaseAge: a week\n')).toThrow(/number of minutes/);
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

  it('finds a registry version that says where to download from, or hides how (audit 3 H-1)', () => {
    // pnpm downloads from a `tarball:` beside the hash (checked: it installed
    // this one from the address), so only a resolution that is a hash alone
    // counts as the registry's.
    const head = `lockfileVersion: '9.0'

packages:

  is-number@7.0.0:
    resolution: {integrity: sha512-y3fHfHYvTerS7NhwClA/DMofcOEjmvlJP4eSdK9JuV4E4h0rXGRTpW8RQlW/76qPl7ZyFtrU5buXVzkPLYtYMw==, tarball: http://127.0.0.1:9988/evil.tgz}
    engines: {node: '>=0.12.0'}

  block@1.0.0:
    resolution:
      integrity: sha512-x
      tarball: https://example.com/block.tgz

  none@1.0.0:
    engines: {node: '>=20'}

  fine@1.0.0:
    resolution: {integrity: sha512-x}
    engines: {node: '>=20'}

snapshots:

  is-number@7.0.0: {}
`;
    expect(unregisteredPackages(head)).toEqual(['is-number@7.0.0', 'block@1.0.0', 'none@1.0.0']);
  });

  it('sees an entry however it’s written, as pnpm does (audit 5 H-1)', () => {
    // These are the entries that slipped past the check when it read the
    // lockfile line by line: pnpm installed each of them (the tarball one from
    // the address). The hash is is-number 7.0.0's real one.
    const integrity =
      'sha512-lzgNOt9BFpUf8fKXwpR7OnQQcmhaE8qokUrT3MkLGkNqcuRez4304GIi4pPM88uIRod8g5eY4tNUI3bvkDj2uA==';
    const empty = "lockfileVersion: '9.0'\n\npackages:\n\nsnapshots:\n";
    const onOneLine = `packages:\n\n  is-number@7.0.0: {resolution: {integrity: ${integrity}}, engines: {node: '>=0.12.0'}}\n`;
    const withComment = `packages:\n\n  is-number@7.0.0: # pinned\n    resolution: {integrity: ${integrity}}\n    engines: {node: '>=0.12.0'}\n`;
    const quotedAndSpaced = `packages:\n\n  "is-number@7.0.0" :\n    resolution:   {integrity: ${integrity}}\n`;
    for (const head of [onOneLine, withComment, quotedAndSpaced]) {
      expect([...lockedPackages(head)], head).toEqual(['is-number@7.0.0']);
      expect(addedPackages(empty, head), head).toEqual([['is-number', '7.0.0']]);
      expect(changedPackages(empty, head), head).toEqual([['is-number', '7.0.0', integrity]]);
      expect(unregisteredPackages(head), head).toEqual([]);
    }
    const tarballOnOneLine = `packages:\n\n  is-number@7.0.0: {resolution: {integrity: ${integrity}, tarball: 'http://127.0.0.1:10000/evil.tgz'}, engines: {node: '>=0.12.0'}}\n`;
    expect(unregisteredPackages(tarballOnOneLine)).toEqual(['is-number@7.0.0']);
    expect(changedPackages(empty, tarballOnOneLine)).toEqual([]);
  });

  it('counts an entry that isn’t a mapping, or a hash that isn’t one, as not from npm', () => {
    const head = `packages:

  nothing@1.0.0:

  words@1.0.0: pinned

  list@1.0.0:
    - resolution: {integrity: sha512-x}

  notahash@1.0.0:
    resolution: {integrity: 'see https://example.com'}

  number@1.0.0:
    resolution: {integrity: 12345}

  merged@1.0.0:
    <<: {resolution: {integrity: sha512-x}}

  fine@1.0.0:
    resolution: {integrity: sha512-x}
`;
    expect(unregisteredPackages(head)).toEqual([
      'nothing@1.0.0',
      'words@1.0.0',
      'list@1.0.0',
      'notahash@1.0.0',
      'number@1.0.0',
      'merged@1.0.0',
    ]);
    expect(changedPackages('packages:\n', head)).toEqual([['fine', '1.0.0', 'sha512-x']]);
  });

  it('refuses a lockfile pnpm would refuse: a key written twice, or not YAML at all', () => {
    const twice = `packages:

  twice@1.0.0:
    resolution: {integrity: sha512-x}
    resolution: {integrity: sha512-x, tarball: https://example.com/twice.tgz}
`;
    expect(() => unregisteredPackages(twice)).toThrow(/unique/);
    expect(() => lockedPackages('packages:\n  a: [\n')).toThrow();
    expect(() => lockedPackages('- a list\n')).toThrow(/mapping/);
    expect(() => lockedPackages('packages: a word\n')).toThrow(/mapping/);
    expect([...lockedPackages('')]).toEqual([]);
    expect([...lockedPackages('packages:\n')]).toEqual([]);
  });

  it('finds the registry versions a pull request adds or gives another hash (audit 3 H-1)', () => {
    const entry = (key: string, integrity: string) =>
      `  ${key}:\n    resolution: {integrity: ${integrity}}\n`;
    const base = `packages:\n\n${entry('kept@1.0.0', 'sha512-a')}\n${entry("'@scope/swapped@2.0.0'", 'sha512-b')}`;
    const head = `packages:\n\n${entry('kept@1.0.0', 'sha512-a')}\n${entry("'@scope/swapped@2.0.0'", 'sha512-evil')}\n${entry('new@3.0.0', 'sha512-c')}`;
    expect(changedPackages(base, head)).toEqual([
      ['@scope/swapped', '2.0.0', 'sha512-evil'],
      ['new', '3.0.0', 'sha512-c'],
    ]);
    expect(changedPackages(head, head)).toEqual([]);
  });

  it('reads the registry’s hash as pnpm writes it, old SHA-1 ones too (audit 3 H-1)', () => {
    const packument = {
      versions: {
        '1.0.0': { dist: { integrity: 'sha512-new', shasum: 'aa'.repeat(20) } },
        '0.1.0': { dist: { shasum: '00112233445566778899aabbccddeeff00112233' } },
      },
    };
    expect(registryIntegrity(packument, '1.0.0')).toBe('sha512-new');
    expect(registryIntegrity(packument, '0.1.0')).toBe('sha1-ABEiM0RVZneImaq7zN3u/wARIjM=');
    expect(registryIntegrity(packument, '9.9.9')).toBeUndefined();
  });

  it('finds no changed hashes in this repository’s own lockfile against itself', async () => {
    const { readFileSync } = await import('node:fs');
    const current = readFileSync('pnpm-lock.yaml', 'utf8');
    expect(changedPackages(current, current)).toEqual([]);
    expect(changedPackages('packages:\n', current).length).toBe(lockedPackages(current).size);
  });

  it('notices a changed registry, proxy, certificate or fetch setting (audit 5 H-1)', () => {
    const base =
      'packages:\n  - apps/*\ncatalog:\n  astro: ^7.4.0\nminimumReleaseAge: 10080\nfetchRetries: 2\n';
    expect(changedSourceSettings(base, base)).toEqual([]);
    // What doesn't say where packages come from can change.
    expect(changedSourceSettings(base, base.replace('10080', '20160'))).toEqual([]);
    for (const [line, setting] of [
      ['registry: https://registry.example/', 'registry'],
      ["'@types:registry': https://registry.example/", '@types:registry'],
      ["'//registry.example/:_authToken': secret", '//registry.example/:_authToken'],
      ['strictSsl: false', 'strictSsl'],
      ['strict-ssl: false', 'strict-ssl'],
      ['httpsProxy: http://proxy.example:8080', 'httpsProxy'],
      ['cafile: ./ca.pem', 'cafile'],
      ['fetchTimeout: 1', 'fetchTimeout'],
    ]) {
      expect(changedSourceSettings(base, `${base}${line}\n`), line).toEqual([setting]);
      expect(saysWhereFrom(setting ?? ''), setting).toBe(true);
    }
    // Changed and removed count too.
    expect(changedSourceSettings(base, base.replace('fetchRetries: 2', 'fetchRetries: 9'))).toEqual(
      ['fetchRetries'],
    );
    expect(changedSourceSettings(base, base.replace('fetchRetries: 2\n', ''))).toEqual([
      'fetchRetries',
    ]);
    for (const setting of ['catalog', 'packages', 'overrides', 'minimumReleaseAge', 'catalogs']) {
      expect(saysWhereFrom(setting), setting).toBe(false);
    }
  });

  it('finds .npmrc files in any folder (audit 5 H-1)', () => {
    expect(
      npmrcFiles(['.npmrc', 'apps/tally/.npmrc', 'docs/npmrc.md', 'x/.npmrc.bak', '']),
    ).toEqual(['.npmrc', 'apps/tally/.npmrc']);
  });
});
