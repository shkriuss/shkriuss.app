/**
 * Creates the R2 buckets that apps with an online library use
 * (docs/adr/0016-online-photo-library.md), if they aren't there yet. CI runs
 * it before deploying, so each Worker finds its bucket. Preview buckets get
 * a rule that deletes their files after 7 days.
 *
 *   node scripts/buckets.ts production
 *   node scripts/buckets.ts preview
 *
 * Needs CLOUDFLARE_API_TOKEN (with "Workers R2 Storage: Edit") and
 * CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot, siteSlugs } from './lib/sites.ts';
import { siteBuckets } from './lib/storage.ts';

/** Days a preview's photos are kept. */
const PREVIEW_DAYS = 7;

const where = process.argv[2];
if (where !== 'production' && where !== 'preview') {
  console.error('Usage: node scripts/buckets.ts <production|preview>');
  process.exit(2);
}

function wrangler(slug: string, args: string[]) {
  const run = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: join(repoRoot, 'apps', slug),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  return { ok: run.status === 0, output: `${run.stdout}\n${run.stderr}` };
}

let failed = false;
for (const slug of siteSlugs()) {
  for (const bucket of siteBuckets(slug, where)) {
    const created = wrangler(slug, ['r2', 'bucket', 'create', bucket]);
    if (created.ok) {
      console.log(`Created the R2 bucket ${bucket}.`);
    } else if (/already exists/i.test(created.output)) {
      console.log(`The R2 bucket ${bucket} is there.`);
    } else {
      failed = true;
      console.error(`Could not create the R2 bucket ${bucket}:\n${created.output}`);
      console.log(
        `::error title=R2 bucket::Could not create ${bucket}. Is R2 turned on, and may the Cloudflare token edit R2 storage? See docs/deployment.md.`,
      );
      continue;
    }
    if (where === 'preview') {
      const rule = wrangler(slug, [
        'r2',
        'bucket',
        'lifecycle',
        'add',
        bucket,
        'delete-old-previews',
        '--expire-days',
        String(PREVIEW_DAYS),
        '--force',
      ]);
      if (!rule.ok && !/already exists|duplicate/i.test(rule.output)) {
        // Previews still work; their files just stay until deleted by hand.
        console.log(
          `::warning title=R2 bucket::Could not set ${bucket} to delete files after ${PREVIEW_DAYS} days.`,
        );
      }
    }
  }
}

process.exit(failed ? 1 : 0);
