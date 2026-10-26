/**
 * Creates a new app from templates/app and adds it to the registry.
 * Used by scripts/new-app.ts (command line) and by the "New app" GitHub
 * workflow. Kept separate so it can be tested.
 */
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ICON_COLORS,
  slugProblems,
  validateRegistry,
  type AppEntry,
  type IconColor,
} from '../../packages/registry/src/index.ts';
import { isIconName, iconNames } from '../../packages/ui/src/icons/index.ts';

/** The slug used throughout templates/app; replaced with the new app's slug. */
export const TEMPLATE_SLUG = 'template-app';

export interface NewAppOptions {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  /** What the app stores on the device, for the privacy page. */
  dataStored: string[];
}

/** Returns every problem with the options (an empty list means all good). */
export function optionProblems(options: NewAppOptions, existingSlugs: readonly string[]): string[] {
  const problems = slugProblems(options.slug, existingSlugs);
  if (options.slug === TEMPLATE_SLUG)
    problems.push(`"${TEMPLATE_SLUG}" is reserved for the template.`);
  if (!options.name.trim()) problems.push('Give the app a name.');
  if (options.name.trim().length > 30) problems.push('Keep the name to 30 characters or fewer.');
  if (!options.description.trim()) problems.push('Give the app a one-sentence description.');
  if (options.description.trim().length > 160) {
    problems.push('Keep the description to 160 characters or fewer.');
  }
  if (!isIconName(options.icon)) {
    problems.push(`Unknown icon "${options.icon}". Choose one of: ${iconNames.join(', ')}.`);
  }
  if (!(ICON_COLORS as readonly string[]).includes(options.color)) {
    problems.push(`Unknown colour "${options.color}". Choose one of: ${ICON_COLORS.join(', ')}.`);
  }
  return problems;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

export interface CreateAppResult {
  appDir: string;
  entry: AppEntry;
}

/** What every page saves (its theme switch), so every app lists it on the privacy page. */
export const THEME_CHOICE = 'Your light or dark theme choice';

/**
 * The shared browser tests whose tables need a line for every site
 * (tests/e2e/every-site.ts), and how each table starts.
 */
export const SHARED_TEST_TABLES = [
  { file: 'tests/e2e/saving.spec.ts', start: 'const changes: EverySite<' },
  { file: 'tests/e2e/keep-focus.spec.ts', start: 'const cases: EverySite<' },
  { file: 'tests/e2e/large-text.spec.ts', start: 'const cases: EverySite<' },
] as const;

/**
 * `source` with a line for `slug` at the end of the table that starts with
 * `start`: null, as the template has nothing for the test yet, with a
 * comment saying to fill it in. Without a line, the test fails for the app
 * (audit 3 J-11).
 */
export function withSiteLine(source: string, start: string, slug: string): string {
  const at = source.indexOf(start);
  const end = at === -1 ? -1 : source.indexOf('\n};', at);
  if (end === -1) throw new Error(`Can't find the table "${start}…" to add ${slug} to.`);
  const line = `\n  // New: nothing for this test yet. Put what to do here once the app has it.\n  '${slug}': null,`;
  return source.slice(0, end) + line + source.slice(end);
}

/**
 * Copies the template, replaces the slug, appends the app to apps.json and
 * gives it a line in each shared browser test's table (SHARED_TEST_TABLES).
 */
export async function createApp(
  repoRoot: string,
  options: NewAppOptions,
): Promise<CreateAppResult> {
  const registryPath = join(repoRoot, 'packages/registry/apps.json');
  const registry = validateRegistry(JSON.parse(await readFile(registryPath, 'utf8')));

  const problems = optionProblems(
    options,
    registry.apps.map((app) => app.slug),
  );
  const appDir = join(repoRoot, 'apps', options.slug);
  if (await exists(appDir)) problems.push(`The folder apps/${options.slug} already exists.`);
  if (problems.length > 0) {
    throw new Error(`Can't create the app:\n- ${problems.join('\n- ')}`);
  }
  // Worked out before anything is written, so a table that can't be found stops it all.
  const tables = await Promise.all(
    SHARED_TEST_TABLES.map(async ({ file, start }) => {
      const path = join(repoRoot, file);
      return { path, content: withSiteLine(await readFile(path, 'utf8'), start, options.slug) };
    }),
  );

  await cp(join(repoRoot, 'templates/app'), appDir, { recursive: true });
  for (const file of await listFilesRecursive(appDir)) {
    const content = await readFile(file, 'utf8');
    if (content.includes(TEMPLATE_SLUG)) {
      await writeFile(file, content.replaceAll(TEMPLATE_SLUG, options.slug));
    }
  }

  // Every page has the theme switch, which saves the choice on the device.
  const dataStored = [
    ...new Set([
      ...options.dataStored.flatMap((item) => item.split(';')).map((item) => item.trim()),
      THEME_CHOICE,
    ]),
  ].filter(Boolean);
  const entry: AppEntry = {
    slug: options.slug,
    name: options.name.trim(),
    description: options.description.trim(),
    icon: options.icon,
    color: options.color as IconColor,
    status: 'live',
    storage: 'device',
    dataStored,
  };
  const updated = { ...registry, apps: [...registry.apps, entry] };
  validateRegistry(updated);
  await writeFile(registryPath, `${JSON.stringify(updated, null, 2)}\n`);
  for (const { path, content } of tables) await writeFile(path, content);

  return { appDir, entry };
}
