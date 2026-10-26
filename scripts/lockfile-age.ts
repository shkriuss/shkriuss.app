/**
 * Fails when pnpm-lock.yaml adds a package version published less than
 * minimumReleaseAge ago, a package that doesn't come from the npm registry,
 * or a hash for a registry version that isn't the registry's own (see
 * scripts/lib/lockfile-age.ts). Run by CI on pull requests, with the base
 * branch fetched:
 *
 *   node scripts/lockfile-age.ts origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  addedPackages,
  changedPackages,
  registryIntegrity,
  releaseAgeRules,
  tooNew,
  unregisteredPackages,
} from './lib/lockfile-age.ts';

const base = process.argv[2] ?? 'origin/main';
const lockfileAt = (ref: string) =>
  execFileSync('git', ['show', `${ref}:pnpm-lock.yaml`], { encoding: 'utf8', maxBuffer: 1 << 28 });
const before = lockfileAt(base);
const now = readFileSync('pnpm-lock.yaml', 'utf8');
const added = addedPackages(before, now);
const changed = changedPackages(before, now);
const rules = releaseAgeRules(readFileSync('pnpm-workspace.yaml', 'utf8'));

const elsewhere = unregisteredPackages(now).filter(
  (key) => !unregisteredPackages(before).includes(key),
);
if (elsewhere.length > 0) {
  console.log(
    `::error title=Not from npm::These come from a web address or a git repository, or say where to download from, which this check can't see the age of: ${elsewhere.join(', ')}. Use a version from the npm registry.`,
  );
  process.exit(1);
}

const published = new Map<string, number | undefined>();
const wrongHash: string[] = [];
for (const name of new Set([...added, ...changed].map(([name]) => name))) {
  const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2F')}`);
  if (!response.ok) throw new Error(`The npm registry answered ${response.status} for ${name}.`);
  const packument = (await response.json()) as Parameters<typeof registryIntegrity>[0] & {
    time?: Record<string, string>;
  };
  const time = packument.time ?? {};
  for (const [entry, version] of added) {
    if (entry !== name) continue;
    const at = time[version];
    published.set(`${name}@${version}`, at ? Date.parse(at) : undefined);
  }
  // A new or changed hash must be the registry's own (audit 3 H-1).
  for (const [entry, version, integrity] of changed) {
    if (entry === name && registryIntegrity(packument, version) !== integrity) {
      wrongHash.push(`${name}@${version}`);
    }
  }
}

console.log(`${changed.length} package version(s) added or changed in the lockfile.`);
if (wrongHash.length > 0) {
  console.log(
    `::error title=Not the registry's file::The lockfile's hash for these isn't the one the npm registry has, so they'd be downloaded from somewhere else: ${wrongHash.join(', ')}. Let pnpm write the lockfile (pnpm install).`,
  );
  process.exit(1);
}

const young = tooNew(added, published, rules, Date.now());
console.log(`${added.length} package version(s) added to the lockfile; ${young.length} too new.`);
if (young.length > 0) {
  const days = Math.round(rules.minutes / 1440);
  console.log(
    `::error title=Too new::These were published less than ${days} days ago: ${young.join(', ')}. Wait, or for an urgent security fix list the package under minimumReleaseAgeExclude in pnpm-workspace.yaml.`,
  );
  process.exit(1);
}
