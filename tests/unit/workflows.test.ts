/**
 * Guards for the GitHub workflows:
 * - every third-party action is pinned to an exact commit (supply-chain safety);
 * - the "New app" form offers exactly the icons and colours that exist.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_COLORS } from '../../packages/registry/src/index.ts';
import { iconNames } from '../../packages/ui/src/icons/index.ts';

const github = join(import.meta.dirname, '../../.github');
const workflowFiles = [
  ...readdirSync(join(github, 'workflows')).map((file) => join(github, 'workflows', file)),
  join(github, 'actions/setup/action.yml'),
];

describe('GitHub Actions are pinned to commits', () => {
  it.each(workflowFiles)('%s', (file) => {
    const uses = [...readFileSync(file, 'utf8').matchAll(/uses:\s*([^\s#]+)/g)].map(
      (match) => match[1] as string,
    );
    for (const action of uses) {
      if (action.startsWith('./')) continue;
      expect(action, `${action} should be pinned to a full commit SHA`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

/** The `options:` list under an input in new-app.yml. */
function choiceOptions(input: string): string[] {
  const yaml = readFileSync(join(github, 'workflows/new-app.yml'), 'utf8');
  const block = new RegExp(`\\n {6}${input}:\\n[\\s\\S]*?options:\\n((?: {10}- .+\\n)+)`).exec(
    yaml,
  );
  if (!block?.[1]) throw new Error(`No options found for ${input}`);
  return block[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*- /, '').trim());
}

describe('"New app" workflow form', () => {
  it('offers every icon', () => {
    expect(choiceOptions('icon')).toEqual([...iconNames].sort());
  });

  it('offers every colour', () => {
    expect(choiceOptions('color')).toEqual([...ICON_COLORS]);
  });
});
