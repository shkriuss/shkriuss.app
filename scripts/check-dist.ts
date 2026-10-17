/**
 * Checks every built site in apps/<slug>/dist (run `pnpm build` first):
 * CSP safety (nothing inline) and per-page size budgets.
 *
 *   pnpm check:dist
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { budgetProblems, cspProblems, gzipSize, pageAssets } from './lib/dist-checks.ts';

const repoRoot = new URL('..', import.meta.url).pathname;
const appsDir = join(repoRoot, 'apps');
const sites = readdirSync(appsDir).filter((slug) => existsSync(join(appsDir, slug, 'dist')));

if (sites.length === 0) {
  console.error('No built sites found. Run `pnpm build` first.');
  process.exit(1);
}

let failures = 0;
const rows: string[] = [];

for (const slug of sites) {
  const dist = join(appsDir, slug, 'dist');
  const pages = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.html'),
  );

  for (const page of pages) {
    const html = readFileSync(join(dist, page), 'utf8');
    const assets = pageAssets(html);
    const sum = (files: string[]) =>
      files.reduce((total, file) => total + gzipSize(readFileSync(join(dist, file))), 0);
    const sizes = { html: gzipSize(html), css: sum(assets.css), js: sum(assets.js) };
    const problems = [...cspProblems(html), ...budgetProblems(sizes)];

    const name = `${slug}/${page}`;
    rows.push(
      `${problems.length ? '✗' : '✓'} ${name.padEnd(28)} html ${String(sizes.html).padStart(6)}  css ${String(sizes.css).padStart(6)}  js ${String(sizes.js).padStart(6)}  (bytes, gzipped)`,
    );
    for (const problem of problems) {
      rows.push(`    ${problem}`);
      failures += 1;
    }
  }
  if (pages.length === 0) {
    rows.push(`✗ ${slug}: no HTML pages in ${relative(repoRoot, dist)}`);
    failures += 1;
  }
}

console.log(rows.join('\n'));
if (failures > 0) {
  console.error(`\n${failures} problem(s). See docs/quality.md for what these checks mean.`);
  process.exit(1);
}
console.log('\nAll pages are CSP-safe and within their size budgets.');
