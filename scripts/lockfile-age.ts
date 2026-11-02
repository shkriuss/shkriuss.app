/**
 * Fails when pnpm-lock.yaml adds a package version published less than
 * minimumReleaseAge ago, a package that doesn't come from the npm registry,
 * or a hash for a registry version that isn't the registry's own (see
 * scripts/lib/lockfile-age.ts), and when the pull request changes a pnpm
 * setting or file that the check doesn't understand: any setting in
 * pnpm-workspace.yaml, or field in a package.json, that this repository
 * doesn't use, and any file pnpm or wrangler read by its name, like an
 * .npmrc, a pnpmfile, a second pnpm-workspace.yaml or lockfile, or a .env
 * (audit 5 H-1, audit 6 H-3, audit 7 H-1 to H-3, run 32, and H-1, run 44).
 * Run by CI on pull requests, in the pull request's checkout with the base
 * branch fetched:
 *
 *   node scripts/lockfile-age.ts origin/main
 *
 * CI runs the base branch's copy of this script, from a folder of its own with
 * the base branch's packages, before anything from the pull request is
 * installed (.github/workflows/ci.yml, audit 6 H-1).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  addedPackages,
  changedPackages,
  changedWorkspaceSettings,
  isManifest,
  registryIntegrity,
  releaseAgeRules,
  tooNew,
  toolFiles,
  unknownManifestFields,
  unknownWorkspaceSettings,
  unregisteredPackages,
} from './lib/lockfile-age.ts';

const base = process.argv[2] ?? 'origin/main';
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function fail(title: string, message: string): never {
  console.log(`::error title=${title}::${message}`);
  process.exit(1);
}

/**
 * Reads something, or fails with the reason: what pnpm would refuse, this
 * refuses too, and so is YAML that pnpm would read differently (audit 6 H-2).
 */
function readable<T>(what: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    // On one line: a GitHub annotation (::error) is one.
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
    return fail(
      `${what} unreadable`,
      `${what}, this pull request's or ${base}'s, can't be checked: ${reason}. Write it the way pnpm does: let pnpm write the lockfile (pnpm install), and write pnpm-workspace.yaml as plain YAML.`,
    );
  }
}

const before = git('show', `${base}:pnpm-lock.yaml`);
const now = readFileSync('pnpm-lock.yaml', 'utf8');
const workspaceBefore = git('show', `${base}:pnpm-workspace.yaml`);
const workspaceNow = readFileSync('pnpm-workspace.yaml', 'utf8');

/** A file as the base branch has it, or undefined if it has none. */
function atBase(path: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${base}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

// What pnpm and wrangler read isn't expected to change, beyond what this
// check understands: an .npmrc or a setting could point pnpm somewhere else
// (audit 5 H-1), or name code it runs with every command (audit 6 H-3), and
// pnpm has dozens of settings, and reads files by name in any folder, so
// each audit found one more that a list of the dangerous ones missed (audit
// 7 H-1 to H-3, run 32, and H-1, run 44). So anything else is refused.
// Separated by NUL characters, as git writes them: one per line, git
// quotes a path with a letter like "é" in it, so its file name ended in a
// quote mark, not ".npmrc".
const changedFiles = git('diff', '-z', '--name-only', '--no-renames', '--diff-filter=d', base, '--')
  .split('\0')
  .filter(Boolean);
const files = toolFiles(changedFiles);
const settings = readable('pnpm-workspace.yaml', () =>
  unknownWorkspaceSettings(workspaceBefore, workspaceNow),
);
const fields = changedFiles
  .filter(isManifest)
  .flatMap((path) =>
    readable(path, () => unknownManifestFields(atBase(path), readFileSync(path, 'utf8'))).map(
      (field) => `"${field}" in ${path}`,
    ),
  );
if (files.length > 0 || settings.length > 0 || fields.length > 0) {
  const all = [
    ...files.map((path) => `the file ${path}`),
    ...settings.map((setting) => `${setting} in pnpm-workspace.yaml`),
    ...fields,
  ];
  // A whole node_modules folder would make this too long to read.
  const what = [...all.slice(0, 20), ...(all.length > 20 ? [`${all.length - 20} more`] : [])].join(
    ', ',
  );
  fail(
    'A pnpm setting or file this check does not know',
    `This pull request changes a setting or file that pnpm or wrangler read by themselves, which this check doesn't understand (${what}). Such a change can make pnpm download from somewhere else, or run code, in the deploy too, unseen by this check. Nothing here uses it, so this check refuses it. If it's really needed, ask Claude: this check (scripts/lockfile-age.ts, run as ${base} has it) has to allow it first, in a pull request of its own.`,
  );
}

// Allowed, but worth a look before merging: an install script runs at every
// install, the deploy's included (audit 7 H-3, run 32).
if (changedWorkspaceSettings(workspaceBefore, workspaceNow, ['onlyBuiltDependencies']).length > 0) {
  console.log(
    `::warning title=Install scripts::This pull request changes which packages may run install scripts (onlyBuiltDependencies in pnpm-workspace.yaml). Their scripts run at every install, the deploy's too: check why each one is needed before merging.`,
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
    `These were published less than ${days} days ago: ${young.join(', ')}. Wait, or for an urgent security fix list the package under minimumReleaseAgeExclude in pnpm-workspace.yaml, in a pull request of its own merged first (this check reads the list from ${base}; if pnpm audit fails too, see "When a new advisory stops every merge" in docs/quality.md).`,
  );
}
