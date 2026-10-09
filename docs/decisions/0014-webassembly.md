# ADR 0014: WebAssembly for apps that declare it

- **Status:** Accepted; the last item of point 3, on when the service worker keeps modules, is superseded by [ADR 0019](0019-files-kept-on-first-use.md)
- **Date:** 2026-10-06

## Context

The Content-Security-Policy of every app ([ADR 0007](0007-security-baseline.md)) allows scripts from the app's own origin and the import map's hash, and nothing else. Without `'wasm-unsafe-eval'`, browsers refuse to compile WebAssembly anywhere in the apps.

The [Grammar app](../specs/apps/grammar.md) checks English text on the device with Harper, an open-source grammar checker written in Rust and compiled to WebAssembly (`harper.js` 2.10.0, Apache-2.0, by Automattic). No checker written in JavaScript comes close: those check spelling and style, not grammar. Open-weight AI models would need WebAssembly too, and hundreds of megabytes.

- **What `'wasm-unsafe-eval'` allows:** compiling and instantiating WebAssembly (`WebAssembly.compile()`, `instantiate()` and their streaming forms), and nothing else. `eval()`, `new Function()`, string timers and inline scripts stay refused. Chrome 97, Firefox 102 and Safari 16 support it.
- **What WebAssembly can do:** a module computes in its own memory and reaches the page only through the JavaScript functions that the code loading it passes in. It adds nothing that the JavaScript running it cannot already do.
- **A spike** in Chromium 141, with the production headers and Harper in a worker started by `@shkriuss/edge/workers` ([ADR 0011](0011-worker-trusted-types-policy.md)):
  - without `'wasm-unsafe-eval'`, the browser refused to compile Harper's module;
  - with it, Harper compiled in 2.1 seconds, found four mistakes in a sentence in 83 milliseconds, and the browser reported no violation;
  - Vite built the module as `/assets/harper_wasm_bg-<hash>.wasm`, 16.2 MB (8.2 MB compressed). It is in the service worker's precache list and in `sha256sums.txt`, like every file;
  - fetched by the worker while the service worker was still storing it, the module failed once to download (`ERR_CACHE_WRITE_FAILURE`): the two downloads of 16 MB ran at the same time.
- **Harper's own worker helper** (`WorkerLinter`) starts its worker from a `blob:` URL, which `worker-src 'self'` and ADR 0011 refuse. Its `LocalLinter`, run inside an app's own worker, works.
- **Browsers check no integrity** for a module that a script fetches: `Integrity-Policy` and the import map cover scripts only, and `harper.js` passes its loader a bare URL.

## Decision

1. **Only apps that declare it may compile WebAssembly.** `webAssembly: true` in an app's `app.config.ts` adds `'wasm-unsafe-eval'` to that app's `script-src`, on every response of the app. Every other app, the hub and the test packages keep the policy they have. `@shkriuss/edge` writes it, and the build fails both for an app that ships a `.wasm` file without declaring it and for one that declares it without shipping any, so that a new dependency cannot widen the policy unnoticed.
2. **WebAssembly runs in workers,** started with `@shkriuss/edge/workers`, so that a long computation never blocks the page. The build fails if a module of the page refers to a `.wasm` file.
3. **Modules are the app's own files,** as worker scripts are (ADR 0011, point 5):
   - bundled from npm packages at build time into `/assets/<name>-<hash>.wasm`;
   - fetched only from the app's own origin (`connect-src 'self'`);
   - listed in `sha256sums.txt` and covered by the build provenance;
   - kept by the service worker, which checks each file against its SHA-256 when it stores it, and serves them from its cache from then on. Where a service worker runs, an app loads its modules only once the service worker has kept the app, so that they download once and come from that checked copy.
4. **A package that ships WebAssembly** goes through `add-dependency` like any runtime dependency. `/licenses.txt` carries the licenses of everything compiled into the module, such as Harper's Rust crates and the sources of its dictionary, not only the npm package's own.
5. **Tests prove it:**
   - **in Chromium, Firefox and WebKit,** end to end: a worker of the platform's test app, which declares WebAssembly, compiles a module of the app and runs it, and the module is served like the app's other files; the hub, which does not declare it, cannot compile one;
   - **in unit tests:** the two policies differ only by `'wasm-unsafe-eval'`, and the build fails in each case of point 1 and point 2, and keeps even the smallest module a file of its own, which Vite would otherwise inline as a `data:` URL that `connect-src 'self'` refuses.

## Consequences

- Grammar can check English on the device, offline, with nothing sent anywhere.
- In an app that declares WebAssembly, code that already runs there can compile WebAssembly from bytes it has. That gives it nothing new: injected strings still cannot become scripts, HTML or workers, and modules still come only from the app's own origin.
- **WebAssembly modules join worker scripts** as files that browsers do not check when a worker fetches them for the first time ([threat model](../threat-model.md#5-residual-risks-accepted) R6). Once the service worker controls the app, it serves them from its cache, where each was checked.
- **A heavier first load:** Grammar's module is 16 MB (8 MB compressed). The service worker keeps it, so the app works offline afterwards.
- `CLAUDE.md`'s security rules, the threat model (T5, R6) and the architecture's section on security headers say so.
- Revisit when browsers can check the integrity of fetched WebAssembly, or support web application transparency (WAICT), which covers every file.

## Alternatives considered

- **`'wasm-unsafe-eval'` for every app:** simpler, but gives every app a power that one uses.
- **`'wasm-unsafe-eval'` only on the responses of worker scripts,** so that pages could not compile WebAssembly at all: `_headers` would have to remove the policy for those paths and set another, and a page's scripts are trusted as much as a worker's. More to get wrong, for little.
- **`'unsafe-eval'`:** also allows `eval()` and `new Function()`. Rejected.
- **Checking the module's hash in our own code before compiling it:** `harper.js` gives its loader only a URL, so this would need a patch of the package or a wrapper around `fetch()` in the worker. It would also protect no more than the worker script that does the checking, which browsers do not check either.
- **A grammar checker in JavaScript** (`retext` with `nspell`, `write-good`): checks spelling and style, not grammar.
- **An open-weight AI model** (such as Qwen3 0.6B, Apache-2.0): also WebAssembly, plus WebGPU for speed, 400 MB to more than 1 GB of weights, split into files of at most 25 MiB for Cloudflare, and answers that can change the meaning of a sentence. Possible later, as an option, with its own ADR.
