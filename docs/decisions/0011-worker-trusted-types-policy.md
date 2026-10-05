# ADR 0011: One Trusted Types policy for worker scripts

- **Status:** Proposed
- **Date:** 2026-10-05

## Context

[ADR 0007](0007-security-baseline.md) allows no Trusted Types policies (`trusted-types 'none'`), and any exception needs an ADR. Under `require-trusted-types-for 'script'`, the script of a worker is a Trusted Types sink: `new Worker()`, `navigator.serviceWorker.register()` and `importScripts()` refuse a plain string and accept only a TrustedScriptURL, which only a policy can create. With no policy, an app cannot start any worker ([ADR 0010](0010-script-integrity.md)).

Phase 1 needs two kinds of worker:

- **the service worker** of `@shkriuss/pwa`, which makes every app work offline ([architecture §9](../architecture.md#9-offline-install-and-updates));
- **a dedicated worker** in `@shkriuss/backup`, which encrypts and decrypts backups. Deriving the key takes seconds and 256 MiB on a phone, and must not freeze the page ([backup format §3.1](../specs/backup-format.md#31-passphrases)).

A spike in Chromium with the production headers found the first three points below. The end-to-end tests of this decision (point 6) confirmed them in all three engines: Chromium 153, Firefox 155 and WebKit 26.6, in Playwright's builds of October 2026.

- **A named policy works:** a worker and a service worker start from the TrustedScriptURLs it creates, under the full header set: `require-trusted-types-for 'script'`, `Integrity-Policy`, COOP and COEP.
- **Names are enforced:** without `'allow-duplicates'`, the browser refuses a second policy of the same name, and any name the Content-Security-Policy does not list.
- **A worker runs under the policy of its own script's response**, so the Content-Security-Policy and Trusted Types apply inside it too: in all three engines, code in a worker or a service worker cannot create a policy that the Content-Security-Policy does not list.
- **Browsers check no integrity for worker scripts.** `Integrity-Policy: blocked-destinations=(script)` covers requests whose destination is `script`; worker and service worker scripts have the destinations `worker` and `serviceworker`. Neither `new Worker()` nor `register()` takes an integrity value, and import maps do not apply to workers.

## Decision

1. **One policy, `shkriuss-workers`, created only by `@shkriuss/edge/workers`.** Apps start workers with its `startWorker()` and register the service worker with its `registerServiceWorker()`. They never create a policy themselves.
2. **It creates TrustedScriptURLs for the app's own worker scripts and nothing else:** URLs on the app's own origin, without user credentials, query or fragment, whose path is a worker bundle (`/assets/<name>.worker-<hash>.js`) or the service worker (`/sw.js`). It throws a TypeError for any other URL. It returns the normalized URL, so the browser loads exactly what was checked. It has no rules for HTML or scripts, and there is no default policy, so every other sink keeps refusing strings.
3. **The Content-Security-Policy names it only where it is needed:** `trusted-types shkriuss-workers`, without `'allow-duplicates'`, when the build contains worker scripts; `trusted-types 'none'` otherwise. `@shkriuss/edge` decides from the built files. `require-trusted-types-for 'script'` and `worker-src 'self'` stay as they are.
4. **Each worker is one file.** Worker modules are named `<name>.worker.ts` and imported with `?worker&url`. Vite builds each into a single file with everything it imports. The build fails for a script file that is not named like a worker bundle, and for a module of the page that is.
5. **Worker scripts have no integrity hash and are not in the import map**, because browsers cannot check one. Instead:
   - only the app's own files can become worker scripts: `worker-src 'self'` and the policy's list;
   - files in `/assets/` are named by their content and deployed together with the page that uses them, over HTTPS with HSTS;
   - the published file hashes (`sha256sums.txt`) and the build provenance cover them like every other file.
6. **End-to-end tests prove it in Chromium, Firefox and WebKit**, in a test app that is never deployed (`tooling/platform-e2e`) but is built and served like every app:
   - the app starts its worker, and registers its service worker for the whole app;
   - worker scripts come with the page's security headers, and code in a worker or the service worker cannot create another policy;
   - the policy starts nothing but the app's worker scripts: not another origin, a query, a fragment, a module of the page, the page, a `data:` URL or a `blob:` URL;
   - the browser refuses plain strings for `new Worker()` and `register()`;
   - no script can create another policy, a default policy, or this one a second time, and DOM injection sinks still refuse strings.

## Consequences

- Apps can work offline and keep heavy work off the main thread, with the same protection as before: an injected string still cannot become HTML, a script or a worker.
- Apps without worker scripts, like the hub today, keep `trusted-types 'none'`.
- **Worker scripts are the only scripts without browser-checked integrity** ([threat model](../threat-model.md#5-residual-risks-accepted) R6). A changed `/sw.js` would control every page of its app until it is replaced. It is trusted as much as `index.html`, which has no hash either: both are revalidated on every load, and every hash comes from them.
- Worker code cannot be split into chunks or load other scripts. Code that a worker and the page share is bundled into both.
- `CLAUDE.md` says so: workers start only through `@shkriuss/edge/workers`, and nothing else creates a Trusted Types policy.
- Oxlint's `import/default` rule is off: it reports Vite's `?worker&url` imports as errors, and TypeScript already checks default imports.
- The end-to-end setup moves to `@shkriuss/config/playwright`, which the hub and the test app share.
- Revisit when browsers can check the integrity of worker scripts, or when they support web application transparency (WAICT), which covers every file.

## Alternatives considered

- **A default policy**, which turns every string into a Trusted Type: it would also accept injected strings, in every sink. Rejected.
- **A policy for each worker or each package:** more names in the Content-Security-Policy for nothing; one policy with an exact list is easier to review.
- **Creating the policy when the page starts**, rather than when the first worker starts: it would claim the name earlier, but only against code that already runs in the page and can do anything the app can anyway.
- **Vite's own ways to start workers** (`new Worker(new URL(…, import.meta.url))`, `?worker`, `?worker&inline`): they pass a URL, a plain string or a `blob:` URL to `new Worker()`, which the browser refuses.
- **Fetching worker scripts with an integrity check and starting them from a `blob:` URL:** dedicated workers would get a checked hash, but it needs `worker-src blob:`, breaks relative URLs inside workers, and cannot work for the service worker, which must be registered from its own URL. Not worth it while the service worker, the more powerful of the two, stays unchecked.
- **Workers built as ES modules with chunks:** a worker has no import map, so its chunks could not be checked.
- **No workers:** apps would not work offline, and every backup would freeze the page for seconds.
