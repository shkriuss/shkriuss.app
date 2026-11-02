import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  changedPackages,
  changedWorkspaceSettings,
  isManifest,
  lockedPackages,
  registryIntegrity,
  releaseAgeRules,
  tooNew,
  toolFiles,
  unknownManifestFields,
  unknownWorkspaceSettings,
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

  fine@1.0.0:
    resolution: {integrity: sha512-x}
`;
    expect(unregisteredPackages(head)).toEqual([
      'nothing@1.0.0',
      'words@1.0.0',
      'list@1.0.0',
      'notahash@1.0.0',
      'number@1.0.0',
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

  it('refuses YAML that pnpm reads differently: "<<" merge keys, keys written as lists (audit 6 H-2)', () => {
    // pnpm 10.34.7 installed is-odd from a lockfile written each of these
    // ways. The yaml package saw no "packages:" in the first three, and
    // is-odd without its resolution in the fourth.
    const integrity =
      'sha512-CQpnWPrDwmP1+SMHXZhtLtJv90yiyVfluGsX5iNCVkrhQtU3TQHsUWPG9wkdk9Lgd5yNpAg9jQEo90CBaXgWMA==';
    const entry = `is-odd@3.0.1:\n      resolution: {integrity: ${integrity}}\n`;
    const base = "lockfileVersion: '9.0'\n\npackages:\n\nsnapshots:\n";
    const hiding = {
      anchored: `lockfileVersion: '9.0'\nhidden: &hidden\n  packages:\n    ${entry}<<: *hidden\n`,
      inline: `lockfileVersion: '9.0'\n<<:\n  packages:\n    ${entry}`,
      keyAsList: `lockfileVersion: '9.0'\n? [packages]\n:\n    ${entry}`,
      inEntry: `packages:\n  is-odd@3.0.1:\n    <<: {resolution: {integrity: ${integrity}}}\n`,
      yaml11: `%YAML 1.1\n---\n<<: {packages: {is-odd@3.0.1: {resolution: {integrity: ${integrity}}}}}\n`,
    };
    // None of these is in a lockfile pnpm writes, so they're refused too.
    const unusual = {
      quotedMerge: `'<<': {packages: {}}\npackages: {}\n`,
      keyAsMapping: `? {packages: x}\n: {}\npackages: {}\n`,
      alias: `packages:\n  a@1.0.0: &a {resolution: {integrity: sha512-x}}\n  b@1.0.0: *a\n`,
      anchor: `packages: &p\n  a@1.0.0: {resolution: {integrity: sha512-x}}\n`,
      tag: `packages: !!map\n  a@1.0.0: {resolution: {integrity: sha512-x}}\n`,
      localTag: `packages:\n  a@1.0.0: {resolution: {integrity: !hash sha512-x}}\n`,
      tagDirective: `%TAG !e! tag:example.com,2000:\n---\npackages: {}\n`,
    };
    for (const [name, head] of Object.entries({ ...hiding, ...unusual })) {
      expect(() => addedPackages(base, head), name).toThrow(/pnpm never writes/);
      expect(() => changedPackages(base, head), name).toThrow(/pnpm never writes/);
      expect(() => unregisteredPackages(head), name).toThrow(/pnpm never writes/);
    }
    expect(() => addedPackages(base, hiding.inline)).toThrow(
      'pnpm-lock.yaml uses a "<<" merge key, which pnpm never writes',
    );
    // Strings that only look like those are fine.
    const lookalikes = `packages:\n  a@1.0.0:\n    resolution: {integrity: sha512-x}\n    note: '<< &a *a !tag %YAML'\n`;
    expect([...lockedPackages(lookalikes)]).toEqual(['a@1.0.0']);
  });

  it('refuses the same in pnpm-workspace.yaml, where a "<<" set a registry unseen (audit 6 H-2)', () => {
    const base = 'packages: []\n';
    const merged = 'packages: []\nx: &x\n  registry: https://example.invalid/\n<<: *x\n';
    expect(() => unknownWorkspaceSettings(base, merged)).toThrow(/pnpm never writes/);
    const inline = 'packages: []\n<<:\n  registry: https://example.invalid/\n';
    expect(() => unknownWorkspaceSettings(base, inline)).toThrow(
      /merge key, which pnpm never writes/,
    );
    expect(() => releaseAgeRules('x: &x\n  minimumReleaseAge: 0\n<<: *x\n')).toThrow(
      /pnpm never writes/,
    );
    // This repository's own files are plain YAML.
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
    expect(releaseAgeRules(workspace).minutes).toBe(10080);
    expect(unknownWorkspaceSettings(workspace, workspace)).toEqual([]);
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

  it('refuses any pnpm-workspace.yaml setting this repository doesn’t use (audit 7 H-1 and H-3, run 32; H-1, run 44)', () => {
    // A list of the dangerous ones missed one in each audit; this is a list
    // of the safe ones instead.
    const base =
      'packages:\n  - apps/*\ncatalog:\n  astro: ^7.4.0\nminimumReleaseAge: 10080\nfetchRetries: 2\n';
    expect(unknownWorkspaceSettings(base, base)).toEqual([]);
    for (const [line, setting] of [
      // Where packages come from, or how (audit 5 H-1).
      ['registry: https://registry.example/', 'registry'],
      ["'@types:registry': https://registry.example/", '@types:registry'],
      ["'//registry.example/:_authToken': secret", '//registry.example/:_authToken'],
      ['strictSsl: false', 'strictSsl'],
      ['strict-ssl: false', 'strict-ssl'],
      ['httpsProxy: http://proxy.example:8080', 'httpsProxy'],
      ['cafile: ./ca.pem', 'cafile'],
      ['fetchTimeout: 1', 'fetchTimeout'],
      // Code pnpm runs itself (audit 6 H-3). pnpm 10.34.7 installed a
      // 4-day-old config dependency, whatever minimumReleaseAge said.
      ['configDependencies:\n  pnpm-plugin-x: "1.0.0+sha512-AAAA"', 'configDependencies'],
      ["config-dependencies:\n  '@pnpm/plugin-x': 1.0.0+sha512-AAAA", 'config-dependencies'],
      ['pnpmfile: tools/hooks.cjs', 'pnpmfile'],
      ['globalPnpmfile: /tmp/hooks.cjs', 'globalPnpmfile'],
      // Only main's runs (on the branch "main") read pnpm-lock.main.yaml, so
      // the deploy installed from a lockfile no check had read (audit 7 H-1,
      // run 32).
      ['gitBranchLockfile: true', 'gitBranchLockfile'],
      ['mergeGitBranchLockfiles: true', 'mergeGitBranchLockfiles'],
      ['lockfileDir: apps/photos', 'lockfileDir'],
      ['sharedWorkspaceLockfile: false', 'sharedWorkspaceLockfile'],
      // Code with every script, and every install script allowed (audit 7
      // H-3, run 32).
      ['nodeOptions: "--import=data:text/javascript,1"', 'nodeOptions'],
      ['scriptShell: ./tools/shell.sh', 'scriptShell'],
      ['dangerouslyAllowAllBuilds: true', 'dangerouslyAllowAllBuilds'],
      ['onlyBuiltDependenciesFile: tools/allowed.json', 'onlyBuiltDependenciesFile'],
      // A Node.js in no lockfile (audit 7 H-1, run 44).
      ['useNodeVersion: 22.3.0', 'useNodeVersion'],
      ['nodeDownloadMirrors:\n  release: http://mirror.example/', 'nodeDownloadMirrors'],
      ['executionEnv:\n  nodeVersion: 22.3.0', 'executionEnv'],
      // Others nothing here uses: a patch applied at install, a name pnpm
      // fills in from an environment variable, named catalogs.
      ['patchedDependencies:\n  astro: patches/astro.patch', 'patchedDependencies'],
      ["'${HOME}': x", '${HOME}'],
      ['catalogs:\n  next:\n    astro: ^8.0.0', 'catalogs'],
    ]) {
      expect(unknownWorkspaceSettings(base, `${base}${line}\n`), line).toEqual([setting]);
    }
    // Changed and removed count too.
    expect(
      unknownWorkspaceSettings(base, base.replace('fetchRetries: 2', 'fetchRetries: 9')),
    ).toEqual(['fetchRetries']);
    expect(unknownWorkspaceSettings(base, base.replace('fetchRetries: 2\n', ''))).toEqual([
      'fetchRetries',
    ]);
    // What the check understands can change: versions go into the lockfile,
    // and the release age rules are read from main.
    const changed = `${base.replace('10080', '20160').replace('^7.4.0', '^7.5.0')}overrides:\n  a: 1.0.0\nonlyBuiltDependencies:\n  - esbuild\nignoredBuiltDependencies:\n  - protobufjs\nauditConfig:\n  ignoreGhsas: [GHSA-xxxx-xxxx-xxxx]\nstrictDepBuilds: false\nminimumReleaseAgeExclude:\n  - astro\n`;
    expect(unknownWorkspaceSettings(base, changed)).toEqual([]);
    // Every setting this repository has is on the list.
    const own = readFileSync('pnpm-workspace.yaml', 'utf8');
    expect(unknownWorkspaceSettings('', own)).toEqual([]);
  });

  it('names a change to which packages may run install scripts (audit 7 H-3, run 32)', () => {
    const base = 'onlyBuiltDependencies:\n  - esbuild\nstrictDepBuilds: true\n';
    const more = 'onlyBuiltDependencies:\n  - esbuild\n  - sharp\nstrictDepBuilds: true\n';
    expect(changedWorkspaceSettings(base, more, ['onlyBuiltDependencies'])).toEqual([
      'onlyBuiltDependencies',
    ]);
    expect(changedWorkspaceSettings(base, base, ['onlyBuiltDependencies'])).toEqual([]);
    expect(
      changedWorkspaceSettings(base, base.replace('true', 'false'), ['onlyBuiltDependencies']),
    ).toEqual([]);
  });

  it('refuses any package.json field this repository doesn’t use, in any folder (audit 6 H-3; audit 7 H-1, run 44, and H-6, run 32)', () => {
    const manifest = '{"name": "x", "private": true, "scripts": {"build": "astro build"}}';
    expect(unknownManifestFields(manifest, manifest)).toEqual([]);
    for (const [json, field] of [
      // A config dependency, which pnpm reads from the root package.json too
      // (audit 6 H-3).
      ['"pnpm": {"configDependencies": {"pnpm-plugin-x": "1.0.0+sha512-AAAA"}}', 'pnpm'],
      // Another Node.js for this package's scripts, read in any package.json
      // (audit 7 H-1, run 44).
      ['"pnpm": {"executionEnv": {"nodeVersion": "22.3.0"}}', 'pnpm'],
      // The pnpm CI installs, read before packageManager, a range too
      // (audit 7 H-6, run 32).
      ['"devEngines": {"packageManager": {"name": "pnpm", "version": "^10"}}', 'devEngines'],
      ['"resolutions": {"wrangler": "4.0.0"}', 'resolutions'],
      ['"bin": {"wrangler": "./not-wrangler.js"}', 'bin'],
      ['"dependenciesMeta": {"x": {"injected": true}}', 'dependenciesMeta'],
    ] as const) {
      const head = manifest.replace('{', `{${json}, `);
      expect(unknownManifestFields(manifest, head), json).toEqual([field]);
      // In a new package.json too, and removed.
      expect(unknownManifestFields(undefined, head), json).toEqual([field]);
      expect(unknownManifestFields(head, manifest), json).toEqual([field]);
    }
    // What the check understands can change.
    const changed =
      '{"name": "y", "version": "1.0.0", "description": "Y.", "private": true, "type": "module", "exports": {".": "./x.ts"}, "scripts": {}, "dependencies": {"a": "1.0.0"}, "devDependencies": {}, "peerDependencies": {}, "packageManager": "pnpm@10.34.7", "engines": {"node": ">=24"}}';
    expect(unknownManifestFields(manifest, changed)).toEqual([]);
    expect(() => unknownManifestFields(manifest, '[]')).toThrow(/isn't a JSON object/);
    expect(() => unknownManifestFields(manifest, '{"name": ')).toThrow();
    // This repository's own package.json files pass, as they are and as new files.
    for (const path of [
      'package.json',
      'apps/hub/package.json',
      'apps/photos/package.json',
      'packages/ui/package.json',
      'packages/astro-config/package.json',
      'templates/app/package.json',
    ]) {
      const own = readFileSync(path, 'utf8');
      expect(unknownManifestFields(own, own), path).toEqual([]);
      expect(unknownManifestFields(undefined, own), path).toEqual([]);
    }
    expect(
      ['package.json', 'apps/x/package.json', 'apps/x/package.json5', 'x/my-package.json'].filter(
        isManifest,
      ),
    ).toEqual(['package.json', 'apps/x/package.json']);
  });

  it('refuses files pnpm or wrangler read by their name, in any folder (audit 5 H-1, audit 6 H-3, audit 7 H-1 and H-2, run 32)', () => {
    const refused = [
      // Where packages come from (audit 5 H-1).
      '.npmrc',
      'apps/tally/.npmrc',
      // pnpm's hooks (audit 6 H-3).
      '.pnpmfile.cjs',
      'apps/tally/.pnpmfile.cjs',
      '.pnpmfile.mjs',
      'tools/pnpmfile.cjs',
      // A lockfile for the branch, which pnpm reads on main (audit 7 H-1, run 32).
      'pnpm-lock.main.yaml',
      'apps/photos/pnpm-lock.yaml',
      // Settings pnpm takes when it runs in that folder (audit 7 H-2, run 32).
      'apps/photos/pnpm-workspace.yaml',
      'pnpm-workspace.yml',
      // Read as a package.json.
      'apps/photos/package.yaml',
      'apps/photos/package.json5',
      // Written by pnpm.
      'node_modules/.modules.yaml',
      'apps/photos/node_modules/.bin/wrangler',
      // Loaded into wrangler's environment, or read before wrangler.jsonc.
      'apps/photos/.env',
      '.env.local',
      'apps/photos/.dev.vars',
      '.dev.vars.production',
      'wrangler.json',
      'apps/photos/wrangler.toml',
      'apps/photos/.wrangler/deploy/config.json',
    ];
    const allowed = [
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'package.json',
      'apps/photos/package.json',
      'apps/photos/wrangler.jsonc',
      'docs/npmrc.md',
      'x/.npmrc.bak',
      'docs/about-pnpm.md',
      'apps/photos/src/environment.ts',
      'apps/photos/.envoy',
      '',
    ];
    expect(toolFiles([...refused, ...allowed])).toEqual(refused);
    // Nothing in this repository is one of those.
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
    expect(toolFiles(tracked)).toEqual([]);
  });

  it('reads YAML with the yaml package beside it, never the working directory’s (audit 6 H-1)', () => {
    // CI runs these checks in a pull request's checkout, whose node_modules
    // its own lockfile decides. A "yaml" there that read every lockfile as
    // main's made the check pass whatever the pull request added.
    const checkout = mkdtempSync(join(tmpdir(), 'lockfile-age-'));
    try {
      mkdirSync(join(checkout, 'node_modules/yaml'), { recursive: true });
      writeFileSync(join(checkout, 'package.json'), '{"type": "module"}\n');
      writeFileSync(
        join(checkout, 'node_modules/yaml/package.json'),
        '{"name": "yaml", "version": "2.9.1", "main": "index.cjs"}\n',
      );
      writeFileSync(
        join(checkout, 'node_modules/yaml/index.cjs'),
        "throw new Error('the yaml package in the working directory was used');\n",
      );
      const lib = pathToFileURL(join(import.meta.dirname, 'lockfile-age.ts')).href;
      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `const { lockedPackages } = await import(${JSON.stringify(lib)});
           console.log([...lockedPackages('packages:\\n  is-number@7.0.0: {}\\n')].join());`,
        ],
        { cwd: checkout, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
      );
      expect(output.trim()).toBe('is-number@7.0.0');
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });
});
