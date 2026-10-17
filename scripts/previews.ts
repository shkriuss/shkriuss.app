/**
 * Pull request previews on Cloudflare (used by .github/workflows/preview.yml).
 *
 *   node scripts/previews.ts deploy pr-12   # upload every site, print a Markdown comment
 *   node scripts/previews.ts delete pr-12   # remove that PR's previews
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment,
 * and `pnpm build` to have run first (for deploy).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { previewComment, previewUrlFromJson, type PreviewResult } from './lib/preview-output.ts';
import { repoRoot, siteSlugs } from './lib/sites.ts';

const [command, name] = process.argv.slice(2);
if (
  !command ||
  !name ||
  !['deploy', 'delete'].includes(command) ||
  !/^[a-z][a-z0-9-]*$/.test(name)
) {
  console.error('Usage: node scripts/previews.ts <deploy|delete> <preview-name, e.g. pr-12>');
  process.exit(2);
}

function wrangler(slug: string, args: string[]) {
  return spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: join(repoRoot, 'apps', slug),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

let failed = false;

if (command === 'deploy') {
  const results: PreviewResult[] = [];
  for (const slug of siteSlugs()) {
    const run = wrangler(slug, ['preview', '--name', name, '--json']);
    const url = run.status === 0 ? previewUrlFromJson(run.stdout) : undefined;
    if (!url) {
      failed = true;
      console.error(`Preview for ${slug} failed:\n${run.stderr || run.stdout}`);
    }
    results.push({ slug, url });
  }
  // stdout is the PR comment; logs go to stderr.
  console.log(previewComment(results, process.env['HEAD_SHA'] ?? process.env['GITHUB_SHA']));
} else {
  for (const slug of siteSlugs()) {
    const run = wrangler(slug, ['preview', 'delete', '--name', name, '--skip-confirmation']);
    const output = `${run.stdout}\n${run.stderr}`;
    if (run.status === 0) console.error(`Deleted preview ${name} of ${slug}.`);
    else if (/not found|does not exist|10025/i.test(output)) {
      console.error(`No preview ${name} for ${slug} (nothing to delete).`);
    } else {
      failed = true;
      console.error(`Could not delete preview ${name} of ${slug}:\n${output}`);
    }
  }
}

process.exit(failed ? 1 : 0);
