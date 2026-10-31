# 0020. Claude in GitHub Actions, paid by the API

Status: Superseded by [ADR 0021](0021-no-claude-workflow.md) (2026-10-31):
the workflow and its guide were removed the same day, after the sixth audit
found its safeguards didn't hold (6H-1).

## Context

- The owner works only from a phone and changes the code by asking Claude
  Code. Its sessions use the owner's Claude subscription, which has a weekly
  limit: when it runs out, work stops until it resets, even with a fix half
  done (the fifth audit's fixes waited like that).
- The owner also has a prepaid balance on the Claude API, which nothing used.
- A first try (pull requests #101 to #109, and #111, which wasn't merged)
  wrote Python scripts around one hand-made API request, with checks that it
  was never sent. It couldn't have helped: a single request can't read the
  repository, run the checks or push a fix; the request sent its key in the
  wrong header, so it would have been refused; and the checks guarded
  settings the scripts themselves fixed. What really limits spending is the
  account: a prepaid balance with automatic reload off.
- Anything that runs here with a secret must fit [SECURITY.md](../../SECURITY.md):
  no code runs with a secret before it's merged, workflows start with no
  permissions, actions are pinned, and zizmor checks every workflow.

## Decision

- **The official action.** The workflow `claude.yml` runs Claude Code
  with `anthropics/claude-code-action`, pinned to a commit (a release at
  least a week old, as with packages), and its key is the `ANTHROPIC_API_KEY`
  secret. The owner's guide was `claude-in-github.md`, in `docs/` (removed with it).
- **Started only by hand:** **Actions → Claude → Run workflow**, with what to
  do and, optionally, a pull request's number. Only people with write access
  can start a workflow. Not by "@claude" comments: on a public repository
  anyone can comment, and zizmor rejects that trigger (`issue_comment`) as
  unsafe; silencing it would weaken a check.
- **The key is a secret of the `claude` environment, which only `main` can
  use**, as the Cloudflare token is in `production`. A branch that changed
  the workflow can't read it.
- **Least access:**
  - The job's own token can only read: code, pull requests and CI's logs.
  - Claude pushes with the Claude GitHub App's token, limited by
    `additional_permissions` to commits, pull requests, issues and reading CI.
    Without GitHub's "workflows" permission it can't push a change to a
    workflow, and the `main` ruleset keeps it off `main`.
  - It never has the Cloudflare token.
- **The branch's code runs carefully:**
  - The set-up steps are `main`'s.
  - The shared package cache is neither read nor written, so this job can't
    leave anything for CI on `main`, which builds what's deployed.
  - The commands Claude runs have the API key and tokens removed from their
    environment (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`).
  - Pull requests from other people's copies of the repository are refused.
- **Limits per run:** Claude Opus 5.5, at most 60 turns and 45 minutes, and
  one run at a time.

## Consequences

- Work can go on when the subscription's limit is reached, paid from the API
  balance, and small jobs ("CI failed here, fix it") need one form.
- The worst a leaked key can do is spend the balance, and deleting it in the
  Console stops it everywhere.
- The run executes a branch's code (the tests) in the job that holds the key.
  The key is removed from those commands' environment, but that's best effort:
  as SECURITY.md says, code in a job can read the job's secrets from the
  runner's memory. That's why it's for the owner's and Claude's own branches
  only, and why the balance is the real limit.
- Starting it from a form is less handy than an "@claude" comment, and
  Claude's answer is on the run's page, not on the pull request.
- It can't run the browser tests (CI does, on what it pushes), change
  workflows, or open pull requests: the owner opens them from its link.
- The action and Claude Code change quickly: Dependabot proposes new pins,
  and each one needs reading before it's merged.

## Alternatives

- **"@claude" comments** (`issue_comment`): handier, but zizmor rejects the
  trigger, and on a public repository strangers' comments on the same pull
  request or issue become part of what Claude reads.
- **Hand-written API calls** (the first try): a single request can't do the
  work, and the code to make it safe was larger than the job.
- **The subscription's token** (`CLAUDE_CODE_OAUTH_TOKEN`) in place of the key:
  possible with a one-line change, but it counts against the same weekly
  limit this is meant to get around.
- **Only Claude Code sessions** (no workflow): no new access to secure, but
  no way to keep going when the weekly limit is reached.
