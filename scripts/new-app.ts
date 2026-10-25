/**
 * Creates a new app. Usage (from the repo root):
 *
 *   pnpm new-app <slug> --name "Name" --description "One sentence." \
 *     [--icon note] [--color blue] [--stores "What it saves"]...
 *
 * Example:
 *
 *   pnpm new-app notes --name "Notes" --description "Quick notes, saved on your device." \
 *     --icon note --color blue --stores "Your notes"
 *
 * Then run `pnpm install` so the workspace picks up the new app.
 * Full guide: docs/adding-an-app.md
 */
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { createApp } from './lib/create-app.ts';

const repoRoot = new URL('..', import.meta.url).pathname;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    description: { type: 'string' },
    icon: { type: 'string', default: 'grid' },
    color: { type: 'string', default: 'teal' },
    stores: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', short: 'h' },
  },
});

const slug = positionals[0];
if (values.help || !slug || !values.name || !values.description) {
  console.log(
    'Usage: pnpm new-app <slug> --name "Name" --description "One sentence." [--icon grid] [--color teal] [--stores "What it saves"]...',
  );
  process.exit(values.help ? 0 : 1);
}

try {
  const { appDir, entry } = await createApp(repoRoot, {
    slug,
    name: values.name,
    description: values.description,
    icon: values.icon,
    color: values.color,
    dataStored: values.stores,
  });

  // Match the repo's formatting so the first CI run is clean.
  execFileSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--log-level=warn', appDir, 'packages/registry/apps.json'],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  console.log(`
Created ${entry.name} in ${relative(repoRoot, appDir)}/ and added it to packages/registry/apps.json.
It's listed on the hub once merged. To deploy it without listing it, set "status" to "hidden" in apps.json.

Next:
  1. pnpm install
  2. Build the app in ${relative(repoRoot, appDir)}/src/pages/index.astro
  3. Open a pull request. CI checks it; preview links come once you approve them.
  4. Merge: it goes live at https://${entry.slug}.shkriuss.app
`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
