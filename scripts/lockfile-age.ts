/**
 * Fails when pnpm-lock.yaml adds a package version published less than
 * minimumReleaseAge ago (see scripts/lib/lockfile-age.ts). Run by CI on pull
 * requests, with the base branch fetched:
 *
 *   node scripts/lockfile-age.ts origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { addedPackages, releaseAgeRules, tooNew } from './lib/lockfile-age.ts';

const base = process.argv[2] ?? 'origin/main';
const lockfileAt = (ref: string) =>
  execFileSync('git', ['show', `${ref}:pnpm-lock.yaml`], { encoding: 'utf8', maxBuffer: 1 << 28 });
const added = addedPackages(lockfileAt(base), readFileSync('pnpm-lock.yaml', 'utf8'));
const rules = releaseAgeRules(readFileSync('pnpm-workspace.yaml', 'utf8'));

const published = new Map<string, number | undefined>();
for (const name of new Set(added.map(([name]) => name))) {
  const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2F')}`);
  if (!response.ok) throw new Error(`The npm registry answered ${response.status} for ${name}.`);
  const { time = {} } = (await response.json()) as { time?: Record<string, string> };
  for (const [entry, version] of added) {
    if (entry !== name) continue;
    const at = time[version];
    published.set(`${name}@${version}`, at ? Date.parse(at) : undefined);
  }
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
