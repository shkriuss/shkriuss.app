/**
 * Fails when pnpm-lock.yaml adds a package version published less than
 * minimumReleaseAge ago, a package that doesn't come from the npm registry,
 * or a hash for a registry version that isn't the registry's own (see
 * scripts/lib/lockfile-age.ts), and when the pull request changes where
 * pnpm downloads from: an .npmrc file, or a registry, proxy, certificate or
 * fetch setting in pnpm-workspace.yaml (audit 5 H-1). Run by CI on pull
 * requests, with the base branch fetched:
 *
 *   node scripts/lockfile-age.ts origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  addedPackages,
  changedPackages,
  changedSourceSettings,
  npmrcFiles,
  registryIntegrity,
  releaseAgeRules,
  tooNew,
  unregisteredPackages,
} from './lib/lockfile-age.ts';

const base = process.argv[2] ?? 'origin/main';
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function fail(title: string, message: string): never {
  console.log(`::error title=${title}::${message}`);
  process.exit(1);
}

/** Reads something, or fails with the reason: what pnpm would refuse, this refuses too. */
function readable<T>(what: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    // On one line: a GitHub annotation (::error) is one.
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
    return fail(
      `${what} unreadable`,
      `${what}, this pull request's or ${base}'s, can't be read: ${reason}. pnpm would refuse it too. Let pnpm write it (pnpm install).`,
    );
  }
}

const before = git('show', `${base}:pnpm-lock.yaml`);
const now = readFileSync('pnpm-lock.yaml', 'utf8');
const workspaceBefore = git('show', `${base}:pnpm-workspace.yaml`);
const workspaceNow = readFileSync('pnpm-workspace.yaml', 'utf8');

// Where pnpm downloads from isn't expected to change: an .npmrc, or a
// registry, proxy, certificate or fetch setting, could point it somewhere
// else (audit 5 H-1).
const npmrc = npmrcFiles(
  git('diff', '--name-only', '--no-renames', '--diff-filter=d', base, '--').split('\n'),
);
const sources = readable('pnpm-workspace.yaml', () =>
  changedSourceSettings(workspaceBefore, workspaceNow),
);
if (npmrc.length > 0 || sources.length > 0) {
  const what = [
    ...npmrc.map((path) => `the file ${path}`),
    ...sources.map((setting) => `${setting} in pnpm-workspace.yaml`),
  ].join(', ');
  fail(
    'Where packages come from',
    `This pull request changes where pnpm downloads packages from, or how (${what}). Nothing here needs that, so this check refuses it. If it's really needed, ask Claude: this check (scripts/lockfile-age.ts, run as ${base} has it) has to allow it first, in a pull request of its own.`,
  );
}

const added = readable('pnpm-lock.yaml', () => addedPackages(before, now));
const changed = readable('pnpm-lock.yaml', () => changedPackages(before, now));
// The rules, exceptions included, are the base branch's: a pull request can't
// let in a version it adds by listing it as an exception in the same change
// (audit 4 H-1). An exception goes in a pull request of its own, merged first.
const rules = readable('pnpm-workspace.yaml', () => releaseAgeRules(workspaceBefore));
const proposed = readable('pnpm-workspace.yaml', () => releaseAgeRules(workspaceNow));
if (JSON.stringify(proposed) !== JSON.stringify(rules)) {
  console.log(
    `::warning title=Release age rules changed::This pull request changes minimumReleaseAge or its exceptions. They apply once it's merged; this check uses ${base}'s.`,
  );
}

const elsewhere = readable('pnpm-lock.yaml', () => {
  const already = unregisteredPackages(before);
  return unregisteredPackages(now).filter((key) => !already.includes(key));
});
if (elsewhere.length > 0) {
  fail(
    'Not from npm',
    `These come from a web address or a git repository, or say where to download from, which this check can't see the age of: ${elsewhere.join(', ')}. Use a version from the npm registry.`,
  );
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
  fail(
    "Not the registry's file",
    `The lockfile's hash for these isn't the one the npm registry has, so they'd be downloaded from somewhere else: ${wrongHash.join(', ')}. Let pnpm write the lockfile (pnpm install).`,
  );
}

const young = tooNew(added, published, rules, Date.now());
console.log(`${added.length} package version(s) added to the lockfile; ${young.length} too new.`);
if (young.length > 0) {
  const days = Math.round(rules.minutes / 1440);
  fail(
    'Too new',
    `These were published less than ${days} days ago: ${young.join(', ')}. Wait, or for an urgent security fix list the package under minimumReleaseAgeExclude in pnpm-workspace.yaml, in a pull request of its own merged first (this check reads the list from ${base}).`,
  );
}
