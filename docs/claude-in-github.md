# Asking Claude from GitHub

The **Claude** workflow (`.github/workflows/claude.yml`) runs Claude Code
inside GitHub Actions, paid for by your Claude API balance instead of your
Claude subscription. Use it when the subscription's weekly limit has run out,
or for small jobs you'd rather start with a tap: "CI failed on this pull
request, fix it".

Claude works with this repository's rules (`CLAUDE.md`), reads the code and
what CI said, runs the quick checks, and pushes its change. CI then checks
everything it pushed, and nothing reaches the live sites until you merge.
Why it's set up this way: [ADR 0020](adr/0020-claude-in-github-actions.md).

## Setup (one time)

1. **In the Claude Console** ([platform.claude.com](https://platform.claude.com)):
   - In the billing settings, make sure **automatic reload** (auto-recharge)
     is off. Then Claude can never spend more than the balance you've put in.
   - Create an API key and name it `shkriuss-github`. Copy it (it's shown once).
2. **On GitHub: Settings → Environments → New environment**, named `claude`:
   - **Deployment branches and tags:** **Selected branches and tags**, then
     add `main`. Only `main`'s workflows can then use the key, so a branch
     can't change the workflow to read it.
   - **Environment secrets → Add environment secret:** name
     `ANTHROPIC_API_KEY`, and paste the key.
   - Optional: **Required reviewers** (you). Each run then waits for you to
     tap **Approve** first: a second check before anything is spent.
3. **The Claude GitHub App** must be installed on the repository. It already
   is if you use Claude Code sessions with this repository; if not, install
   it from [github.com/apps/claude](https://github.com/apps/claude).
4. If **Settings → Environments** still lists `claude-audit`, delete it: the
   workflow that used it is gone.

## Using it

1. **Actions → Claude → Run workflow.**
2. **What should Claude do?** In plain words, as in a chat. For example:
   _"CI failed on this pull request. Find out why and fix it."_
3. **Number of the pull request** to work on, like `96`, or leave it empty.
4. Tap **Run workflow**, then open the run. It takes from a few minutes to
   about half an hour.

What happens next:

- **With a pull request:** Claude starts from that pull request's branch, with
  its description and, if CI failed, the log of what failed. It pushes its fix to the
  same branch, and CI runs again on the pull request.
- **Without one:** Claude makes a new branch from `main` (named `claude/…`)
  and pushes it. Open the link in its summary to create the pull request.
- **Its summary** is on the run's page: what it changed, what it checked,
  and anything you need to do. If the request was unclear or too big, it
  changes nothing and says what it needs.

Only one run goes at a time: a second one waits for the first.

## What it costs

- **GitHub Actions** is free, because the repository is public.
- **The Claude API** charges for the text Claude reads and writes, counted
  in tokens. The workflow uses Claude Opus 5.5: $4 per million tokens read
  and $20 per million written (Claude Sonnet 5.5 is half that; Claude Fable
  5.1 two and a half times it). Most of what Claude reads in a run is the
  same text again, which is cached and costs a fraction of that.
- A run can take at most 60 turns (one turn is one step: reading a file,
  making an edit, running a check) and 45 minutes. A small fix is often a few
  dollars; this is an estimate, so look at the Console's usage page after
  your first runs.
- To use another model, change `--model` in the workflow (ask Claude to).
  To pay with your subscription instead of the API, the workflow can take a
  `CLAUDE_CODE_OAUTH_TOKEN` in place of the API key. Those runs then count
  against the subscription's limits.

## What it can and can't do

- It runs the quick checks: formatting, lint, types, unit tests, build, and
  size and CSP. It can't run the browser tests (`pnpm test:e2e`); CI runs
  them on everything it pushes.
- It can push to branches, never to `main` (the `main` ruleset needs a pull
  request), and it doesn't open or merge pull requests: you do.
- It can't change a workflow: the token it pushes with doesn't have
  GitHub's "workflows" permission.
- It never has the Cloudflare token, which only the deploy job on `main`
  gets.
- Only people who can write to the repository (you) can start it, and it
  refuses pull requests from other people's copies of the repository.
- It runs the branch's own code (the tests), so use it only on branches you
  trust: yours, and Claude's. The commands it runs don't see the API key.

## Turning it off

Any one of these is enough:

- **Actions → Claude → ··· → Disable workflow** (turn it back on there).
- Delete the `ANTHROPIC_API_KEY` secret from the `claude` environment.
- Delete the key in the Claude Console. That stops it everywhere at once,
  and it's what to do if you think the key has leaked.

## When something goes wrong

| What you see                                               | What it means, and what to do                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| An error about the API key or authentication               | The `ANTHROPIC_API_KEY` secret is missing from the `claude` environment, or the key was deleted      |
| "Could not fetch an OIDC token", or a GitHub App error     | The Claude GitHub App isn't installed on the repository (Setup, step 3)                              |
| An error about the credit balance                          | The balance has run out: add credit in the Console, or wait for your subscription's limit to reset   |
| "Not a number", "Not open" or "Someone else's copy"        | The pull request number was mistyped, the pull request is already merged or closed, or it's not ours |
| The run stopped before it finished (turns or time ran out) | Ask for a smaller step, for example one failing test at a time                                       |
| The run is waiting for approval                            | **Required reviewers** is on for the `claude` environment: tap **Review deployments → Approve**      |
