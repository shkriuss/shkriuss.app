/**
 * Every app that reminds you while it's closed and syncs says what that
 * means: each device sends the reminders it uploaded, until the app is
 * opened there again, also after they were ticked off, changed or turned
 * off on another device. Audit 6 F1-6 added the note to two of the pages,
 * and the others still promised less (audit 7 F1-5, G-14).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apps } from '../../packages/registry/src/index.ts';

const repoRoot = join(import.meta.dirname, '../..');

describe('reminders while an app is closed, with sync on', () => {
  const pages = apps.map((app) => ({
    app,
    page: readFileSync(join(repoRoot, 'apps', app.slug, 'src/pages/index.astro'), 'utf8').replace(
      /\s+/g,
      ' ',
    ),
  }));
  const reminding = pages.filter(
    ({ page }) => page.includes('<PushControls') && page.includes('<SyncControls'),
  );

  it('are in more than one app', () => {
    expect(reminding.length).toBeGreaterThan(1);
  });

  it.each(reminding.map(({ app, page }) => [app.name, page]))(
    '%s says a closed device may still remind after a change elsewhere',
    (name, page) => {
      expect(page).toContain(`While ${name} is closed on a device,`);
      expect(page).toContain(`until ${name} is opened there again.`);
    },
  );
});
