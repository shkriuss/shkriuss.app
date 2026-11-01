/**
 * Guards for the GitHub workflows:
 * - every third-party action is pinned to an exact commit (supply-chain safety);
 * - the lockfile check runs main's copy, before anything from a pull request;
 * - no other run can cancel the deploy of main's newest commit;
 * - the build CI saves for the deploy keeps every file;
 * - the "New app" form offers exactly the icons and colours that exist.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ICON_COLORS } from '../../packages/registry/src/index.ts';
import { iconNames } from '../../packages/ui/src/icons/index.ts';

const github = join(import.meta.dirname, '../../.github');
const workflowFiles = [
  ...readdirSync(join(github, 'workflows')).map((file) => join(github, 'workflows', file)),
  // Every shared action, not only "setup".
  ...readdirSync(join(github, 'actions')).map((name) =>
    join(github, 'actions', name, 'action.yml'),
  ),
];

/**
 * Every `uses:` in a workflow or action, read as YAML the way GitHub reads
 * it, wherever it is: a step's or a job's (a reusable workflow), with a
 * quoted key, or in a step written on one line (audit 5 H-4). Read by line
 * patterns, a quoted key was missed.
 */
function actionsUsed(yaml: string): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses' && typeof value === 'string') found.push(value);
      walk(value);
    }
  };
  walk(parse(yaml));
  return found;
}

/**
 * "owner/repo@<commit>" (or "owner/repo/path@<commit>") with the full
 * 40-character commit, which no tag or branch can move. Only zizmor's online
 * check in CI tells whether that commit really belongs to the action.
 */
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/;

describe('GitHub Actions are pinned to commits', () => {
  it.each(workflowFiles)('%s', (file) => {
    const uses = actionsUsed(readFileSync(file, 'utf8'));
    expect(uses.length, 'uses at least one action').toBeGreaterThan(0);
    for (const action of uses) {
      if (action.startsWith('./')) continue;
      expect(action, `${action} should be pinned to a full commit SHA`).toMatch(PINNED);
    }
  });

  it('sees every way a step can be written (audit 5 H-4)', () => {
    const workflow = `
on: push
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - "uses": actions/setup-node@v4
      - {name: on one line, uses: someone/thing@v1}
      - name: local
        uses: ./.github/actions/setup
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
  b:
    uses: someone/workflows/.github/workflows/x.yml@main
`;
    const used = actionsUsed(workflow);
    expect(used).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'someone/thing@v1',
      './.github/actions/setup',
      'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
      'someone/workflows/.github/workflows/x.yml@main',
    ]);
    expect(used.filter((action) => PINNED.test(action))).toEqual([
      'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
    ]);
  });
});

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  steps?: Step[];
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown };
  outputs?: Record<string, string>;
}
const ci = parse(readFileSync(join(github, 'workflows/ci.yml'), 'utf8')) as {
  concurrency: { group: string; 'cancel-in-progress': unknown };
  jobs: Record<string, Job>;
};

describe('the lockfile check runs before anything from the pull request (audit 6 H-1)', () => {
  const steps = ci.jobs['audit']?.steps ?? [];
  const at = steps.findIndex((step) => step.run?.includes('lockfile-age.ts'));

  it('runs main’s copy, with main’s packages, in a folder outside the checkout', () => {
    expect(at, 'the step that runs the check').toBeGreaterThan(0);
    const run = steps[at]?.run ?? '';
    expect(run).toContain('git archive "origin/$BASE_REF" package.json pnpm-lock.yaml');
    expect(run).toContain(
      '(cd "$RUNNER_TEMP/base" && pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
    );
    expect(run).toContain('node "$RUNNER_TEMP/base/scripts/lockfile-age.ts" "origin/$BASE_REF"');
  });

  it('only checks out the code and sets up pnpm and Node.js before it, and never installs the pull request’s packages', () => {
    for (const step of steps.slice(0, at)) {
      if (step.uses?.startsWith('actions/checkout@')) continue;
      expect(step.uses, step.name).toBe('./.github/actions/setup');
      expect(step.with, step.name).toMatchObject({ install: 'false', cache: 'false' });
    }
    for (const step of steps) {
      if (step.uses === './.github/actions/setup') expect(step.with?.['install']).toBe('false');
      expect(step.run ?? '', step.name).not.toMatch(/^\s*pnpm (?:install|i|add)\b/m);
    }
  });

  it('the setup action installs packages only when asked', () => {
    const setup = parse(readFileSync(join(github, 'actions/setup/action.yml'), 'utf8')) as {
      runs: { steps: (Step & { if?: string })[] };
    };
    const install = setup.runs.steps.filter((step) => step.run?.includes('pnpm install'));
    expect(install.length).toBe(1);
    expect(install[0]?.if).toBe("inputs.install == 'true'");
  });
});

describe('nothing can cancel the deploy of main’s newest commit (audit 6 H-6)', () => {
  // GitHub keeps one waiting run (or job) per concurrency group, and cancels
  // it when another one queues.
  it('only a pull request’s runs share a group, so only they cancel each other', () => {
    expect(ci.concurrency.group).toBe(
      "ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
    );
    expect(ci.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it('only a run that will deploy waits its turn in the production group', () => {
    const queued = Object.entries(ci.jobs).filter(([, job]) => job.concurrency !== undefined);
    expect(queued.map(([name]) => name)).toEqual(['deploy']);
    const deploy = ci.jobs['deploy'];
    const newest = ci.jobs['newest'];
    expect(deploy?.concurrency).toEqual({ group: 'production', 'cancel-in-progress': false });
    expect(deploy?.needs).toBe('newest');
    expect(deploy?.if).toMatch(/&& needs\.newest\.outputs\.deploy == 'true'$/);
    expect(newest?.needs).toEqual(['checks', 'secrets', 'audit']);
    expect(newest?.outputs?.['deploy']).toBe('${{ steps.newest.outputs.deploy }}');
    // The deploy job checks again, the same way, before it deploys anything.
    const check = (job: Job | undefined) => job?.steps?.find((step) => step.id === 'newest')?.run;
    expect(check(newest)).toContain('commits/main');
    expect(check(deploy)).toBe(check(newest));
    expect(deploy?.steps?.[0]?.id).toBe('newest');
  });
});

describe('the build CI tested is the one deployed', () => {
  it('keeps files in folders whose names start with a dot (/.well-known/security.txt)', () => {
    const ci = readFileSync(join(github, 'workflows/ci.yml'), 'utf8');
    // The step runs to the next blank line.
    const step = /- name: Save the tested build for deployment\n[\s\S]*?(?=\n\s*\n)/.exec(ci)?.[0];
    expect(step, 'the step that saves the build').toBeDefined();
    expect(step).toContain('include-hidden-files: true');
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
