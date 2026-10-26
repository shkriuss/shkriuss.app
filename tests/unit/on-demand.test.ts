/**
 * Files an app downloads only when asked (docs/adr/0012-deep-check-ai-model.md)
 * are left out of the build CI saves, and the deploy puts them back by
 * running each app's "on-demand-into-dist" script, if it has one. So an app
 * whose code downloads from /on-demand/ must have a script by that name:
 * renamed, the app would deploy without its files and every check would
 * still pass (audit 3 J-7).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');
const appsDir = join(repoRoot, 'apps');

/** Every file under `dir`, recursively. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const sites = readdirSync(appsDir).filter((slug) => existsSync(join(appsDir, slug, 'src')));
const usesOnDemand = (slug: string) =>
  filesIn(join(appsDir, slug, 'src')).some((file) =>
    readFileSync(file, 'utf8').includes("'/on-demand/"),
  );

describe('on-demand files', () => {
  it('are put back by the deploy for every app that downloads them', () => {
    const using = sites.filter(usesOnDemand);
    expect(using).toContain('grammar');
    for (const slug of using) {
      const { scripts = {} } = JSON.parse(
        readFileSync(join(appsDir, slug, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };
      expect(scripts, `${slug}'s package.json`).toHaveProperty('on-demand-into-dist');
    }
  });

  it('are put back by the deploy step that runs that script', () => {
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('run on-demand-into-dist');
  });
});
