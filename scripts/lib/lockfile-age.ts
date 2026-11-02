/**
 * pnpm's minimumReleaseAge (pnpm-workspace.yaml) holds back versions
 * published less than 7 days ago, but only when pnpm picks versions. CI
 * installs exactly what pnpm-lock.yaml lists, so a pull request that writes a
 * brand-new version into the lockfile would slip past it (audit finding H-3).
 * These helpers find the versions a lockfile adds and which are too new.
 *
 * The lockfile is read as YAML, as pnpm reads it. Read line by line, these
 * checks saw only entries written the way pnpm writes them, so an entry
 * written on one line (`evil@1.0.0: {resolution: {…}}`), or with a comment
 * after its name, was installed without any check (audit 5 H-1). YAML that
 * pnpm reads differently from the yaml package is refused (audit 6 H-2).
 */
// Found from this file's folder, never from the working directory: CI runs
// main's copy of these scripts in a folder of its own, with main's packages
// installed beside it, against a pull request's checkout (audit 5 H-3). Found
// from the working directory, the YAML reader was the one the pull request's
// own lockfile installed, so it could make its lockfile read as anything
// (audit 6 H-1).
import { type Document, isScalar, parseDocument, visit } from 'yaml';

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a YAML file uses that pnpm never writes, and that pnpm (which reads
 * YAML with js-yaml) reads differently from the yaml package: a "<<" merge
 * key, which pnpm applies and this reader doesn't, or a key written as a
 * list or a mapping (`? [packages]`), which pnpm reads as "packages" and
 * this one as "[ packages ]". Either hid every package from these checks
 * while pnpm still installed them (audit 6 H-2). Anchors, aliases, tags and
 * `%` directives are refused too: pnpm writes none of them, and they're
 * where YAML readers differ. Undefined for plain YAML.
 */
function notPlainYaml(document: Document.Parsed): string | undefined {
  const { yaml, tags } = document.directives;
  if (
    yaml.explicit ||
    Object.entries(tags).some(
      ([handle, prefix]) => handle !== '!!' || prefix !== 'tag:yaml.org,2002:',
    )
  ) {
    return 'a % directive';
  }
  let found: string | undefined;
  visit(document, {
    Alias() {
      found = 'an alias (*name)';
      return visit.BREAK;
    },
    Pair(_, pair) {
      const key = pair.key;
      if (!isScalar(key)) found = 'a key written as a list or a mapping';
      // In YAML 1.1 the yaml package reads a merge key as a symbol.
      else if (key.value === '<<' || key.source === '<<' || typeof key.value === 'symbol') {
        found = 'a "<<" merge key';
      }
      return found ? visit.BREAK : undefined;
    },
    Node(_, node) {
      if (node.anchor) found = 'an anchor (&name)';
      else if (node.tag) found = 'a tag (!name)';
      return found ? visit.BREAK : undefined;
    },
  });
  return found;
}

/**
 * A YAML file read as a mapping (an empty file is an empty one). YAML the
 * parser refuses, like a key written twice, is an error here too: pnpm
 * would refuse the file as well. So is YAML that pnpm would read
 * differently (see notPlainYaml).
 */
function mappingOf(text: string, what: string): Mapping {
  const parsed = parseDocument(text);
  const [error] = parsed.errors;
  if (error) throw error;
  const unusual = notPlainYaml(parsed);
  if (unusual) {
    throw new Error(
      `${what} uses ${unusual}, which pnpm never writes and reads differently from this check (audit 6 H-2)`,
    );
  }
  const document: unknown = parsed.toJS();
  if (document === null || document === undefined) return {};
  if (!isMapping(document)) throw new Error(`${what} isn't a YAML mapping`);
  return document;
}

/** Each package of a pnpm-lock.yaml's "packages:" section, with what it says. */
function packageEntries(lockfile: string): Map<string, unknown> {
  const packages = mappingOf(lockfile, 'pnpm-lock.yaml')['packages'] ?? {};
  if (!isMapping(packages)) throw new Error('"packages:" in pnpm-lock.yaml isn\'t a mapping');
  return new Map(Object.entries(packages));
}

