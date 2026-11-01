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
 * Whether a pnpm setting says where packages come from, or how they're
 * fetched: the registry (for a scope too, "@types:registry"), a line about
 * a registry's address ("//registry…"), proxies, certificates and the
 * fetch… settings. These aren't expected to change (audit 5 H-1).
 */
export function saysWhereFrom(setting: string): boolean {
  const name = setting.toLowerCase().replaceAll('-', '');
  return (
    name.includes('registry') ||
    name.startsWith('fetch') ||
    name.startsWith('//') ||
    ['proxy', 'httpsproxy', 'noproxy', 'strictssl', 'ca', 'cafile', 'cert', 'key'].includes(name)
  );
}

/**
 * The settings in pnpm-workspace.yaml that `head` adds, changes or removes
 * among those that say where packages come from (audit 5 H-1).
 */
export function changedSourceSettings(base: string, head: string): string[] {
  const settingsOf = (text: string) =>
    new Map(
      Object.entries(mappingOf(text, 'pnpm-workspace.yaml'))
        .filter(([key]) => saysWhereFrom(key))
        .map(([key, value]) => [key, JSON.stringify(value)]),
    );
  const before = settingsOf(base);
  const after = settingsOf(head);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .sort();
}

/**
 * The .npmrc files among these paths, in any folder: pnpm reads each of
 * them, and one can name another registry (audit 5 H-1).
 */
export const npmrcFiles = (paths: readonly string[]): string[] =>
  paths.filter((path) => path === '.npmrc' || path.endsWith('/.npmrc'));
