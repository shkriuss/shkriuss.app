/**
 * pnpm's minimumReleaseAge (pnpm-workspace.yaml) holds back versions
 * published less than 7 days ago, but only when pnpm picks versions. CI
 * installs exactly what pnpm-lock.yaml lists, so a pull request that writes a
 * brand-new version into the lockfile would slip past it (audit finding H-3).
 * These helpers find the versions a lockfile adds and which are too new.
 */

/** "name@version" for every package in a pnpm-lock.yaml (its "packages:" section). */
export function lockedPackages(lockfile: string): Set<string> {
  const found = new Set<string>();
  let inPackages = false;
  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) inPackages = line.trim() === 'packages:';
    if (!inPackages) continue;
    // Two spaces, then the key: harper.js@2.10.0: or '@types/node@24.3.0':
    const key = /^ {2}'?((?:@[^@'\s/]+\/)?[^@'\s]+@[^'\s:]+)'?:\s*$/.exec(line)?.[1];
    if (key) found.add(key);
  }
  return found;
}

/** Each package of a pnpm-lock.yaml's "packages:" section, and what its "resolution:" says. */
function packageEntries(lockfile: string): Map<string, string | null> {
  const entries = new Map<string, string | null>();
  let inPackages = false;
  let key: string | null = null;
  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.trim() === 'packages:';
      key = null;
      continue;
    }
    if (!inPackages) continue;
    const entry = /^ {2}'?([^'\s].*?)'?:\s*$/.exec(line)?.[1];
    if (entry !== undefined) {
      key = entry;
      entries.set(key, null);
    } else if (key !== null) {
      const resolution = /^ {4}resolution:(.*)$/.exec(line)?.[1];
      // A second resolution, or one written on the lines below, reads as unknown.
      if (resolution !== undefined) {
        entries.set(key, entries.get(key) === null ? resolution.trim() : '');
      }
    }
  }
  return entries;
}

/** "name@1.2.3" (or "@scope/name@1.2.3-beta.1"), as the registry's versions are. */
const isRegistryKey = (key: string) => /^(?:@[^@/\s]+\/)?[^@/\s]+@\d[^/:\s]*$/.test(key);

/**
 * The integrity hash of a resolution that only names one, which is all pnpm
 * writes for a version from the npm registry; null for anything else, such
 * as a `tarball:` address beside the hash (pnpm downloads from that address).
 */
const integrityOnly = (resolution: string | null | undefined) =>
  /^\{integrity: ([^\s,{}]+)\}$/.exec(resolution ?? '')?.[1] ?? null;

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
    .filter(([key, resolution]) => !isRegistryKey(key) || integrityOnly(resolution) === null)
    .map(([key]) => key);
}

/**
 * The registry packages that `head` adds or whose resolution it changes, as
 * [name, version, integrity]. pnpm checks a download against the lockfile's
 * hash, so a pull request that changes the hash (with a registry of its own
 * in `.npmrc`, say) could swap a package's code without a new version: each
 * of these is checked against the npm registry's own hash (audit 3 H-1).
 */
export function changedPackages(base: string, head: string): [string, string, string][] {
  const before = packageEntries(base);
  const changed: [string, string, string][] = [];
  for (const [key, resolution] of packageEntries(head)) {
    const integrity = integrityOnly(resolution);
    if (!isRegistryKey(key) || integrity === null) continue;
    if (before.has(key) && before.get(key) === resolution) continue;
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
  const minutes = Number(/^minimumReleaseAge:\s*(\d+)/m.exec(workspace)?.[1] ?? '0');
  const list = /^minimumReleaseAgeExclude:\s*\n((?:\s+-\s*.+\n?)*)/m.exec(workspace)?.[1] ?? '';
  const exclude = [...list.matchAll(/-\s*['"]?([^'"\s]+)['"]?/g)].map((match) => match[1] ?? '');
  return { minutes, exclude: exclude.filter(Boolean) };
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