/** "name@version" for every package in a pnpm-lock.yaml (its "packages:" section). */
export function lockedPackages(lockfile: string): Set<string> {
  return new Set(packageEntries(lockfile).keys());
}

/** "name@1.2.3" (or "@scope/name@1.2.3-beta.1"), as the registry's versions are. */
const isRegistryKey = (key: string) => /^(?:@[^@/\s]+\/)?[^@/\s]+@\d[^/:\s]*$/.test(key);

/** A hash as pnpm writes it: "sha512-" and base64 (SHA-1 for very old packages). */
const isIntegrity = (value: unknown): value is string =>
  typeof value === 'string' && /^sha(?:1|256|512)-[A-Za-z0-9+/]+=*$/.test(value);

/**
 * The integrity hash of an entry whose resolution names one and nothing
 * else, which is all pnpm writes for a version from the npm registry; null
 * for anything else: a `tarball:` address beside the hash (pnpm downloads
 * from that address), a git commit, a hash that isn't one, or no resolution.
 */
function integrityOnly(entry: unknown): string | null {
  if (!isMapping(entry)) return null;
  const resolution = entry['resolution'];
  if (!isMapping(resolution) || Object.keys(resolution).length !== 1) return null;
  const integrity = resolution['integrity'];
  return isIntegrity(integrity) ? integrity : null;
}

/**
 * Packages a pnpm-lock.yaml takes from somewhere other than the npm registry,
 * such as a web address or a git repository: their key isn't
 * "name@version", or their resolution is anything but an integrity hash
 * (a `tarball:` address beside the hash counts too: audit 3 H-1). The age
 * check can't tell when those were published, so they'd slip past it
 * (audit H-1).
 */
export function unregisteredPackages(lockfile: string): string[] {
  return [...packageEntries(lockfile)]
    .filter(([key, entry]) => !isRegistryKey(key) || integrityOnly(entry) === null)
    .map(([key]) => key);
}

/**
 * The registry packages that `head` adds or whose hash it changes, as
 * [name, version, integrity]. pnpm checks a download against the lockfile's
 * hash, so a pull request that changes the hash (with a registry of its own
 * in `.npmrc`, say) could swap a package's code without a new version: each
 * of these is checked against the npm registry's own hash (audit 3 H-1).
 */
export function changedPackages(base: string, head: string): [string, string, string][] {
  const before = packageEntries(base);
  const changed: [string, string, string][] = [];
  for (const [key, entry] of packageEntries(head)) {
    const integrity = integrityOnly(entry);
    if (!isRegistryKey(key) || integrity === null) continue;
    if (before.has(key) && integrityOnly(before.get(key)) === integrity) continue;
    const at = key.lastIndexOf('@');
    changed.push([key.slice(0, at), key.slice(at + 1), integrity]);
  }
  return changed;
}

/**
 * The integrity hash the npm registry gives a version: its `dist.integrity`,
 * or for packages older than that, its SHA-1 `shasum` written the same way
 * ("sha1-" and base64), as pnpm writes it. Undefined if there's no such version.
 */
export function registryIntegrity(
  packument: { versions?: Record<string, { dist?: { integrity?: string; shasum?: string } }> },
  version: string,
): string | undefined {
  const dist = packument.versions?.[version]?.dist;
  if (dist?.integrity) return dist.integrity;
  if (dist?.shasum && /^[0-9a-f]{40}$/i.test(dist.shasum)) {
    return `sha1-${Buffer.from(dist.shasum, 'hex').toString('base64')}`;
  }
  return undefined;
}

/** The versions `head` has that `base` doesn't, as [name, version]. */
export function addedPackages(base: string, head: string): [string, string][] {
  const before = lockedPackages(base);
  return [...lockedPackages(head)]
    .filter((key) => !before.has(key))
    .map((key) => {
      const at = key.lastIndexOf('@');
      return [key.slice(0, at), key.slice(at + 1)];
    });
}

