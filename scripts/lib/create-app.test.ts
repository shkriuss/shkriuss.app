import { cp, mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  optionProblems,
  SHARED_TEST_FILES,
  SHARED_TEST_TABLES,
  siteTables,
  TEMPLATE_SLUG,
  THEME_CHOICE,
  withSiteLine,
  type NewAppOptions,
} from './create-app.ts';

const repoRoot = join(import.meta.dirname, '../..');

/** A shared test file as the temporary repo has it: each of its tables, with one app. */
const sampleTests = (file: string, slug = 'tally'): string =>
  SHARED_TEST_TABLES.filter((table) => table.file === file)
    .map(({ start }) => `${start}Case> = {\n  ${slug}: tallyCase,\n};\n`)
    .join('\n');

/** Every test file in tests/e2e, with what it says. */
async function sharedTests(root: string): Promise<{ file: string; source: string }[]> {
  const files = (await readdir(join(root, 'tests/e2e'))).filter((name) => name.endsWith('.ts'));
  return Promise.all(
    files.map(async (name) => ({
      file: `tests/e2e/${name}`,
      source: await readFile(join(root, 'tests/e2e', name), 'utf8'),
    })),
  );
}

const sampleRegistry = {
  site: {
    name: 'shkriuss',
    domain: 'shkriuss.app',
    description: 'Apps.',
    icon: 'grid',
    color: 'teal',
  },
  apps: [
    {
      slug: 'tally',
      name: 'Tally',
      description: 'Count things.',
      icon: 'tally',
      color: 'indigo',
      status: 'live',
      storage: 'device',
      dataStored: ['Counts'],
    },
  ],
};

const options: NewAppOptions = {
  slug: 'notes',
  name: 'Notes',
  description: 'Quick notes, saved on your device.',
  icon: 'note',
  color: 'blue',
  dataStored: ['Your notes'],
};

describe('optionProblems', () => {
  it('accepts good options', () => {
    expect(optionProblems(options, ['tally'])).toEqual([]);
  });

  it('reports every problem', () => {
    const problems = optionProblems(
      { slug: 'Bad', name: '', description: '', icon: 'nope', color: 'neon', dataStored: [] },
      [],
    );
    expect(problems.join('\n')).toMatch(/lowercase/);
    expect(problems.join('\n')).toMatch(/name/);
    expect(problems.join('\n')).toMatch(/description/);
    expect(problems.join('\n')).toMatch(/Unknown icon "nope"/);
    expect(problems.join('\n')).toMatch(/Unknown colour "neon"/);
  });

  it('reserves the template slug and existing slugs', () => {
    expect(optionProblems({ ...options, slug: TEMPLATE_SLUG }, [])).toHaveLength(1);
    expect(optionProblems(options, ['notes'])).toHaveLength(1);
  });
});

describe('siteTables', () => {
  it('lists each table’s sites, not what’s inside their lines', () => {
    const source = [
      'const cases: EverySite<Case> = {',
      '  budget: {',
      '    setup: async (page) => page,',
      '  },',
      '  // Nothing to test.',
      '  hub: null,',
      "  'new-app': null,",
      '};',
      '',
      'const other = { tally: 1 };',
      'const comingBack: EverySite<Case> = {',
      "  budget: cases['budget'] ?? null,",
      '};',
    ].join('\n');
    expect(siteTables(source)).toEqual([
      { name: 'cases', start: 'const cases: EverySite<', sites: ['budget', 'hub', 'new-app'] },
      { name: 'comingBack', start: 'const comingBack: EverySite<', sites: ['budget'] },
    ]);
  });
});

