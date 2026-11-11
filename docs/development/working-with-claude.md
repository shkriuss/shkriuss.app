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

Open: the plan lists the machine account as pending the smoke test
(Session 0 in [PROMPTS.md](PROMPTS.md)). The account's name is not recorded
yet.

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
- A planned `protected-paths` workflow will flag pull requests that touch
  workflows, signing or dependency verification.

## What the machine account can still do

The plan accepts these, with these limits:

- It can push branches, including workflow files. Those workflows then run
  without secrets.
- It can start workflows on `main`.
- It can create draft releases. The owner publishes only the draft that the
  release workflow just made.

A file that is not signed with the suite key fails the fingerprint check and
cannot update an installed app.

## Where Claude works

- GitHub Actions is the authoritative build.
- Claude Code's cloud environment `android` is the fast loop for compiling,
  unit tests, lint and screenshots. See
  [cloud-environment.md](cloud-environment.md).
- The cloud environment cannot run an emulator and holds no keys. Emulator
  tests, signing and releases run only in GitHub Actions.

## How a change reaches `main`

1. The owner starts a session and pastes a prompt from
   [PROMPTS.md](PROMPTS.md). That file explains the session steps.
2. Claude works on a branch named `claude/<short-topic>`. It never pushes to
   `main`, never force-pushes and never creates tags.
3. Claude opens a pull request. The description answers the four questions
   in the pull request template.
4. GitHub Actions runs the checks ([ci.md](ci.md)).
5. The owner reviews the change, checks it on a phone
   ([test-a-pull-request.md](test-a-pull-request.md)), and then approves
   and merges it, or writes what to change.

## How a release happens

1. Claude may prepare a release in a pull request. It does not start the
   release workflow and does not create a tag.
2. The owner starts the `release` workflow on `main`.
3. The owner approves the signing job.
4. The owner publishes the draft release. That creates the tag.

## Secrets

Never paste a password, token or recovery key into a session. Claude never
prints, logs or commits secrets.
