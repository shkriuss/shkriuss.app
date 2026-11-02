/**
 * Fails a pull request whose title, description or commit messages have one
 * of GitHub's "skip CI" words in them: merged, its commit on main would get
 * no CI run, so nothing would deploy it (scripts/lib/skip-ci.ts, audit 7
 * H-5, run 32). Run by CI on pull requests, in the merge commit GitHub makes
 * for one, with the history:
 *
 *   PR_TITLE=… PR_BODY=… node scripts/skip-ci.ts
 */
import { execFileSync } from 'node:child_process';
import { skipCiWords } from './lib/skip-ci.ts';

function fail(message: string): never {
  console.log(`::error title=It would not deploy::${message}`);
  process.exit(1);
}

let commits: string;
try {
  // The pull request's own commits: those its head (the merge's second
  // parent) has and the base branch (its first) doesn't.
  commits = execFileSync('git', ['log', '--format=%B', 'HEAD^1..HEAD^2'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
} catch {
  fail("This pull request's commits couldn't be read (CI checks out the merge GitHub makes).");
}

const found = [
  ...skipCiWords(`${process.env['PR_TITLE'] ?? ''}\n${process.env['PR_BODY'] ?? ''}`),
  ...skipCiWords(commits),
];
if (found.length > 0) {
  fail(
    `The pull request's title, description or a commit message has ${[...new Set(found)].join(', ')} in it. Merged, that text goes into main's commit, and GitHub then starts no CI run for it, so nothing deploys it. Reword it (a commit's message too: a new commit doesn't replace it, so ask Claude to rewrite it), then push a commit, or close and reopen the pull request: re-running this run reads the old text.`,
  );
}
console.log("Nothing in the pull request's text stops its deploy.");
