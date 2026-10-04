# @shkriuss/edge

Everything about how an app is served: the security headers and script integrity ([ADR 0007](../../docs/decisions/0007-security-baseline.md), [ADR 0010](../../docs/decisions/0010-script-integrity.md)). Later also the Wrangler configuration.

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

1. hashes every JavaScript and CSS file (SHA-384);
2. adds `integrity` attributes to the scripts, module preloads and stylesheets in the HTML;
3. adds an import map that lists the hash of every script, so modules loaded later with `import()` are checked too;
4. writes `dist/_headers` with the security headers, including the Content-Security-Policy hash of that import map, a year of caching for `/assets/`, and `X-Robots-Tag: noindex` on the app's staging host.

Every chunk other than the entry script must be loaded with `import()` and may import statically only from the entry: Safari refuses statically imported chunks under `Integrity-Policy`. The plugin also turns off Vite's module preloads and per-chunk CSS, because Vite adds preload lists to chunks after naming them, which would break year-long caching. The build fails if any of this is broken ([ADR 0010](../../docs/decisions/0010-script-integrity.md)).

The build fails instead of shipping a script without a hash: for example when the HTML has an inline script or loads a script that is not part of the build.

## Deployment checks

The plugin also writes `dist/sha256sums.txt`: the SHA-256 of every file the deployment serves, in the format `sha256sum` writes. It is published at `/sha256sums.txt`, so anyone can compare what is served with what this repository builds.

Before deploying to production, CI runs:

```sh
node packages/edge/src/cli.ts check-live apps/hub/dist https://shkriuss.app
```

It fails if a file in `/assets/` would change its content under the same name. Browsers keep those files for a year, so returning visitors would load the old copy and fail its integrity check.

It skips the comparison only while nothing is deployed: when the host has no DNS record, or answers 404 or with the HTML page instead of a manifest. Any other answer or network error fails it, so an outage or a challenge page cannot switch the check off. Re-run the job once the site answers normally.

## The headers

`securityHeaders()` returns the header set from [architecture §12](../../docs/architecture.md#12-security). Change it only together with the architecture document, and never relax it to make something work.

The end-to-end tests of each app check these headers against a real server and prove that the browser refuses changed scripts, scripts without a hash and HTML strings in DOM injection sinks.
