# 0004. Strict CSP with Trusted Types, shared security headers

Status: Accepted (2026-10-16). Extended by [ADR 0009](0009-push-notifications.md)
and [ADR 0010](0010-account-and-sync.md): answers from the servers get
headers of their own; by [ADR 0010](0010-account-and-sync.md): only the hub
may use passkeys; and by [ADR 0011](0011-on-device-grammar-checking.md) and
[ADR 0012](0012-deep-check-ai-model.md): apps that run WebAssembly may
compile it and start its threads. Updated in October 2026 (audit 4 C-1):
`form-action 'none'`; and (audit 4 C-4): files saved for offline use get
the policy of the version now installed. Changed by audit 5 Z-1 (and C-1):
`/_astro/*` files are revalidated like pages instead of being cached for a
year, and (audit 5 C-3) the Permissions-Policy names newer features too.
Changed by audit 5 I-1: the build writes a `robots.txt` next to
`security.txt`.

## Context

The goal is security and privacy "as strong as practical" for static sites
that keep user data in the browser. The main real-world risk for such sites
is cross-site scripting (XSS) stealing local data.

## Decision

`packages/astro-config/src/headers.ts` defines the headers once; the build
writes them to every site's `_headers` file:

- `Content-Security-Policy`: `default-src 'none'` and only `'self'` for
  scripts, styles, images, fonts, connections, the manifest and workers
  (images may also be `data:` and `blob:` addresses, which only the page
  itself can make, for example photos shown from the device);
  `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'none'` (no
  form is sent the browser's own way: each page's script handles its forms,
  and `method="dialog"` forms only close a dialog; before the script runs,
  a form would put what was typed in the address, audit 4 C-1), and
  **Trusted Types** (`require-trusted-types-for 'script'`) with two named
  policies: `shkriuss-sw`, used only to register `/sw.js`, and
  `shkriuss-worker`, used only to start workers from the site's own build
  files. Apps that run WebAssembly (`"webAssembly": true` in `apps.json`)
  also get `'wasm-unsafe-eval'` in `script-src`
  ([ADR 0011](0011-on-device-grammar-checking.md)), and the Trusted Types
  policy `default`, which `allowThreadScripts()` uses to start WebAssembly
  threads ([ADR 0012](0012-deep-check-ai-model.md)).
- Answers from the servers (`/api/*`, ADRs 0009 and 0010) aren't static
  files, so `_headers` doesn't reach them. They get a short set of their own:
  `API_HEADERS` in `packages/server/src/index.ts` (no caching,
  `default-src 'none'`, HSTS, `nosniff`, CORP, no referrer).
- HSTS with preload, `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a Permissions-Policy that turns off every
  powerful feature (apps opt in with `allowFeatures`), and COOP/CORP/COEP.
- Astro is configured to never inline scripts or styles
  (`inlineStylesheets: 'never'`, `assetsInlineLimit: 0`). The theme script
  that must run before paint is a tiny external file.
- `/_astro/*` files (content-hashed) and pages are revalidated on every
  request (`public, max-age=0, must-revalidate`; Cloudflare answers an
  unchanged file with a cheap 304). Build files were cached for a year at
  first, but Cloudflare gave that header to its "not found" answer for a
  missing build file too, which a browser then kept for a year, with the
  page that needed the file broken on that device until a deploy changed
  the file's name (audit 5 Z-1); and the browser's own cache kept a worker
  script's old security headers after a headers-only change (audit 5 C-1).
  The service worker keeps the offline copy and serves build files from it
  first, so returning visitors lose nothing. The Worker doesn't run for
  `/_astro/*`: that would count every build file request against the free
  plan's daily Worker requests.
- `robots.txt` (`packages/astro-config/src/robots-txt.ts`, audit 5 I-1):
  every page may be read, the servers' answers under `/api/` not. Without
  one, Cloudflare served a `robots.txt` of its own under the sites' names.
- The service worker (`packages/astro-config/src/service-worker.ts`) serves
  saved files with the policy of the version now installed, not the one they
  were saved under, so a file saved under an older, looser policy can't keep
  it (audit 4 C-4). That includes an app's own saved files, like Grammar's
  Deep check model. Build files copied from the version before get the new
  policy once, as they're copied.

## Consequences

- Inline scripts and styles, `style=""` attributes, `innerHTML` and
  third-party resources are blocked. That's enforced three ways: ESLint rules,
  `pnpm check:dist`, and browser tests that fail on any console error or
  cross-origin request.
- The browser tests check that every site sends what `headers.ts` writes,
  and a unit test (`headers.test.ts`) pins exactly what it writes, for an
  app, the hub and an app with WebAssembly, and that only the hub may turn
  on passkeys. A weaker header can't pass by changing both (audit J-3).
- Writing UI code takes a little more care (use `<template>`, `textContent`,
  CSS classes).
- `upgrade-insecure-requests` is left out: all our URLs are same-origin HTTPS
  already, and it would break local testing over `http://localhost`.

## Alternatives

- **Astro's built-in CSP (`security.csp`):** hash-based, but it is a `<meta>`
  tag, which can't set `frame-ancestors`, and it allows inline code by hash
  rather than removing it.
- **Nonces:** need server code on every request; these sites have none.
