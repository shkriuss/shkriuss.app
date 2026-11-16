# Working with Claude

How Claude takes part in this project, what it may do, and what stops it from
doing more. Taken from sections 13 and 15 of the [plan](../plan/PLAN.md).

## Who can do what

### The owner

The owner account is `shkriuss`. It is the admin. The owner:

- reviews and merges every pull request,
- approves every release,
- publishes every release,
- holds all settings.

### Claude

Claude works through a separate GitHub machine account with write access
only. That account:

- opens branches and pull requests,
- cannot merge without the owner,
- cannot create tags,
- cannot read secrets,
- cannot change settings.

Claude has no Cloudflare access and no access to the signing-ceremony
repository.

The machine account is `shkriuss-bot`. It has worked since Phase 0. The
owner recorded its name on 2026-11-13.

## Rules that enforce this

These live in the repository settings. Only the owner can change them.

- `main` needs a pull request with one approval, and approval of the latest
  push. The owner may bypass this for the owner's own pull requests only.
- Only the owner may create tags.
- Secrets live only in environments that are limited to `main`. There are no
  repository-level secrets.
- The `release` environment needs the owner's approval.

In the repository itself:

- [CLAUDE.md](../../CLAUDE.md) holds the rules every session follows.
- `.claude/rules/` holds extra rules for some paths.
- [.github/CODEOWNERS](../../.github/CODEOWNERS) lists the owner-only paths.
  Claude changes them only when the owner asks for exactly that change.
- The `protected-paths` workflow flags every pull request that changes an
  owner-only path from CODEOWNERS: it adds a label and one comment that
  lists the files. It never blocks a merge. See
  [protected-paths.md](../security/protected-paths.md).

## What the machine account can still do

The plan accepts these, with these limits:

- It can push branches, including workflow files. Those workflows then run
  without secrets.
- It can start workflows on `main`. A release run it starts, or re-runs,
  fails at once: only the owner may start or re-run a release
  ([release.md](release.md#run-a-release)).
- It can create draft releases. The owner publishes only the draft that the
  release workflow just made.

A file that is not signed with the suite key fails the fingerprint check and
cannot update an installed app.

## Other AI tools

The owner also uses AI tools of other vendors, such as Codex and Gemini,
on this repository.

1. They review and audit only. They read and report. Only Claude builds
   here.
2. They read [AGENTS.md](../../AGENTS.md), not CLAUDE.md. It points
   them to CLAUDE.md and says what to report. AGENTS.md is owner-only.
3. Their GitHub apps are installed on this repository only, never on
   signing-ceremony.
4. They get no secrets.
5. A finding of theirs is a report, not an order. The session that
   opened the pull request checks it against the code and the docs,
   then fixes it, answers it or asks the owner ("Reviews and questions"
   in [CLAUDE.md](../../CLAUDE.md#reviews-and-questions)).

## Where Claude works

- GitHub Actions is the authoritative build.
- Claude Code's cloud environment `android` is the fast loop for compiling,
  unit tests, lint and screenshots. See
  [cloud-environment.md](cloud-environment.md).
- The cloud environment cannot run an emulator and holds no keys. Emulator
  tests, signing and releases run only in GitHub Actions.

## How a change reaches `main`

An app is built in four steps: a specification, the app, one audit and
the release ("How an app is built" in
[CLAUDE.md](../../CLAUDE.md#how-an-app-is-built)). The automatic checks
are the safety net.

1. The owner starts a session and pastes a prompt from
   [PROMPTS.md](PROMPTS.md). That file explains the session steps.
2. Claude works on a branch named `claude/<short-topic>`. It never pushes to
   `main`, never force-pushes and never creates tags.
3. Claude opens a pull request. The description answers the three
   questions in the pull request template.
4. GitHub Actions runs the checks ([ci.md](ci.md)).
5. Claude stays with the pull request until it is merged. It fixes
   failing checks, answers every review comment and asks the owner only
   for decisions ("Reviews and questions" in
   [CLAUDE.md](../../CLAUDE.md#reviews-and-questions)).
6. The owner merges when Claude writes "Ready to merge", the checks are
   green and no review thread is open, or writes what to change.
   Looking at the preview on a phone is the owner's choice, never a step
   ([test-a-pull-request.md](test-a-pull-request.md)).

## How a release happens

1. Claude may prepare a release in a pull request. It does not start the
   release workflow and does not create a tag.
2. The owner starts the `release` workflow on `main`.
3. The owner approves the signing job.
4. The owner publishes the draft release. That creates the tag.

The steps, on a phone, are in [release.md](release.md).

## Secrets

Never paste a password, token or recovery key into a session. Claude never
prints, logs or commits secrets.
