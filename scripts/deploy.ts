/**
 * Deploys the site in the current folder to production: `wrangler deploy`,
 * giving its Worker the secrets it needs (scripts/lib/storage.ts), like an
 * online library's storage code. Run from an app's "deploy:production"
 * script, by CI after the tests pass.
 *
 *   node ../../scripts/deploy.ts
 */
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { getSite } from '../packages/registry/src/index.ts';
import { withSecretsFile, workerSecrets } from './lib/storage.ts';

const slug = basename(process.cwd());
const { secrets, missing } = workerSecrets(slug, getSite(slug).library);
for (const name of missing) {
  // Secrets stay from one deploy to the next, so this only matters the first time.
  console.log(
    `::warning title=Missing secret::${name} isn't set, so ${slug} keeps the storage code it had, or has none and can't add to its online library. See docs/deployment.md.`,
  );
}
const status = withSecretsFile(
  secrets,
  (args) =>
    spawnSync('pnpm', ['exec', 'wrangler', 'deploy', ...args], {
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    }).status,
);
process.exit(status ?? 1);
