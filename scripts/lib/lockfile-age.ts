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

/**
 * Packages a pnpm-lock.yaml takes from somewhere other than the npm registry,
 * such as a web address or a git repository: their key isn't
 * "name@version", or they have no integrity hash. The age check can't tell
 * when those were published, so they'd slip past it (audit H-1).
 */
export function unregisteredPackages(lockfile: string): string[] {
  const found: string[] = [];
  let inPackages = false;
  let key: string | null = null;
  let fromRegistry = false;
  const done = () => {
    if (key !== null && !fromRegistry) found.push(key);
    key = null;
  };
  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) {
      done();
      inPackages = line.trim() === 'packages:';
      continue;
    }
    if (!inPackages) continue;
    const entry = /^ {2}'?([^'\s].*?)'?:\s*$/.exec(line)?.[1];
    if (entry !== undefined) {
      done();
      key = entry;
      // "name@1.2.3" (or "@scope/name@1.2.3-beta.1"), as the registry's versions are.
      fromRegistry = /^(?:@[^@/\s]+\/)?[^@/\s]+@\d[^/:\s]*$/.test(entry);
    } else if (key !== null && /^ {4}resolution:/.test(line)) {
      fromRegistry &&= /^ {4}resolution: \{integrity: /.test(line);
    }
  }
  done();
  return found;
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
