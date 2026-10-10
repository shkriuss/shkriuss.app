# @shkriuss/edge

Everything about how an app is served: the security headers, script integrity and starting workers under Trusted Types ([ADR 0007](../../docs/decisions/0007-security-baseline.md), [ADR 0010](../../docs/decisions/0010-script-integrity.md), [ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)), and the deployment checks, `sha256sums.txt` and `check-live` (see [Deployment checks](#deployment-checks)). The Wrangler configuration is not here: `tooling/create-app` writes each app's `wrangler.json`, and `pnpm check wrangler` holds it to its form.

## The Vite plugin

Every app gets `edge()` from its build, `app()` of `@shkriuss/shell/vite`, after its other plugins, with the app's id and browser features from its `app.config.ts`. The hub adds it itself, as any build without the shell would:

```ts
import { edge } from "@shkriuss/edge";

export default defineConfig({ plugins: [react(), edge()] });
```

| Option             | Meaning                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appId`            | The app's permanent id, which is also its subdomain. Leave it out for the hub.                                                                                                                      |
| `allowedFeatures`  | Browser features the app needs, such as `camera`; every other one stays denied.                                                                                                                     |
| `webAssembly`      | Whether the app's workers compile WebAssembly, which its policy then allows (see [WebAssembly](#webassembly)).                                                                                      |
| `excludedPackages` | Packages whose code the build must not have: those that keep data, for an app without data (see [Excluded packages](#excluded-packages)).                                                           |
| `excludedFiles`    | Files whose code the build must not have, though it may have the rest of their package: the shell's text for apps with data, for an app without data (see [Excluded packages](#excluded-packages)). |
| `firstPageBudget`  | The most JavaScript, gzipped, that each page may load before it runs; the build fails above it (see [Budgets](#budgets)).                                                                           |

After Vite has written the production build, the plugin:

1. hashes every JavaScript and CSS file (SHA-384), except worker scripts, which the page starts rather than imports;
2. adds `integrity` attributes to the entry script and the stylesheet in the HTML, which has no module preloads (see below);
3. adds an import map that lists the hash of every other script, so modules loaded later with `import()` are checked too;
4. writes `dist/_headers` with the security headers, including the Content-Security-Policy hash of that import map; a year of caching for each file in `/assets/`, by its exact path, so that the single-page fallback's HTML, which answers a request for a file that the build does not have, is not kept for a year in its place; UTF-8 for text files, which Cloudflare otherwise serves without a charset; and `X-Robots-Tag: noindex` on the app's staging host. Its `trusted-types` directive names the worker policy (see [Workers](#workers)) only if the build has worker scripts; otherwise it is `'none'`, which allows no Trusted Types policy at all. Its `script-src` allows `'wasm-unsafe-eval'` only for an app that declares WebAssembly (see [WebAssembly](#webassembly)).

Cloudflare reads at most 100 rules from `_headers`, and at most 2,000 characters per line; the build fails above either. The security headers take one rule (`/*`) and the staging `noindex` another, and each file in `/assets/` and each `.txt` file (`licenses.txt`, `sha256sums.txt`, `security.txt`) gets a rule of its own, so an app with roughly 95 files in `/assets/` stops building, with an error that says so, until the per-file caching rules are rethought. Today's largest app has 16.

Every chunk other than the entry script must be loaded with `import()` and may import statically only from the entry: Safari refuses statically imported chunks under `Integrity-Policy`. The plugin also turns off Vite's module preloads and per-chunk CSS, because Vite adds preload lists to chunks after naming them, which would break year-long caching. The build fails if any of this is broken ([ADR 0010](../../docs/decisions/0010-script-integrity.md)).

The build fails instead of shipping a script without a hash: for example when the HTML has an inline script or loads a script that is not part of the build.

It fails too for a file larger than 25 MiB, the most that Cloudflare serves as a static asset, which the deploy would otherwise refuse after every test had passed. Grammar's WebAssembly module is the largest file today, at 16 MB.

With `pwa()` of `@shkriuss/pwa/vite` among the plugins, the plugin also writes the service worker, `/sw.js`. It writes it after every other file, and before `sha256sums.txt` and `_headers`, because the service worker lists the hash of every other file ([service worker spec](../../docs/specs/service-worker.md)). The build fails if another file is already `/sw.js`.

## Workers

The Content-Security-Policy accepts only a Trusted Type as the script of a worker or service worker ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)). Apps start them with `@shkriuss/edge/workers` only:

```ts
import { registerServiceWorker, startWorker } from "@shkriuss/edge/workers";
import ageWorker from "./age.worker.ts?worker&url";

const worker = startWorker(ageWorker);
const registration = await registerServiceWorker();
```

- **Worker modules** are named `<name>.worker.ts`, in lowercase kebab case, and imported with `?worker&url`. Vite builds each into one file, `/assets/<name>.worker-<hash>.js`, with everything it imports bundled into it: a worker has no import map, so scripts that it loaded itself could not be checked. Vite's `?worker` and `?worker&inline` imports start workers from a plain string or a `blob:` URL, which the browser refuses.
- **The service worker** is `/sw.js`, so that it controls the whole app. `@shkriuss/pwa` builds it and registers it.
- **The policy:** the first time an app starts a worker, `@shkriuss/edge/workers` creates the one Trusted Types policy the Content-Security-Policy allows, `shkriuss-workers`. It turns only those scripts, on the app's own origin and without a query or fragment, into TrustedScriptURLs, and throws a TypeError for any other URL. It creates nothing else: HTML and script sinks keep refusing strings. Never create a policy yourself; the Content-Security-Policy allows no other, and this one only once.

The build fails if a worker would not start: if Vite emits a script file that is not named like a worker, or a module of the page is named like one. Unlike the page's scripts, worker scripts have no integrity hash, because browsers offer no way to check one; `sha256sums.txt` and the build provenance cover them like every other file.

## WebAssembly

Only an app that declares it may compile WebAssembly, and only in its workers ([ADR 0014](../../docs/decisions/0014-webassembly.md)). An app declares it with `webAssembly: true` in its `app.config.ts`, which passes it on as `edge({ webAssembly: true })`. Its `script-src` then allows `'wasm-unsafe-eval'`, which lets it compile WebAssembly and nothing else: `eval()` and `new Function()` stay refused.

```ts
// add.worker.ts, started with startWorker() like any worker
const module = new URL("./add.wasm", import.meta.url);
const { instance } = await WebAssembly.instantiateStreaming(fetch(module));
```

- **Modules are files of the app:** Vite builds each into `/assets/<name>-<hash>.wasm`, and never inlines one as a `data:` URL, which `connect-src 'self'` would refuse. They are listed in `sha256sums.txt`, and the service worker keeps them like every file.
- **The build fails** for an app that ships modules without declaring WebAssembly, so that a new dependency cannot widen the policy unnoticed; for an app that declares it without shipping any; and for a script of the page that refers to a module.
- **Licenses:** a package that ships WebAssembly goes through `add-dependency`, and `/licenses.txt` must carry the licenses of everything compiled into its module, not only the package's own.

## Excluded packages

An app without data excludes the packages that keep data, `@shkriuss/data` and `@shkriuss/backup`: `app()` of `@shkriuss/shell/vite` passes them as `excludedPackages` for `keepsData: false`. The build fails if the page, a worker or the service worker has the code of an excluded package, even through another package. A module belongs to the package named in the nearest `package.json` with a name.

It also excludes the shell's text for apps with data, `data-messages.ts` of `@shkriuss/shell`, which `app()` passes, by its path, as `excludedFiles`: the app has the shell, but not its storage, backups and other parts for apps with data, which all show that text, nor the text itself, which only those parts use.

Only code that the build has counts: a module that tree-shaking removed entirely does not, nor a worker whose module it removed. Vite builds every worker that a module refers to, even when tree-shaking then removes that module, and leaves such a worker out of the build; so does the plugin.

## Budgets

With `firstPageBudget`, the build measures the JavaScript that each page loads before it runs: the scripts of its HTML and the chunks that they import statically, gzipped at level 9, in kilobytes of 1,000 bytes. Chunks that the page loads later with `import()` do not count, nor do its workers and service worker. Above the budget, the build fails and names each of those scripts with its size; within it, the build logs what the page loads.

`FIRST_PAGE_BUDGETS` has the budgets of [ADR 0018](../../docs/decisions/0018-quality-gates-as-enforced.md): `app()` of `@shkriuss/shell/vite` passes 180 kB for an app with data and 150 kB for an app without, and the hub passes 150 kB.

## Licenses

The plugin writes `dist/licenses.txt`, which every app serves at `/licenses.txt`. It says that the app is free software under AGPL-3.0-only and where its source is. Then it gives the license texts of all the software and material of others whose code the build includes, in the page's chunks and in the workers that it has (see [Excluded packages](#excluded-packages)):

- **Packages:** every package from `node_modules` with code in the build, with its license files: `LICENSE`, `COPYING`, `NOTICE` and the like. A package that tree-shaking removed entirely is left out, because none of its code is served.
- **Generated code:** helpers that Vite and Rolldown write into the bundles, with Vite's and Rolldown's own licenses. For them, Vite's license file stops before the licenses of the packages that Vite bundles for its own use, which the helpers do not contain. Modules that this repository's own plugins generate, whose ids start with `OWN_GENERATED` (`\0shkriuss:`), such as the hub's catalog, are our own code.
- **Material in this repository:** a file of ours that includes material of others, such as a word list, starts with a legal comment, `/*! … */`, that names the source and the license. The plugin copies the legal comments of every file in the build.
- **Stylesheet imports:** a stylesheet inlines what it `@import`s, such as Tailwind CSS, so the build's modules do not show it. The plugin follows the `@import` and `@plugin` rules of every stylesheet of ours in the build: a package they name counts as a package in the build, and a stylesheet of ours they name has its legal comments copied and its own imports followed.

The build fails for a package without a license file, for generated code whose origin it does not know, and for a stylesheet import it cannot follow, such as a URL, so that no build ships code without its license. Files copied from `public/` are not bundled and are not covered: keep material of others out of `public/`.

## `security.txt`

Every build has `/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)), so that a researcher finds how to report a problem on any of the sites ([hub spec](../../docs/specs/hub.md) §4):

