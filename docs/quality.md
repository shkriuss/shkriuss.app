# Quality checks

Everything runs in GitHub Actions on every pull request (`.github/workflows/ci.yml`).
On a computer, `pnpm verify` runs the same checks in the same order.

| Check             | Command                         | Fails when…                                                                                                             | What to do                                               |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Formatting        | `pnpm format:check`             | A file isn't formatted by Prettier                                                                                      | Run `pnpm format`                                        |
| Lint              | `pnpm lint`                     | ESLint finds a bug pattern or an accessibility problem in `.astro` markup                                               | Fix the code; the message names the rule                 |
| Types             | `pnpm typecheck`                | TypeScript or `astro check` finds a type error                                                                          | Fix the types                                            |
| Unit tests        | `pnpm test`                     | A Vitest test fails. These cover app logic, storage, the registry, the generator, colour contrast, and workflow pinning | Read the failing test name                               |
| Build             | `pnpm build`                    | A site doesn't build                                                                                                    | Read the error                                           |
| CSP safety + size | `pnpm check:dist`               | A page has inline `<script>`/`<style>`/`style=""`/`onclick=`, or its gzipped HTML/CSS/JS is over budget (20/15/25 KB)   | Move code into files; cut weight before raising a budget |
| Browser tests     | `pnpm test:e2e`                 | Playwright tests fail on a phone-sized Chromium against `wrangler dev`                                                  | Open the `playwright-report` artifact on the failed run  |
| Secrets           | gitleaks                        | Something that looks like a secret is in any commit                                                                     | Remove it, and replace the secret (it's leaked)          |
| Workflow security | zizmor                          | A workflow has a risky pattern                                                                                          | Follow the linked advice                                 |
| Dependency audit  | `pnpm audit --audit-level high` | A dependency has a known high or critical vulnerability                                                                 | Merge the Dependabot fix, or update the package          |

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
