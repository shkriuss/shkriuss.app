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
- Under `Integrity-Policy`, WebKit silently refuses a chunk that a script imports statically. In CI the hub never started in WebKit while React was in a chunk of its own, with or without a module preload for it: WebKit loaded the entry script and never requested the React chunk, and reported nothing. With React in the entry script it worked, and chunks loaded with `import()` were checked against the import map as intended. So WebKit evidently takes hashes from the import map for `import()` but not for static imports. Its source also has no place for `integrity` on `<link rel="modulepreload">`.
- Vite writes the list of files to preload for each `import()` into a chunk _after_ it has named the chunk after its content. That list can change while the name stays the same. Files in `/assets/` are cached for a year, so a returning visitor would keep the old file, which then fails its new integrity hash: the app would break.

## Decision

- **`@shkriuss/edge` adds the hashes** in a Vite plugin that runs after Vite has written the build, so the hashes cover the exact bytes that are served. It adds SHA-384 `integrity` attributes to the entry script and the stylesheet, and one import map that lists the hash of every script.
- **The import map is the only inline script.** The Content-Security-Policy allows exactly that map by its SHA-256 hash (`script-src 'self' 'sha256-…'`), which the plugin writes into `_headers` in the same step. The map holds only file paths and hashes, no code.
- **Only `import()` loads chunks.** The page loads one entry script. Every other chunk is loaded with `import()`, which checks it against the import map, and may import statically only from the entry script, which the page has already loaded.
- **No module preloading and one stylesheet per app.** The plugin turns off Vite's module preloads and per-chunk CSS, so no chunk contains a list of files to preload.
- **The build fails** rather than ship something a browser would refuse or a cache would get wrong: an inline script in the HTML, a script that is not part of the build, an integrity value that does not match, a chunk that imports another chunk statically, or a chunk with a list of files to preload.
- **End-to-end tests prove it** in Chromium, Firefox and WebKit, against the production build served with the production headers:
  - the page and its lazily loaded chunk load without a single violation;
  - a changed entry script or lazily loaded chunk is refused and never runs;
  - a script without a hash is refused;
  - inline scripts never run, and DOM injection sinks refuse strings (Trusted Types).

## Consequences

- `script-src` changes with every build, because the map's hash covers the hashes of all scripts. The HTML and `_headers` are written together, and a test checks that they match.
- `CLAUDE.md` security rule 3 gets one exception: the generated import map.
- Apps can still load code lazily, for example per route, which keeps the initial download small ([ADR 0008](0008-quality-gates.md) budgets initial JavaScript).
- Code that several lazily loaded screens share has to live in the entry script, which every visit downloads. Revisit this when WebKit takes the hashes of static imports from the import map.
- All of an app's CSS is in one file, including the styles of lazily loaded screens.
- A browser that supports `Integrity-Policy` but not import-map integrity would refuse lazily loaded chunks. The end-to-end tests in all three engines catch that before release.
- **`trusted-types 'none'` also blocks workers.** `navigator.serviceWorker.register()` and `new Worker()` take a script URL, which then has to be a Trusted Type, and with no policies none can be made. The spike confirmed this in Chromium. The service worker in Phase 1 therefore needs one narrowly scoped policy, which needs its own ADR before that work starts.

## Alternatives considered

- **No lazily loaded modules** (one bundle, no import map): keeps `script-src 'self'`, but every app would download all of its code up front, and the 150 KB budget would cap the whole app.
- **A nonce instead of a hash:** needs a new nonce for every response, which means server code; our apps are static files ([ADR 0006](0006-hosting-and-deployment.md)).
- **`'unsafe-inline'`:** would let injected scripts run. Rejected.
- **No `Integrity-Policy`, only SRI attributes:** lazily loaded chunks and anything injected later would go unchecked.