describe('createApp', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shkriuss-new-app-'));
    await cp(join(repoRoot, 'templates/app'), join(root, 'templates/app'), { recursive: true });
    await mkdir(join(root, 'packages/registry'), { recursive: true });
    await writeFile(join(root, 'packages/registry/apps.json'), JSON.stringify(sampleRegistry));
    // The shared browser tests' tables, with one app in each.
    await mkdir(join(root, 'tests/e2e'), { recursive: true });
    for (const file of SHARED_TEST_FILES) await writeFile(join(root, file), sampleTests(file));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copies the template with the new slug and registers the app', async () => {
    await createApp(root, options);

    const wrangler = await readFile(join(root, 'apps/notes/wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "notes"');
    expect(wrangler).toContain('"pattern": "notes.shkriuss.app"');
    expect(wrangler).not.toContain(TEMPLATE_SLUG);

    const pkg = JSON.parse(await readFile(join(root, 'apps/notes/package.json'), 'utf8'));
    expect(pkg.name).toBe('notes');

    const config = await readFile(join(root, 'apps/notes/astro.config.ts'), 'utf8');
    expect(config).toContain("slug: 'notes'");

    const registry = JSON.parse(await readFile(join(root, 'packages/registry/apps.json'), 'utf8'));
    expect(registry.apps.at(-1)).toEqual({
      slug: 'notes',
      name: 'Notes',
      description: 'Quick notes, saved on your device.',
      icon: 'note',
      color: 'blue',
      status: 'live',
      storage: 'device',
      dataStored: ['Your notes', 'Your light or dark theme choice'],
    });
  });

  it('always lists the theme choice, which every page saves', async () => {
    const { entry } = await createApp(root, { ...options, dataStored: [] });
    expect(entry).toMatchObject({
      storage: 'device',
      dataStored: ['Your light or dark theme choice'],
    });
  });

  it('splits several things saved, given in one line with ";"', async () => {
    const { entry } = await createApp(root, {
      ...options,
      dataStored: ['Your notes; Your settings ;', 'Your light or dark theme choice'],
    });
    expect(entry.dataStored).toEqual([
      'Your notes',
      'Your settings',
      'Your light or dark theme choice',
    ]);
  });

  it('matches what every app in the registry lists', async () => {
    const registry = JSON.parse(
      await readFile(join(repoRoot, 'packages/registry/apps.json'), 'utf8'),
    ) as { apps: { dataStored: string[] }[] };
    for (const app of registry.apps) expect(app.dataStored).toContain(THEME_CHOICE);
  });

  it('gives the new app a line, to fill in, in each shared browser test (audit 3 J-11)', async () => {
    await createApp(root, options);
    for (const file of SHARED_TEST_FILES) {
      const source = await readFile(join(root, file), 'utf8');
      expect(source, file).toBe(
        sampleTests(file).replaceAll(
          '\n};',
          "\n  // New: nothing for this test yet. Put what to do here once the app has it.\n  'notes': null,\n};",
        ),
      );
    }
  });

  it('finds the tables in the real shared browser tests', async () => {
    for (const { file, start } of SHARED_TEST_TABLES) {
      const source = await readFile(join(repoRoot, file), 'utf8');
      expect(withSiteLine(source, start, 'notes'), file).toContain("  'notes': null,\n};");
    }
  });

  it('knows every table in the shared browser tests (audit 6 J-1)', async () => {
    // keep-focus got three more tables, and a new app had a line in none of
    // them, so its first pull request failed.
    const found = (await sharedTests(repoRoot)).flatMap(({ file, source }) =>
      siteTables(source).map(({ start }) => ({ file, start })),
    );
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(
      found.filter(
        (table) =>
          !SHARED_TEST_TABLES.some(
            ({ file, start }) => file === table.file && start === table.start,
          ),
      ),
      'Add these to SHARED_TEST_TABLES in scripts/lib/create-app.ts',
    ).toEqual([]);
  });

  it('gives a new app a line in every table of the real shared browser tests', async () => {
    for (const { file, source } of await sharedTests(repoRoot)) {
      await writeFile(join(root, file), source);
    }
    // A slug none of them has a line for yet (Notes has one in each).
    await createApp(root, { ...options, slug: 'journal', name: 'Journal' });
    for (const { file, source } of await sharedTests(root)) {
      for (const { name, sites } of siteTables(source)) {
        expect(sites, `${file} ${name}`).toContain('journal');
      }
    }
  });

  it('changes nothing when a table can’t be found', async () => {
    await writeFile(join(root, SHARED_TEST_TABLES[0].file), 'const changes = {};\n');
    await expect(createApp(root, options)).rejects.toThrow(/Can't find the table/);
    await expect(readFile(join(root, 'apps/notes/package.json'), 'utf8')).rejects.toThrow();
    const registry = JSON.parse(await readFile(join(root, 'packages/registry/apps.json'), 'utf8'));
    expect(registry.apps).toHaveLength(1);
  });

  it('refuses to overwrite an existing folder', async () => {
    await mkdir(join(root, 'apps/notes'), { recursive: true });
    await writeFile(join(root, 'apps/notes/keep.txt'), 'mine');
    await expect(createApp(root, options)).rejects.toThrow(/already exists/);
    expect(await readFile(join(root, 'apps/notes/keep.txt'), 'utf8')).toBe('mine');
  });
});
