import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, optionProblems, TEMPLATE_SLUG, type NewAppOptions } from './create-app.ts';

const repoRoot = join(import.meta.dirname, '../..');

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

describe('createApp', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shkriuss-new-app-'));
    await cp(join(repoRoot, 'templates/app'), join(root, 'templates/app'), { recursive: true });
    await mkdir(join(root, 'packages/registry'), { recursive: true });
    await writeFile(join(root, 'packages/registry/apps.json'), JSON.stringify(sampleRegistry));
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
      status: 'beta',
      storage: 'device',
      dataStored: ['Your notes'],
    });
  });

  it('marks storage as "none" when nothing is stored', async () => {
    const { entry } = await createApp(root, { ...options, dataStored: [] });
    expect(entry.storage).toBe('none');
  });

  it('refuses to overwrite an existing folder', async () => {
    await mkdir(join(root, 'apps/notes'), { recursive: true });
    await writeFile(join(root, 'apps/notes/keep.txt'), 'mine');
    await expect(createApp(root, options)).rejects.toThrow(/already exists/);
    expect(await readFile(join(root, 'apps/notes/keep.txt'), 'utf8')).toBe('mine');
  });
});