/** minimumReleaseAge (minutes) and minimumReleaseAgeExclude from pnpm-workspace.yaml. */
export function releaseAgeRules(workspace: string): { minutes: number; exclude: string[] } {
  const settings = mappingOf(workspace, 'pnpm-workspace.yaml');
  const minutes = Number(settings['minimumReleaseAge'] ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('minimumReleaseAge in pnpm-workspace.yaml must be a number of minutes');
  }
  const list = settings['minimumReleaseAgeExclude'];
  const exclude = Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { minutes, exclude };
}

/** A name matches an exclude entry exactly, or by a trailing "*" ("@types/*"). */
const excluded = (name: string, exclude: readonly string[]) =>
  exclude.some((entry) =>
    entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : entry === name,
  );

/**
 * The added versions published less than `minutes` ago (or with no known
 * publish time), as "name@version", leaving out excluded packages.
 */
export function tooNew(
  added: readonly [string, string][],
  published: ReadonlyMap<string, number | undefined>,
  rules: { minutes: number; exclude: readonly string[] },
  now: number,
): string[] {
  return added
    .filter(([name]) => !excluded(name, rules.exclude))
    .filter(([name, version]) => {
      const time = published.get(`${name}@${version}`);
      return time === undefined || now - time < rules.minutes * 60_000;
    })
    .map(([name, version]) => `${name}@${version}`);
}

/**
 * The settings of pnpm-workspace.yaml that this repository uses, and that
 * these checks understand: every other one is refused when a pull request
 * adds, changes or removes it. pnpm takes every key of that file as a
 * setting, and it has dozens: refusing a list of the dangerous ones missed
 * one in each audit (where packages come from: audit 5 H-1; config
 * dependencies and pnpmfiles: audit 6 H-3; a lockfile for the branch,
 * gitBranchLockfile, which only main's runs read, so the deploy installed
 * from a file no check had read: audit 7 H-1, run 32; nodeOptions, code run
 * with every script, and dangerouslyAllowAllBuilds: audit 7 H-3, run 32;
 * useNodeVersion and nodeDownloadMirrors, a Node.js in no lockfile: audit 7
 * H-1, run 44). So the list is of what's safe instead. Adding one is a pull
 * request of its own that changes this list first, as main's copy of the
 * check is the one that runs.
 */
export const WORKSPACE_SETTINGS: readonly string[] = [
  // Which folders are packages.
  'packages',
  // Versions: pnpm writes what they pick into the lockfile, checked above.
  'catalog',
  'overrides',
  // The 7-day wait, which the check reads from main (releaseAgeRules).
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
  // Which packages may run install scripts (a change gets a warning).
  'onlyBuiltDependencies',
  'ignoredBuiltDependencies',
  'strictDepBuilds',
  // Advisories pnpm audit ignores for now (docs/quality.md).
  'auditConfig',
];

/**
 * The fields of a package.json that this repository uses, and that these
 * checks understand: dependencies, which are in the lockfile, and the rest,
 * which pnpm only reads as the package's name, scripts and code. pnpm reads
 * more as settings, in any package.json: "pnpm" (configDependencies, audit
 * 6 H-3, or executionEnv, which made pnpm download and run another Node.js
 * for that package's scripts: audit 7 H-1, run 44), "resolutions",
 * "devEngines" (which pnpm/action-setup reads first, to choose the pnpm CI
 * installs: audit 7 H-6, run 32) or "bin" (a command in other packages'
 * node_modules/.bin). So a change to any field not listed here is refused,
 * as in pnpm-workspace.yaml.
 */
export const MANIFEST_FIELDS: readonly string[] = [
  'name',
  'version',
  'description',
  'private',
  'type',
  'exports',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  // The root's: which pnpm and Node.js CI installs. Read like code
  // (docs/quality.md); a runtime under "engines" is written into the
  // lockfile ("node@runtime:…"), which unregisteredPackages refuses.
  'packageManager',
  'engines',
];