```text
Contact: https://github.com/shkriuss/shkriuss.app/security/advisories/new
Policy: https://github.com/shkriuss/shkriuss.app/security/policy
Preferred-Languages: en
Expires: <the commit's date plus 180 days>
```

`Expires` comes from the date of the commit that is built, never from the time of the build: a second build of the commit, in CI or by anyone who compares it with what a site serves, must match the deployed files byte for byte, maybe days later. The build takes the date of git's `HEAD`, or `SOURCE_DATE_EPOCH` if it is set, as reproducible builds set it, and fails with neither. Tests that build outside a git checkout set `SOURCE_DATE_EPOCH`. A build that already has the file, as from `public/`, fails too.

Turbo never caches the builds (`turbo.json`): its cache knows the files, not the commit, and would give a new commit the file that an earlier one built, with that commit's date. Every app builds in seconds.

## Deployment checks

The plugin also writes `dist/sha256sums.txt`: the SHA-256 of every file the deployment serves, in the format `sha256sum` writes. It is published at `/sha256sums.txt`, so anyone can compare what is served with what this repository builds. Follow redirects when you compare: Cloudflare serves `/index.html` at `/`.

CI also signs the build provenance of every deployed file, `sha256sums.txt` included: a GitHub artifact attestation that names the workflow run and the commit that built the file, signed with a short-lived Sigstore certificate and recorded in Sigstore's public transparency log. To check a file that a site serves, for example its page:

