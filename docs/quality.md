# Quality checks

Everything runs in GitHub Actions on every pull request (`.github/workflows/ci.yml`).
On a computer, `pnpm verify` runs the same checks in the same order.

| Check             | Command                         | Fails when…                                                                                                                                                                                                        | What to do                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting        | `pnpm format:check`             | A file isn't formatted by Prettier                                                                                                                                                                                 | Run `pnpm format`                                                                                                                                                                                                                                                    |
| Lint              | `pnpm lint`                     | ESLint finds a bug pattern or an accessibility problem in `.astro` markup                                                                                                                                          | Fix the code; the message names the rule                                                                                                                                                                                                                             |
| Types             | `pnpm typecheck`                | TypeScript or `astro check` finds a type error                                                                                                                                                                     | Fix the types                                                                                                                                                                                                                                                        |
| Unit tests        | `pnpm test`                     | A Vitest test fails. These cover app logic, storage, the registry, the generator, colour contrast, and workflow pinning                                                                                            | Read the failing test name                                                                                                                                                                                                                                           |
| Build             | `pnpm build`                    | A site doesn't build                                                                                                                                                                                               | Read the error                                                                                                                                                                                                                                                       |
| CSP safety + size | `pnpm check:dist`               | A page has inline `<script>`/`<style>`/`style=""`/`onclick=`, its gzipped HTML/CSS/JS is over budget (20/15/35 KB; JS counts the files it imports), a word runs into a link, or a file is over Cloudflare's 25 MiB | Move code into files; cut weight before raising a budget; for a word running into a link, end the line before the link with `{' '}`                                                                                                                                  |
| Browser tests     | `pnpm test:e2e`                 | Playwright tests fail on a phone-sized Chromium against `wrangler dev`                                                                                                                                             | Open the `playwright-report` artifact on the failed run. A test that fails and then passes on its one retry doesn't fail CI: it's listed as flaky in the run's “Playwright Run Summary”, with its first error. Fix it like a failure                                 |
| Secrets           | gitleaks                        | Something that looks like a secret is in any commit                                                                                                                                                                | Remove it, and replace the secret (it's leaked). A published example (like an RFC test key) goes in `.gitleaks.toml` instead, limited to that file and those exact values                                                                                            |
| Workflow security | zizmor                          | A workflow has a risky pattern                                                                                                                                                                                     | Follow the linked advice                                                                                                                                                                                                                                             |
| Dependency audit  | `pnpm audit --audit-level high` | A dependency has a known high or critical vulnerability                                                                                                                                                            | Merge the Dependabot fix. For a package only another package uses (like Astro's `zod`), Dependabot often can't with pnpm: a PR that runs `pnpm update -r <name>` does it, or an `overrides` entry in `pnpm-workspace.yaml` if that package asks for an exact version |

## What the shared browser tests cover (every site, automatically)

- **Accessibility:** axe-core with WCAG 2.0/2.1/2.2 A and AA rules plus best
  practices, on every page reachable from the home page (and the 404 page),
  in **light and dark** mode; one `<h1>`, a `lang` and a title on every page;
  the skip link works; no sideways scrolling at 320px wide; the theme switch
  works and is remembered.
- **Security:** every security header is present on pages, the 404 page and
  other files; no console errors (so no CSP or Trusted Types violations); no
  cookies; no requests to any other website; build files are cached and pages
  aren't.
- **Install and offline:** the manifest and every icon load, and the site
  works offline after the first visit, including when the network hangs
  instead of failing (for example, airplane mode with a VPN on): it then opens
  the saved copy within 3 seconds.
- **Not found:** unknown pages return status 404 with a helpful page.

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
