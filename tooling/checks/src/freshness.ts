/**
 * What Dependabot does not update (`.github/dependabot.yml`): pnpm, which `packageManager` pins
 * in `package.json`, and Node.js, whose major version `.node-version` gives. A scheduled job of
 * CI checks them every week (`.github/workflows/freshness.yml`) and fails when one falls behind,
 * so that GitHub tells the maintainer.
 */

/** A version as `major.minor.patch`, or undefined for anything else, such as a prerelease. */
export function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** The version of pnpm that `packageManager` pins, as in `pnpm@11.28.3+sha512.…`. */
export function pinnedPnpm(packageManager: string): string | undefined {
  const match = /^pnpm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]+$/.exec(packageManager);
  return match?.[1];
}

/**
 * The newest release of pnpm in the same major version as `current`, if it is newer and has
 * been out for `minimumAgeMinutes` at `now`, the age that pnpm asks of every package here
 * (`minimumReleaseAge`). `published` is the npm registry's `time`: each version's date, and
 * `created` and `modified`, which are no versions.
 */
export function newerPnpm(
  current: string,
  published: Readonly<Record<string, string>>,
  now: Date,
  minimumAgeMinutes: number,
): string | undefined {
  const pinned = parseVersion(current);
  if (pinned === undefined) {
    throw new Error(`"${current}" is not a version of pnpm.`);
  }
  const latest = now.getTime() - minimumAgeMinutes * 60_000;
  let newest: readonly [number, number, number] = pinned;
  let found: string | undefined;
  for (const [version, date] of Object.entries(published)) {
    const parsed = parseVersion(version);
    if (
      parsed !== undefined &&
      parsed[0] === pinned[0] &&
      compare(parsed, newest) > 0 &&
      Date.parse(date) <= latest
    ) {
      newest = parsed;
      found = version;
    }
  }
  return found;
}

/** The major version of Node.js that `.node-version` gives, as `24` or `24.10.0`. */
export function nodeMajor(nodeVersion: string): number | undefined {
  const match = /^v?(\d+)(?:\.\d+\.\d+)?$/.exec(nodeVersion.trim());
  return match === null ? undefined : Number(match[1]);
}

/**
 * When the major version `major` of Node.js reaches its end of life, by its release schedule,
 * if that is within `days` days of `now`, or already past.
 */
export function nodeEndsSoon(
  major: number,
  schedule: Readonly<Record<string, { readonly end: string }>>,
  now: Date,
  days: number,
): string | undefined {
  const release = schedule[`v${String(major)}`];
  if (release === undefined) {
    throw new Error(`The release schedule of Node.js has no version ${String(major)}.`);
  }
  return Date.parse(release.end) - now.getTime() <= days * 86_400_000 ? release.end : undefined;
}