```sh
curl -sSL -o index.html https://shkriuss.app/
gh attestation verify index.html --repo shkriuss/shkriuss.app \
  --signer-workflow shkriuss/shkriuss.app/.github/workflows/ci.yml --source-ref refs/heads/main
```

Before deploying to production, CI runs it for every app, against the production domain in the app's `wrangler.json`; for the hub:

```sh
node packages/edge/src/cli.ts check-live apps/hub/dist https://shkriuss.app
```

It fails if a file in `/assets/` would change its content under the same name. Browsers keep those files for a year, so returning visitors would load the old copy and fail its integrity check.

It skips the comparison only before the first deployment, while the host has no DNS record. Every other answer fails it: a 404 or the HTML page in place of the manifest, which a deployment without one would answer, an outage, a challenge page or any network error, so that none of them can switch the check off. Re-run the job once the site answers normally.

## The headers

`securityHeaders()` returns the header set from [architecture §12](../../docs/architecture.md#12-security). Change it only together with the architecture document, and never relax it to make something work.

The hub's end-to-end tests (`apps/hub/e2e/security.spec.ts`) check these headers against a real server and prove that the browser refuses changed scripts, scripts without a hash and HTML strings in DOM injection sinks. Every app's end-to-end tests run under the same headers, and fail on any violation that the browser reports.
