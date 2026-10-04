# ADR 0010: Script integrity with a hash-allowed import map

- **Status:** Proposed
- **Date:** 2026-10-04

## Context

[ADR 0007](0007-security-baseline.md) requires an integrity hash on every script: SRI attributes on script and module-preload tags, import-map `integrity` for lazily loaded modules, and `Integrity-Policy: blocked-destinations=(script)`, which makes the browser refuse any script that has no hash. It left the details to a spike in Phase 0.3, to be checked against our real build.

Browser support, as of 2026-10:

| Feature                | Chrome | Firefox | Safari |
| ---------------------- | ------ | ------- | ------ |
| Import-map `integrity` | 127    | 138     | 18     |
| `Integrity-Policy`     | 138    | 145     | 26     |
| Trusted Types          | 83     | 148     | 26     |

The spike found four constraints:

- Browsers read import maps only from inline `<script type="importmap">` elements, never from a file. The Content-Security-Policy treats an inline import map like any inline script, so `script-src 'self'` blocks it. `CLAUDE.md` also forbids inline scripts.
- Vite 8 adds no integrity hashes on its own, not even to the module preloads it inserts for lazily loaded code, and no existing plugin also writes the import map and the matching policy.
- WebKit ignores `integrity` on `<link rel="modulepreload">`; its source has no place for it. Under `Integrity-Policy` it refuses the preload. In the spike's first CI run, the hub never started in WebKit while it preloaded its React chunk.
- Vite writes the list of files to preload for each `import()` into a chunk _after_ it has named the chunk after its content. That list can change while the name stays the same. Files in `/assets/` are cached for a year, so a returning visitor would keep the old file, which then fails its new integrity hash: the app would break.

## Decision

- **`@shkriuss/edge` adds the hashes** in a Vite plugin that runs after Vite has written the build, so the hashes cover the exact bytes that are served. It adds SHA-384 `integrity` attributes to scripts, module preloads and stylesheets, and one import map that lists the hash of every script.
- **The import map is the only inline script.** The Content-Security-Policy allows exactly that map by its SHA-256 hash (`script-src 'self' 'sha256-…'`), which the plugin writes into `_headers` in the same step. The map holds only file paths and hashes, no code.
- **No module preloading and one stylesheet per app.** The plugin turns off Vite's module preloads and per-chunk CSS. Statically imported chunks then load through the import map, which carries their hashes, and no chunk contains a list of files to preload.
- **The build fails** rather than ship a script without a hash: for an inline script in the HTML, a script that is not part of the build, an integrity value that does not match, or a chunk with a list of files to preload.
- **End-to-end tests prove it** in Chromium, Firefox and WebKit, against the production build served with the production headers:
  - the page and its lazily loaded chunk load without a single violation;
  - a changed chunk, preloaded or lazily loaded, is refused and never runs;
  - a script without a hash is refused;
  - inline scripts never run, and DOM injection sinks refuse strings (Trusted Types).

## Consequences

- `script-src` changes with every build, because the map's hash covers the hashes of all scripts. The HTML and `_headers` are written together, and a test checks that they match.
- `CLAUDE.md` security rule 3 gets one exception: the generated import map.
- Apps can still load code lazily, for example per route, which keeps the initial download small ([ADR 0008](0008-quality-gates.md) budgets initial JavaScript).
- Without preloads, a statically imported chunk is requested only once the code that imports it has loaded, one round trip later. Once the service worker (Phase 1) caches the app, this only affects the very first visit.
- All of an app's CSS is in one file, including the styles of lazily loaded screens.
- A browser that supports `Integrity-Policy` but not import-map integrity would refuse lazily loaded chunks. The end-to-end tests in all three engines catch that before release.
- **`trusted-types 'none'` also blocks workers.** `navigator.serviceWorker.register()` and `new Worker()` take a script URL, which then has to be a Trusted Type, and with no policies none can be made. The spike confirmed this in Chromium. The service worker in Phase 1 therefore needs one narrowly scoped policy, which needs its own ADR before that work starts.

## Alternatives considered

- **No lazily loaded modules** (one bundle, no import map): keeps `script-src 'self'`, but every app would download all of its code up front, and the 150 KB budget would cap the whole app.
- **A nonce instead of a hash:** needs a new nonce for every response, which means server code; our apps are static files ([ADR 0006](0006-hosting-and-deployment.md)).
- **`'unsafe-inline'`:** would let injected scripts run. Rejected.
- **No `Integrity-Policy`, only SRI attributes:** lazily loaded chunks and anything injected later would go unchecked.
