# @shkriuss/edge

Everything about how an app is served: the security headers, script integrity and starting workers under Trusted Types ([ADR 0007](../../docs/decisions/0007-security-baseline.md), [ADR 0010](../../docs/decisions/0010-script-integrity.md), [ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)). Later also the Wrangler configuration.

## The Vite plugin

Every app's `vite.config.ts` adds `edge()` after its other plugins:

```ts
import { edge } from "@shkriuss/edge";

export default defineConfig({ plugins: [react(), edge({ appId: "notes" })] });
```

| Option            | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `appId`           | The app's permanent id, which is also its subdomain. Leave it out for the hub.  |
| `allowedFeatures` | Browser features the app needs, such as `camera`; every other one stays denied. |

After Vite has written the production build, the plugin:

1. hashes every JavaScript and CSS file (SHA-384), except worker scripts, which the page starts rather than imports;
2. adds `integrity` attributes to the scripts, module preloads and stylesheets in the HTML;
3. adds an import map that lists the hash of every other script, so modules loaded later with `import()` are checked too;
4. writes `dist/_headers` with the security headers, including the Content-Security-Policy hash of that import map, a year of caching for `/assets/`, and `X-Robots-Tag: noindex` on the app's staging host. Its `trusted-types` directive names the worker policy (see [Workers](#workers)) only if the build has worker scripts; otherwise it is `'none'`, which allows no Trusted Types policy at all.

Every chunk other than the entry script must be loaded with `import()` and may import statically only from the entry: Safari refuses statically imported chunks under `Integrity-Policy`. The plugin also turns off Vite's module preloads and per-chunk CSS, because Vite adds preload lists to chunks after naming them, which would break year-long caching. The build fails if any of this is broken ([ADR 0010](../../docs/decisions/0010-script-integrity.md)).

The build fails instead of shipping a script without a hash: for example when the HTML has an inline script or loads a script that is not part of the build.

## Workers

The Content-Security-Policy accepts only a Trusted Type as the script of a worker or service worker ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)). Apps start them with `@shkriuss/edge/workers` only:

```ts
import { registerServiceWorker, startWorker } from "@shkriuss/edge/workers";
import ageWorker from "./age.worker.ts?worker&url";

const worker = startWorker(ageWorker);
const registration = await registerServiceWorker();
```

- **Worker modules** are named `<name>.worker.ts`, in lowercase kebab case, and imported with `?worker&url`. Vite builds each into one file, `/assets/<name>.worker-<hash>.js`, with everything it imports bundled into it: a worker has no import map, so scripts that it loaded itself could not be checked. Vite's `?worker` and `?worker&inline` imports start workers from a plain string or a `blob:` URL, which the browser refuses.
- **The service worker** is `/sw.js`, so that it controls the whole app.
- **The policy:** the first time an app starts a worker, `@shkriuss/edge/workers` creates the one Trusted Types policy the Content-Security-Policy allows, `shkriuss-workers`. It turns only those scripts, on the app's own origin and without a query or fragment, into TrustedScriptURLs, and throws a TypeError for any other URL. It creates nothing else: HTML and script sinks keep refusing strings. Never create a policy yourself; the Content-Security-Policy allows no other, and this one only once.

The build fails if a worker would not start: if Vite emits a script file that is not named like a worker, or a module of the page is named like one. Unlike the page's scripts, worker scripts have no integrity hash, because browsers offer no way to check one; `sha256sums.txt` and the build provenance cover them like every other file.

## Licenses

The plugin writes `dist/licenses.txt`, which every app serves at `/licenses.txt`. It says that the app is free software under AGPL-3.0-only and where its source is. Then it gives the license texts of all the software and material of others whose code the build includes, in the page's chunks and in its workers:

- **Packages:** every package from `node_modules` with code in the build, with its license files: `LICENSE`, `COPYING`, `NOTICE` and the like. A package that tree-shaking removed entirely is left out, because none of its code is served.
- **Generated code:** helpers that Vite and Rolldown write into the bundles, with Vite's and Rolldown's own licenses. For them, Vite's license file stops before the licenses of the packages that Vite bundles for its own use, which the helpers do not contain.
- **Material in this repository:** a file of ours that includes material of others, such as a word list, starts with a legal comment, `/*! … */`, that names the source and the license. The plugin copies the legal comments of every file in the build.

The build fails for a package without a license file, and for generated code whose origin it does not know, so that no build ships code without its license. Files copied from `public/` are not bundled and are not covered: keep material of others out of `public/`.

## Deployment checks

The plugin also writes `dist/sha256sums.txt`: the SHA-256 of every file the deployment serves, in the format `sha256sum` writes. It is published at `/sha256sums.txt`, so anyone can compare what is served with what this repository builds. Follow redirects when you compare: Cloudflare serves `/index.html` at `/`.

CI also signs the build provenance of every deployed file, `sha256sums.txt` included: a GitHub artifact attestation that names the workflow run and the commit that built the file, signed with a short-lived Sigstore certificate and recorded in Sigstore's public transparency log. To check a file that a site serves, for example its page:

```sh
curl -sSL -o index.html https://shkriuss.app/
gh attestation verify index.html --repo shkriuss/shkriuss.app \
  --signer-workflow shkriuss/shkriuss.app/.github/workflows/ci.yml --source-ref refs/heads/main
```

Before deploying to production, CI runs:

```sh
node packages/edge/src/cli.ts check-live apps/hub/dist https://shkriuss.app
```

It fails if a file in `/assets/` would change its content under the same name. Browsers keep those files for a year, so returning visitors would load the old copy and fail its integrity check.

It skips the comparison only while nothing is deployed: when the host has no DNS record, or answers 404 or with the HTML page instead of a manifest. Any other answer or network error fails it, so an outage or a challenge page cannot switch the check off. Re-run the job once the site answers normally.

## The headers

`securityHeaders()` returns the header set from [architecture §12](../../docs/architecture.md#12-security). Change it only together with the architecture document, and never relax it to make something work.

The end-to-end tests of each app check these headers against a real server and prove that the browser refuses changed scripts, scripts without a hash and HTML strings in DOM injection sinks.
