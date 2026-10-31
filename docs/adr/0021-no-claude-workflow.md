# 0021. No Claude workflow in this repository

Status: Accepted (2026-10-31). Supersedes [ADR 0020](0020-claude-in-github-actions.md).

## Context

- ADR 0020 added the **Claude** workflow (`claude.yml`, in `.github/workflows/`):
  Claude Code started by hand from GitHub, paid from the API balance, so work
  could go on when the Claude subscription's weekly limit runs out.
- The sixth audit (31 October 2026) found that its safeguards didn't hold
  (6H-1, High). Run on a pull request, it installed and tested that branch's
  packages in a job that also held the Claude GitHub App's write token (in
  the checkout's git settings), could ask GitHub for more of those tokens,
  and could write the caches that CI on `main` and the deploy restore.
  Dependabot's branches passed its only check, so one malicious package
  version in a Dependabot pull request could have reached production without
  anyone reviewing it. Smaller findings: it could be handed a stranger's CI
  log (6H-7), its "never force push" rule was easy to step around (6H-8), and
  its docs had fallen behind (6J-2, 6J-5).
- The API balance it was meant to spend is the monthly credit that comes
  with the owner's Claude plan. That credit pays for the Claude API and the
  Agent SDK, not for Claude Code, which includes its GitHub action
  ([API credits for Max, Ultra and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)),
  so the workflow as written couldn't have run on it.
- It was never run.

## Decision

- Remove the workflow and its guide (`claude-in-github.md`, in `docs/`), and the
  mentions in the other docs. The `deep-check-model` action stays: CI and
  **Keep caches** use it.
- The owner deletes the `claude` environment (and `claude-audit`, left from
  the first try) under **Settings → Environments**.
- Changes are made in Claude Code sessions. When the weekly limit runs out,
  work waits for it to reset (claude.ai → **Settings → Usage** shows when),
  or uses the plan's extra usage, which is paid separately.
- A workflow that runs Claude again needs a new ADR, and must answer 6H-1:
  never install or run a pull request's code in a job that holds a token or
  a key, or that runs on `main` (and so can write `main`'s caches).

## Consequences

- Nothing in this repository holds a Claude API key, and no workflow pushes
  with the Claude GitHub App's token.
- One less pinned action to read and update.
- When the weekly limit runs out, there's no way to keep working from
  GitHub: it waits, or costs extra usage.
- Audits that use the API run from a separate, private repository with its
  own key; nothing from there runs here.

## Alternatives

- **Fix the workflow:** refuse pull request branches, drop `id-token: write`,
  keep the token out of the checkout, and run `claude -p` (the Agent SDK's
  command line, which the monthly credit pays for). Possible later, with a
  new ADR, but it needs care, and Claude Code sessions do the same job now.
- **Keep it, with a warning not to run it on Dependabot's pull requests:** a
  rule that's easy to forget isn't a safeguard.
