# Protected-paths flag

A workflow that tells the owner when a pull request changes a path that only
the owner may change. Those paths are listed in
[CODEOWNERS](../../.github/CODEOWNERS): the workflows, `CLAUDE.md`, the
Claude rules, dependency verification, the Gradle wrapper, the repository
list, the build checks for hard rules 2, 3 and 4, the record rules checks,
the runner of the emulator tests with its plugin and its suite check,
signing files and the signing certificate fingerprint.

The flag is a notice. It never blocks a merge. The gate is the owner's
review ([working-with-claude.md](../development/working-with-claude.md)).

Workflow: [`protected-paths.yml`](../../.github/workflows/protected-paths.yml).

## What it does

It runs when a pull request is opened or reopened, after every push to it,
and when its base branch changes. Then:

1. It reads CODEOWNERS from `main`. Never the pull request's copy.
2. It reads the list of changed files through the GitHub API.
3. It checks every changed file against CODEOWNERS. For a renamed file it
   checks the old name too, so moving a file out of `.github/` is flagged.
4. If at least one file is owner-only:
   - It adds the red label `protected-paths`.
   - It writes one comment, **Owner-only paths**. The comment lists each
     file, what happened to it (added, changed, deleted, renamed), and the
     CODEOWNERS rule that makes it owner-only.
