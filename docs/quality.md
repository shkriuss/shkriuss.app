# Quality checks

Everything runs in GitHub Actions on every pull request (`.github/workflows/ci.yml`).
On a computer, `pnpm verify` runs the same checks as the **Checks** job, in
the same order. The secret scan, workflow check, dependency audit,
package age check and the unit tests in German run only in GitHub Actions.

| Check                | Command                                                              | Fails when…                                                                                                                                                                                                                                                                                                              | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting           | `pnpm format:check`                                                  | A file isn't formatted by Prettier                                                                                                                                                                                                                                                                                       | Run `pnpm format`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Lint                 | `pnpm lint`                                                          | ESLint finds a bug pattern or an accessibility problem in `.astro` markup                                                                                                                                                                                                                                                | Fix the code; the message names the rule                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Types                | `pnpm typecheck`                                                     | TypeScript or `astro check` finds a type error                                                                                                                                                                                                                                                                           | Fix the types                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Unit tests           | `pnpm test`                                                          | A Vitest test fails. These cover app logic, storage, the registry, the generator, colour contrast, workflow pinning and the New app form's icon and colour lists, scoped styles reaching icons, `dir="auto"` on text boxes, no scripts in folders whose names start with a dot, and every link and file path in the docs | Read the failing test name; for the docs, fix the doc to name the file as it is now                                                                                                                                                                                                                                                                                                                                                                                 |
| Unit tests in German | `LC_ALL=de_DE.UTF-8 pnpm test`                                       | The same unit tests fail on a computer set to German: a test, or code, that works only in English (audit 3 J-5)                                                                                                                                                                                                          | Give the locale where the test formats a date or number (as the apps' tests do with `'en-US'`), instead of the computer's own                                                                                                                                                                                                                                                                                                                                       |
| Build                | `pnpm build`                                                         | A site doesn't build                                                                                                                                                                                                                                                                                                     | Read the error                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CSP safety + size    | `pnpm check:dist`                                                    | A page has inline `<script>`/`<style>`/`style=""`/`onclick=` or a `javascript:` link, its gzipped HTML/CSS/JS is over budget (20/15/35 KB; JS counts the files it imports), a word runs into or out of a link, a file is over Cloudflare's 25 MiB, a page loads from another site, or its offline copy is over 30 MB     | Move code into files; cut weight before raising a budget, for example by loading a part that opens rarely (a form, a dialog) with `import()` after the page ([adding-an-app.md](adding-an-app.md)); for a word running into a link, end the line before the link with `{' '}`, and put a space after a link too                                                                                                                                                     |
| Browser tests        | `pnpm test:e2e`                                                      | Playwright tests fail on a phone-sized Chromium against `wrangler dev`                                                                                                                                                                                                                                                   | Open the `playwright-report` artifact on the failed run. A test that fails and then passes on its one retry doesn't fail CI: it's listed as flaky in the run's “Playwright Run Summary”, with its first error. Fix it like a failure                                                                                                                                                                                                                                |
| Secrets              | gitleaks                                                             | Something that looks like a secret is in any commit                                                                                                                                                                                                                                                                      | Remove it, and replace the secret (it's leaked). A published example (like an RFC test key) goes in `.gitleaks.toml` instead, limited to that file and those exact values                                                                                                                                                                                                                                                                                           |
| Workflow security    | zizmor                                                               | A workflow has a risky pattern                                                                                                                                                                                                                                                                                           | Follow the linked advice                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dependency audit     | `pnpm audit --audit-level high`                                      | A dependency has a known high or critical vulnerability                                                                                                                                                                                                                                                                  | Merge the Dependabot fix. For a package only another package uses (like Astro's `zod`), Dependabot often can't with pnpm: a PR that runs `pnpm update -r <name>` does it, or an `overrides` entry in `pnpm-workspace.yaml` if that package asks for an exact version. If the fix is under 7 days old, or there is none yet, see [When a new advisory stops every merge](#when-a-new-advisory-stops-every-merge)                                                     |
| Package age          | `node scripts/lockfile-age.ts origin/main` (pull requests only)      | A pull request adds a package version published less than 7 days ago, a package from a web address or a git repository instead of the npm registry (or a registry version with a download address of its own), or a hash that isn't the npm registry's for that version                                                  | Wait until it's 7 days old, then re-run. For an urgent security fix, list the package under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, in a pull request of its own merged first (the check reads the list from `main`; while the audit fails too, see [below](#when-a-new-advisory-stops-every-merge)). For a package not from the registry: use a version from the npm registry instead. For a wrong hash: let pnpm write the lockfile (`pnpm install`) |
| Time limit           | The **Checks** job (`timeout-minutes` in `.github/workflows/ci.yml`) | The job runs longer than 30 minutes and is stopped: every check fails. Each new app adds about a minute of browser tests                                                                                                                                                                                                 | Never skip or remove tests to fit. Ask Claude to split the browser tests into groups of sites that run side by side (a matrix job, keeping one check that branch protection asks for), or, for now, raise `timeout-minutes` a little                                                                                                                                                                                                                                |

`pnpm check:dist` also reads every built script, the packages' code in it
too, as ES2022: the newest JavaScript syntax Safari 16.4 reads. A script
written in newer syntax fails it (audit 4 J-3). Write that code the ES2022
way, or leave out the package that brings it. It checks only the syntax:
a package that calls a function Safari 16.4 doesn't have (like
`Object.groupBy`) passes, so check that in the support tables. The type
check holds the code here to ES2022, functions included
(`tsconfig.base.json`). It also refuses a page that loads anything from
another website: a `link` (a `preconnect` or `dns-prefetch` hint too, which
the browser tests can't see), `script`, `img`, `iframe`, `source`, `video`
or `audio` whose address starts with `http://`, `https://` or `//`; plain
links (`<a href>`) and `canonical` links stay allowed. And it keeps each
site's offline copy, every file in `dist/` outside `on-demand/`, which the
service worker saves on the first visit, under 30 MB (Grammar's is about
21 MB, the others under 1 MB; audit 5 Z-4).

The package age check reads the lockfile as YAML, as pnpm reads it, so an
entry counts however it's written (audit 5 H-1). YAML that pnpm never
writes, and reads differently from the check, is refused in `pnpm-lock.yaml`
and `pnpm-workspace.yaml`: a `<<` merge key or a key written as a list
(either hid every package from the check while pnpm installed them), and
anchors (`&name`), aliases (`*name`), tags (`!name`) and `%` directives
(audit 6 H-2).

It also fails when a pull request adds an `.npmrc`, changes where pnpm
downloads from (a registry, proxy, certificate or `fetch…` setting in
`pnpm-workspace.yaml`), or adds code that pnpm runs itself: a config
dependency (`configDependencies`, in `pnpm-workspace.yaml` or in
`package.json`'s `pnpm` field, which pnpm installs whenever it starts, with
no 7-day wait), a `pnpmfile` setting or a `.pnpmfile.cjs` (audit 6 H-3).
Nothing here needs those, so ask Claude; the check has to allow it first, in
a pull request of its own.

The copy of the check that runs is `main`'s, in a folder outside the
checkout with `main`'s packages installed beside it (its YAML reader among
them), and it runs before any pnpm command in the pull request's checkout:
the **Dependency audit** job never installs the pull request's packages
(`pnpm audit` reads only the lockfile). So neither the pull request's code
nor its lockfile can change the check, or what reads the lockfile (audit 5
H-3, audit 6 H-1). The rules it applies (`minimumReleaseAge` and its
exceptions) are `main`'s too (audit 4 H-1).

What a pull request can change is CI itself: GitHub runs the pull
request's own copy of `.github/` (the workflows and the shared actions),
and `package.json`'s `packageManager` and `.node-version` choose which pnpm
and Node.js CI downloads. So read a pull request's changes to those like
code, whoever opened it, before merging; Dependabot's pull requests change
only version numbers and pins there.

The unit test that checks the workflows' pins (`tests/unit/workflows.test.ts`)
reads them as YAML, as GitHub does, so a step written any way GitHub accepts
is seen (audit 5 H-4). It only checks that each `uses:` names a 40-character
commit; whether that commit really belongs to the action is zizmor's online
check in CI, so a commit from someone's copy of an action passes the unit
test and fails only there.

## When a new advisory stops every merge

`pnpm audit` checks every dependency, the build and test tools too, and
**Dependency audit** must pass to merge and to deploy. So a new high or
critical advisory stops every pull request, and every deploy, until it's
dealt with. Usually the fix is a version published that day: for 7 days
Dependabot can't propose it, and the package age check refuses it. Listing
the package under `minimumReleaseAgeExclude` on its own doesn't help, since
that pull request still has the old version, so its own audit fails too
(audit 6 H-4). Instead (ask Claude):

1. **A pull request of its own, merged first:** in `pnpm-workspace.yaml`,
   list the advisory's ID under `auditConfig` → `ignoreGhsas`, with a
   comment saying what it is and why it's ignored for now, and, if a fixed
   version exists, the package under `minimumReleaseAgeExclude`. pnpm reads
   the ignore list from the pull request, so its audit passes, and `main`
   deploys again once it's merged:

   ```yaml
   auditConfig:
     ignoreGhsas:
       # <package>: <what the advisory is>. Ignored until the fix is merged.
       - GHSA-xxxx-xxxx-xxxx
   minimumReleaseAgeExclude:
     - <package>
   ```

2. **The update:** a pull request that runs `pnpm update -r <package>` (or
   an `overrides` entry, for a package only another package uses). The
   package age check reads the exception from `main`, so it passes. With
   the fix in, the audit passes without the ignore entry, so remove it here.
3. **Once the fixed version is 7 days old,** remove the
   `minimumReleaseAgeExclude` entry. Until then Dependabot's updates may
   fail: it applies its 7-day wait to the whole lockfile
   ([ADR 0005](adr/0005-pnpm-typescript-versions.md)).

If there's no fix yet, step 1 alone lets work go on; the ignore entry stays
until there is one. Check first what the advisory can reach: one in a tool
that only runs in CI (ESLint, say) can't affect a page or a Worker. A
moderate or low advisory doesn't stop anything (`--audit-level high`).

## What the shared browser tests cover (every site, automatically)

- **Accessibility:** axe-core with WCAG 2.0/2.1/2.2 A and AA rules plus best
  practices, on every page reachable from the home page (and the 404 page),
  in **light and dark** mode; one `<h1>`, a `lang` and a title on every page;
  the skip link works; no sideways scrolling at 320px wide, or at 360px with
  text at 200% (also apps' pages with things in them, and their dialogs,
  with no text squeezed into a column of letters:
  `tests/e2e/large-text.spec.ts`); footer links (and “What sync sends, and
  where”) are big enough to tap; the theme switch works, is remembered, and
  shows which option has focus (in Windows contrast themes too).
- **Keyboard focus:** in apps with lists, focus stays on the same control
  when a list is drawn again after a change in another tab (the same as a
  change from sync), when a dialog closes after that, and when Budget and
  Trades are opened again (`tests/e2e/keep-focus.spec.ts`).
- **Security:** every security header is present on pages, the 404 page and
  other files; no console errors (so no CSP or Trusted Types violations); no
  cookies; no requests to any other website; build files, pages, and a "not
  found" for a build file are never kept without asking the server again
  (audit 5 Z-1); every site serves its own `robots.txt` (audit 5 I-1).
- **Install and offline:** the manifest and every icon load, and the site
  works offline after the first visit, including when the network hangs
  instead of failing (for example, airplane mode with a VPN on): it waits 3
  seconds for the network, then opens the saved copy (the test allows 8).
- **Not found:** unknown pages return status 404 with a helpful page.
- **Your data:** on sites that save data, a locked backup restores only with
  its passphrase, a plain copy restores, other files are turned down (the
  Restore dialog reads out why, or its warning, as it opens), and focus
  stays on **Download backup**.
- **Saving:** when the browser won't save, the app says so, on screen and out
  loud (each app's change is listed in `tests/e2e/saving.spec.ts`).
- **Notifications and sync:** on apps that have them, turning them on and off
  works, including when notifications are blocked, on an iPhone, and after
  the account key is replaced.

The tests that need something from each app (the large-text, focus and
saving ones) have a table with a line for every site, `null` where a test
can't apply; a site missing from a table fails the test, so no app is
skipped without a word (`tests/e2e/every-site.ts`, audit 3 J-11).

## Tools Dependabot can't update

Dependabot keeps the npm packages, the GitHub Actions and zizmor
(`.github/zizmor/requirements.txt`) up to date. Two tools are pinned by hand,
so check them for a new version every few months (last checked 24 October
2026):

- **gitleaks**: `GITLEAKS_VERSION` and `GITLEAKS_SHA256` in
  `.github/workflows/ci.yml`. Take the checksum from the release's
  `checksums.txt` for `linux_x64.tar.gz`; CI refuses a download that doesn't
  match.
- **pnpm**: `packageManager` in `package.json`. Stay on pnpm 10 until
  [ADR 0005](adr/0005-pnpm-typescript-versions.md) says otherwise.

## Manual checks (before calling an app "done")

Automated tools catch only some accessibility problems. Also check:

- Use the app with only a keyboard (Tab, Shift+Tab, Enter, Space, Esc).
- Use it with a screen reader (VoiceOver on iPhone or iPad, TalkBack on
  Android): every control has a clear name and changes are announced.
- Zoom to 200%, and set the phone's text size to the largest setting.
- Turn on reduced motion and high contrast.
- Install it to the home screen and use it in airplane mode.

## Why no Lighthouse?

Lighthouse scores vary on shared CI machines, and it's a large dependency.
Exact byte budgets (`check:dist`) catch the same regressions without random
failures. See [ADR 0007](adr/0007-testing-strategy.md).