/** The settings `head` adds, changes or removes among those `guarded` picks. */
function changedSettings(
  base: Mapping,
  head: Mapping,
  guarded: (setting: string) => boolean,
): string[] {
  const settingsOf = (settings: Mapping) =>
    new Map(
      Object.entries(settings)
        .filter(([key]) => guarded(key))
        .map(([key, value]) => [key, JSON.stringify(value)]),
    );
  const before = settingsOf(base);
  const after = settingsOf(head);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .sort();
}

/**
 * The settings of pnpm-workspace.yaml outside WORKSPACE_SETTINGS that `head`
 * adds, changes or removes, written as they are (so "strict-ssl" and
 * "strictSsl" alike).
 */
export function unknownWorkspaceSettings(base: string, head: string): string[] {
  return changedSettings(
    mappingOf(base, 'pnpm-workspace.yaml'),
    mappingOf(head, 'pnpm-workspace.yaml'),
    (setting) => !WORKSPACE_SETTINGS.includes(setting),
  );
}

/** Which of these settings of pnpm-workspace.yaml `head` adds, changes or removes. */
export function changedWorkspaceSettings(
  base: string,
  head: string,
  settings: readonly string[],
): string[] {
  return changedSettings(
    mappingOf(base, 'pnpm-workspace.yaml'),
    mappingOf(head, 'pnpm-workspace.yaml'),
    (setting) => settings.includes(setting),
  );
}

/** A package.json read as JSON (undefined, a file that isn't there, as an empty one). */
function manifestOf(packageJson: string | undefined): Mapping {
  if (packageJson === undefined) return {};
  const manifest: unknown = JSON.parse(packageJson);
  if (!isMapping(manifest)) throw new Error("package.json isn't a JSON object");
  return manifest;
}

/**
 * The fields of a package.json outside MANIFEST_FIELDS that `head` adds,
 * changes or removes; `base` is undefined for a new file.
 */
export function unknownManifestFields(base: string | undefined, head: string): string[] {
  return changedSettings(
    manifestOf(base),
    manifestOf(head),
    (field) => !MANIFEST_FIELDS.includes(field),
  );
}

/** The files at the top of the repository that these checks read themselves. */
const CHECKED_FILES = ['pnpm-workspace.yaml', 'pnpm-lock.yaml'];

/**
 * The files among these paths that pnpm or wrangler read by their name,
 * other than the ones these checks read (CHECKED_FILES, and every
 * package.json, through unknownManifestFields). Nothing here uses them, and
 * each could change what the deploy job runs, with the Cloudflare token:
 * - an .npmrc, in any folder: where packages come from (audit 5 H-1);
 * - any file whose name starts with "pnpm" or ".pnpm": a pnpmfile, code pnpm
 *   runs with every command (audit 6 H-3); a pnpm-workspace.yaml in an
 *   app's folder, whose settings pnpm takes when it runs there, as the
 *   deploy does (audit 7 H-2, run 32); another lockfile, like
 *   pnpm-lock.main.yaml (audit 7 H-1, run 32);
 * - package.json5 and package.yaml, which pnpm reads as a package.json;
 * - anything in node_modules, which pnpm writes itself;
 * - wrangler's own: .env and .dev.vars files, which wrangler loads into its
 *   environment (an address for Cloudflare's API, say, which would get the
 *   token), wrangler.json and wrangler.toml, which it reads before the
 *   sites' wrangler.jsonc, in that folder or any folder above, and the
 *   .wrangler folder (found while fixing audit 7 H-2, run 32).
 */
export function toolFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    if (CHECKED_FILES.includes(path)) return false;
    const folders = path.split('/');
    const name = folders.pop() ?? '';
    return (
      folders.some((folder) => folder === 'node_modules' || folder === '.wrangler') ||
      name === '.npmrc' ||
      /^\.?pnpm/.test(name) ||
      name === 'package.json5' ||
      name === 'package.yaml' ||
      /^\.(?:env|dev\.vars)(?:\.|$)/.test(name) ||
      name === 'wrangler.json' ||
      name === 'wrangler.toml'
    );
  });
}

/** Whether a path is a package.json, in any folder. */
export const isManifest = (path: string): boolean =>
  path === 'package.json' || path.endsWith('/package.json');