5. After a new push it updates the same comment. If no owner-only file is
   left, the comment says so. The workflow never removes the label, so a
   change that was added and then reverted still leaves a mark. The
   owner's decision on
   [pull request 7](https://github.com/shkriuss/shkriuss.app/pull/7).
6. It also flags the owner's own pull requests.

The check **Protected paths / Flag owner-only paths** passes when it flags.
It fails, with a red cross, only when it cannot do its work. It is not a
required check.

## On your phone

1. GitHub notifies you when the comment is first written, like any other
   comment on a pull request you watch.
2. In the list of pull requests, flagged ones carry the red label
   `protected-paths`. To see only those, open
   `github.com/shkriuss/shkriuss.app/pulls?q=is:pr+is:open+label:protected-paths`
   and bookmark it.
3. Open the comment. Then tap **Files changed** and read each listed file.
4. Before you approve, look at the comment again. Its last line names the
   commit it checked. That must be the newest commit of the pull request.
5. When you have checked, you may remove the label. A new push that still
   changes an owner-only path adds it again.

## What it protects against

- Missing an owner-only change among many other files.
- A renamed or deleted owner-only file.
- A pull request that changes CODEOWNERS or this workflow to hide itself.
  The flag uses the copies on `main`, so such a change does nothing until
  it is merged. And both files are owner-only, so the change is flagged.
- A pull request from a fork or from Claude's machine account changing how
  the flag treats it. With `pull_request_target`, GitHub runs the workflow
  file from the default branch, not from the pull request.
- File names made to mislead. Each name is shown as code, so it cannot
  become a link, a mention, a heading or hidden HTML. Invisible characters
  and characters that change the direction of text are shown as
  `\u{...}`, for example `\u{202e}`. File names are never run, never put
  into a shell line and never printed to the log.
- A pull request with more than 3000 changed files. GitHub lists only the
  first 3000. The flag then labels the pull request anyway and says that
  not every file was checked.

## What it does not protect against

1. **It does not block anything.** A flagged pull request can still be
   merged. Only your review and the branch rules stop a merge.
2. **It does not judge a change.** It says which owner-only files changed,
   not whether the change is safe. Read the change.
3. **It only knows the paths in CODEOWNERS.** A harmful change anywhere
   else is not flagged: app and library code, other build files such as a
   module's `build.gradle.kts` or `android/gradle/libs.versions.toml`,
   `tools/`, `backend/`, `site/` and `docs/`. A new dependency also changes
   `verification-metadata.xml`, which is flagged.
4. **It does not stop what runs before you look.** CI and PR preview run
   the pull request's own copy of their workflow files. A pull request that
   changes one of them runs its changed version at once. Those runs have a
   read-only token and no secrets
   ([ci.md](../development/ci.md#what-a-pull-request-can-do-in-these-workflows)).
   The flag only tells you about it.
5. **Later changes may not notify you.** GitHub notifies you when the
   comment is written. An update to it usually sends no new notification.
   The branch rule that the latest push must be approved makes you review
   again. Read the comment again before you approve.
6. **Anyone with write access can remove the label, or edit or delete the
   comment.** That includes Claude's machine account. GitHub shows a removed
   label and a deleted comment in the pull request's timeline. Edits are in
   the comment's **edited** history. The next push writes the label and a
   new comment again.
7. **It trusts CODEOWNERS on `main`.** A path that is missing there is not
   flagged. The flag reads the patterns itself, by GitHub's documented
   rules. GitHub's own reading, which requests your review, is the
   authority. The two were compared with Git's own matching (below). They
   can still differ for patterns that GitHub does not support: `!`, `[ ]`,
   and `\#` at the start of a line. GitHub also skips a line with an error
   in it. Keep CODEOWNERS simple, as it is today.
8. **No label does not prove that no owner-only file changed.** The flag is
   missing if the run failed, if GitHub Actions was down or turned off, or
   if GitHub did not start the workflow. GitHub does not start
   `pull_request_target` workflows for some branch names, such as names
   that look like a commit SHA. Check **Files changed** yourself.
9. **It does not cover the account or the settings.** It cannot help
   against a stolen owner account, a change to the repository settings or
   a direct push to `main`. The ruleset on `main` blocks direct pushes.
10. **It sees file names, not contents.** It does not look inside files.

## How it is built

1. `pull_request_target` runs the workflow file from the default branch.
   `GITHUB_SHA` is the newest commit on the default branch. The flag reads
   CODEOWNERS at exactly that commit. On GitHub.com this holds for every
   pull request, whatever its base branch.
2. The job never checks out code and uses no action. It is one shell step
   that calls the GitHub API with `gh` and handles the data with `jq`. Both
   come with GitHub's runners.
3. The workflow starts with `permissions: contents: read`, like every
   workflow here. The job replaces that with exactly two permissions:
   - `contents: read`, only for reading CODEOWNERS from the default branch
     through the API. It is never used to check out code. In a public
     repository it grants nothing new. With it, the flag also works if the
     repository is made private. The owner's decision on
     [pull request 7](https://github.com/shkriuss/shkriuss.app/pull/7).
   - `pull-requests: write`, for every other call: reading the pull
     request, its files, its comments and the label, and writing the label
     and the comment.
4. File names travel only as JSON: from the API into `jq`, and from `jq`
   into the JSON sent back to the API. The log shows only counts.
5. The workflow keeps one comment. It finds that comment by a hidden marker
   and by its author, GitHub Actions. It never edits anyone else's comment.
   If listing the comments fails, the run stops, so it never writes a
   second one. An unchanged comment is not written again.
6. Runs for the same pull request wait for each other and are never
   cancelled half-way through. A run stops without writing if a newer
   commit was pushed: the newer push has its own run. The pull request is
   read again after the file list, so the list belongs to the commit that
   the comment names.
7. At most 100 files are listed in the comment, and a name is cut after 300
   characters, so the comment stays under GitHub's size limit. The rest are
   counted.

## How it was tested

Before the first merge, in the cloud environment:

1. The shell step, taken straight from the workflow file, ran against a
   stand-in for the GitHub API. Fifteen cases passed: a first flag, a
   re-run with no change, a push that removes every owner-only file, a
   newer push during the run, more than 3000 files, 150 owner-only files,
   very long names, CODEOWNERS in another place or missing, failed API
   calls, and file names with line breaks, backticks, mentions, links,
   HTML and hidden characters.
2. The comments were rendered with `cmark-gfm`, the Markdown library
   GitHub uses. The only links were the workflow's own three.
3. The pattern matching was compared with Git's own `.gitignore` matching
   for 34 patterns and 48 paths. They agreed, except for `docs/*`, where
   GitHub documents that nested files do not match.
4. `actionlint` with `shellcheck` found no problems.

The workflow cannot run on the pull request that adds it, because it is not
on `main` yet. To check it after merging, on a phone:

1. Open `github.com/shkriuss/shkriuss.app/blob/main/CLAUDE.md` in the
   browser.
2. Tap the pencil to edit. Add an empty line at the end.
3. Tap **Commit changes**. Choose **Create a new branch**, name it
   `test-protected-paths`, and tap **Propose changes**.
4. Tap **Create pull request**.
5. Wait a minute. The pull request gets the label `protected-paths` and
   the comment **Owner-only paths**, which lists `CLAUDE.md`.
6. Close the pull request without merging. Tap **Delete branch**.

## Changing it

- To protect another path, add it to CODEOWNERS. The flag follows
  CODEOWNERS on `main` as soon as that change is merged. The workflow
  needs no change.
- The workflow file is owner-only. Claude changes it only when the owner
  asks for exactly that change.
