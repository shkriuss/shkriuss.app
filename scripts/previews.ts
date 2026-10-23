/**
 * Pull request previews on Cloudflare (used by .github/workflows/preview.yml
 * and ci.yml).
 *
 *   node scripts/previews.ts deploy pr-12   # upload every site, print a Markdown comment
 *   node scripts/previews.ts delete pr-12   # remove that PR's previews
 *   node scripts/previews.ts prune          # remove previews of closed PRs
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment,
 * and `pnpm build` to have run first (for deploy). Apps with an online
 * library need their preview bucket (scripts/buckets.ts preview), but get no
 * storage code: a preview runs a pull request's code, so its library stays
 * locked. Prune also needs GH_TOKEN and GH_REPO, to list the open PRs; it
 * runs after each production deploy, from main's own code.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getSite } from '../packages/registry/src/index.ts';
import {
  closedPreviews,
  previewComment,
  previewUrlFromJson,
  type PreviewResult,
} from './lib/preview-output.ts';
import { repoRoot, siteSlugs } from './lib/sites.ts';

const [command, name] = process.argv.slice(2);
const named = command === 'deploy' || command === 'delete';
if (!(command === 'prune' || (named && name && /^[a-z][a-z0-9-]*$/.test(name)))) {
  console.error(
    'Usage: node scripts/previews.ts <deploy|delete> <preview-name, e.g. pr-12>, or prune',
  );
  process.exit(2);
}

function wrangler(slug: string, args: string[]) {
  return spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: join(repoRoot, 'apps', slug),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

/** Deletes one site's preview; false if it couldn't. */
function deletePreview(slug: string, preview: string): boolean {
  const run = wrangler(slug, ['preview', 'delete', '--name', preview, '--skip-confirmation']);
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.status === 0) console.error(`Deleted preview ${preview} of ${slug}.`);
  else if (/not found|does not exist|10025/i.test(output)) {
    console.error(`No preview ${preview} for ${slug} (nothing to delete).`);
  } else {
    console.error(`Could not delete preview ${preview} of ${slug}:\n${output}`);
    return false;
  }
  return true;
}

async function getJson(url: string, token: string | undefined): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The numbers of the repository's open pull requests. */
async function openPullRequests(): Promise<number[]> {
  const pulls = await getJson(
    `https://api.github.com/repos/${process.env['GH_REPO']}/pulls?state=open&per_page=100`,
    process.env['GH_TOKEN'],
  );
  return (pulls as { number: number }[]).map((pull) => pull.number);
}

/** The names of a site's previews on Cloudflare. */
async function previewNames(slug: string): Promise<string[]> {
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const answer = await getJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/${slug}/previews`,
    process.env['CLOUDFLARE_API_TOKEN'],
  );
  return ((answer as { result?: { name: string }[] }).result ?? []).map((item) => item.name);
}

let failed = false;

if (command === 'deploy') {
  const results: PreviewResult[] = [];
  for (const slug of siteSlugs()) {
    if (getSite(slug).library) {
      console.error(`The ${slug} preview's online library stays locked (no storage code).`);
    }
    const run = wrangler(slug, ['preview', '--name', name as string, '--json']);
    const url = run.status === 0 ? previewUrlFromJson(run.stdout) : undefined;
    if (!url) {
      failed = true;
      console.error(`Preview for ${slug} failed:\n${run.stderr || run.stdout}`);
    }
    results.push({ slug, url });
  }
  // stdout is the PR comment; logs go to stderr.
  console.log(previewComment(results, process.env['HEAD_SHA'] ?? process.env['GITHUB_SHA']));
} else if (command === 'delete') {
  for (const slug of siteSlugs()) {
    if (!deletePreview(slug, name as string)) failed = true;
  }
} else {
  // Prune: production is already deployed, so a problem here is only a warning.
  try {
    const open = await openPullRequests();
    for (const slug of siteSlugs()) {
      for (const preview of closedPreviews(await previewNames(slug), open)) {
        if (!deletePreview(slug, preview)) {
          console.log(`::warning title=Previews::Could not delete ${slug}'s preview ${preview}.`);
        }
      }
    }
  } catch (error) {
    console.log(`::warning title=Previews::Could not check for old previews: ${String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
