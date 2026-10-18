# 0004. Strict CSP with Trusted Types, shared security headers

Status: Accepted (2026-10-16)

## Context

The goal is security and privacy "as strong as practical" for static sites
that keep user data in the browser. The main real-world risk for such sites
is cross-site scripting (XSS) stealing local data.

## Decision

`packages/astro-config/src/headers.ts` defines the headers once; the build
writes them to every site's `_headers` file:

- `Content-Security-Policy`: `default-src 'none'` and only `'self'` for
  scripts, styles, images, fonts, connections, the manifest and workers;
  `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, and
  **Trusted Types** (`require-trusted-types-for 'script'`) with two named
  policies: `shkriuss-sw`, used only to register `/sw.js`, and
  `shkriuss-worker`, used only to start workers from the site's own build
  files. Apps that run WebAssembly (`"webAssembly": true` in `apps.json`)
  also get `'wasm-unsafe-eval'` in `script-src`
  ([ADR 0011](0011-on-device-grammar-checking.md)).
- HSTS with preload, `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a Permissions-Policy that turns off every
  powerful feature (apps opt in with `allowFeatures`), and COOP/CORP/COEP.
- Astro is configured to never inline scripts or styles
  (`inlineStylesheets: 'never'`, `assetsInlineLimit: 0`). The theme script
  that must run before paint is a tiny external file.
- `/_astro/*` files (content-hashed) are cached for a year; pages revalidate.

## Consequences

- Inline scripts and styles, `style=""` attributes, `innerHTML` and
  third-party resources are blocked. That's enforced three ways: ESLint rules,
  `pnpm check:dist`, and browser tests that fail on any console error or
  cross-origin request.
- Writing UI code takes a little more care (use `<template>`, `textContent`,
  CSS classes).
- `upgrade-insecure-requests` is left out: all our URLs are same-origin HTTPS
  already, and it would break local testing over `http://localhost`.

## Alternatives

- **Astro's built-in CSP (`security.csp`):** hash-based, but it is a `<meta>`
  tag, which can't set `frame-ancestors`, and it allows inline code by hash
  rather than removing it.
- **Nonces:** need server code on every request; these sites have none.
