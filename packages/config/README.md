# @shkriuss/config

Shared configuration for every package and app in the monorepo: TypeScript settings, and the end-to-end test setup.

## TypeScript

| File                 | Use it for                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `tsconfig/base.json` | Strictest TypeScript settings; code that is bundled (Vite) or type-only |
| `tsconfig/app.json`  | Browser apps: `base.json` plus the DOM and React's JSX                  |
| `tsconfig/node.json` | Scripts that Node.js runs directly as `.ts` (native type stripping)     |

Extend one of them from a package's `tsconfig.json`:

```json
{ "extends": "@shkriuss/config/tsconfig/node.json", "include": ["src"] }
```

Relative imports always include the file extension (`./file.ts`), so the same source works in Node.js, Vite and Vitest.

## End-to-end tests

`@shkriuss/config/playwright` is the Playwright setup that every app shares ([architecture §15](../../docs/architecture.md#15-quality)). An app's `playwright.config.ts` only chooses a port of its own:

```ts
import { playwrightConfig } from "@shkriuss/config/playwright";

export default playwrightConfig({ port: 4173 });
```

- **Browsers:** Chromium, Firefox and WebKit, each at phone and tablet size. In Claude Code cloud sessions, only the preinstalled Chromium runs, which `E2E_CHROMIUM_EXECUTABLE` points to; Firefox and WebKit run in CI.
- **The whole of Chromium:** the tests run Chromium as people have it, in its new headless mode, and not Playwright's default for tests without a window, its headless shell. That smaller build lacks Chrome's web app layer: it reads no app id from a manifest and never checks whether an app can be installed. CI installs no headless shell, so a test cannot run on it by mistake.
- **Server:** the production build in `dist/`, served by `wrangler dev` with the generated `_headers`, as Cloudflare serves it. Run `pnpm build` first. Each app has a port of its own (the hub 4173, the platform tests 4174), and Wrangler's devtools use that port plus 5100, so the tests of several apps can run at once.
- **One app at a time:** `pnpm e2e` runs each app's tests after the last one's (Turbo's `--concurrency=1`). All at once, they shared the machine's CPUs: in CI, a test that derives a backup's key, 256 MiB of scrypt, took Firefox four times as long and timed out. One at a time, each app's browsers have the machine to themselves, and all of them finish sooner.
- **No retries:** a flaky test is fixed, never retried into passing ([ADR 0008](../../docs/decisions/0008-quality-gates.md)).
- **Firefox's storage prompt:** Firefox asks the user before it keeps a site's data until the user deletes it (`navigator.storage.persist()`), which a test cannot answer. Firefox's own testing preferences answer yes instead.

Tests import `test` and `expect` from the same module. Its `security` fixture fails every test in which the page reports a CSP or Trusted Types violation, logs an error, throws, or has a request fail. A test that provokes a refusal on purpose calls `security.expectRefusals()` and then checks the refusal itself, for example in `security.violations`.
