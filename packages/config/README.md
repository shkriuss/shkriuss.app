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

A package with browser code has two configurations: `tsconfig.json`, the whole package, with Node's types for its tests, its build and its end-to-end tests, and `tsconfig.browser.json`, only `src/`, with the browser's types alone (`"types": ["vite/client"]`), so that nothing of Node's, such as `process` or `Buffer`, type-checks in code that runs in the browser. Its `typecheck` script runs both: `tsc && tsc -p tsconfig.browser.json`.

## End-to-end tests

`@shkriuss/config/playwright` is the Playwright setup that every app shares ([architecture §15](../../docs/architecture.md#15-quality)). An app's `playwright.config.ts` only chooses a port of its own:

```ts
import { playwrightConfig } from "@shkriuss/config/playwright";

export default playwrightConfig({ port: 4173 });
```

- **Browsers:** Chromium, Firefox and WebKit, each at phone and tablet size. In Claude Code cloud sessions, only the preinstalled Chromium runs, which `E2E_CHROMIUM_EXECUTABLE` points to; Firefox and WebKit run in CI.
- **The whole of Chromium:** the tests run Chromium as people have it, in its new headless mode, and not Playwright's default for tests without a window, its headless shell. That smaller build lacks Chrome's web app layer: it reads no app id from a manifest and never checks whether an app can be installed. CI installs no headless shell, so a test cannot run on it by mistake.
- **Server:** the production build in `dist/`, served by `wrangler dev` with the generated `_headers`, as Cloudflare serves it. Run `pnpm build` first. Each app has a port of its own (the hub 4173, the platform tests 4174), and Wrangler's devtools use that port plus 5100, so the tests of several apps can run at once.
- **One app at a time:** `pnpm e2e` runs each app's tests after the last one's (Turbo's `--concurrency=1`). All at once, they shared the machine's CPUs: in CI, a test that derives a backup's key, 256 MiB of scrypt, took Firefox four times as long and timed out. One at a time, each app's browsers have the machine to themselves, and all of them finish sooner. In CI, six jobs run at once, each one app at a time: a browser's projects, those whose name starts with the browser's, and half of their tests (Playwright's `--project` and `--shard`).
- **No retries:** a flaky test is fixed, never retried into passing ([ADR 0018](../../docs/decisions/0018-quality-gates-as-enforced.md)).
- **Firefox's storage prompt:** Firefox asks the user before it keeps a site's data until the user deletes it (`navigator.storage.persist()`), which a test cannot answer. Firefox's own testing preferences answer yes instead.

Tests import `test` and `expect` from the same module. Its `security` fixture fails every test in which a page or one of its workers reports a CSP or Trusted Types violation, logs an error, throws, or has a request fail. Workers report their violations on their console, with the code that `@shkriuss/edge` puts at the start of every worker script; Playwright passes on the service worker's in Chromium only. A test that provokes a refusal on purpose calls `security.expectRefusals()` and then checks the refusal itself, for example in `security.violations`.

A test that needs two devices, as to move data between them with backups, takes `otherDevice` besides `page`: a page in a browser context of its own, with its own storage, which `security` watches too.

A test of the app offline takes `network`, and opens the app at `network.url`: the app's server through a proxy, at an origin of its own. `network.cut()` then closes every connection, so every request that reaches the network fails, as on a device that is offline, while the service worker answers as it would there. Playwright's own `context.setOffline()` cannot stand in for it, as its WebKit then fails even the loads that the service worker answers. `network.hold(suffix)` holds back the requests for paths that end with `suffix`, such as a module, until the test lets them through. Every app's tests include one that works offline after the first visit.
