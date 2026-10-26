# 0011. Grammar checking on the device (Harper, WebAssembly)

Status: Accepted (2026-10-18). Extended by [ADR 0012](0012-deep-check-ai-model.md):
apps with `"webAssembly": true` may also create the `default` Trusted Types
policy, for WebAssembly threads. Updated in October 2026 (audit 3 J-8,
J-11): Harper's file is about 20 MB now, and Consequences say what to do if
an update takes it near Cloudflare's 25 MiB limit for one file.

## Context

Grammar checks English (American or British) for grammar, spelling and
punctuation. Grammar checkers normally send your text to a server (Grammarly,
LanguageTool's online service) or use an AI model. Both would send what people
write to another company, which the project's rules don't allow
([ADR 0006](0006-local-first-data.md)): your text is often the most private
data there is.

**Harper** (by Automattic, open source under the Apache 2.0 licence) is a
grammar checker written in Rust that runs entirely in the browser as
WebAssembly. It supports American and British English, needs no server, and
checks a page of text in milliseconds. Its downside is size: the WebAssembly
file, which includes its dictionary, was 16 MB when this was decided
(harper.js 2.10), and is about 20 MB since 2.13 (20,252,229 bytes); about
8 MB compressed.

Our Content Security Policy ([ADR 0004](0004-security-headers.md)) doesn't
allow WebAssembly to run, and Harper's own "run in a worker" option builds its
worker from a `blob:` URL, which the CSP and Trusted Types also block.

## Decision

- **Harper (`harper.js`) checks text in Grammar, on the device.** Nothing is
  sent anywhere; a browser test checks that typing sends no request. (With
  sync on, [ADR 0010](0010-account-and-sync.md), only the English choice and
  the dictionary sync; the text still never leaves the device, also tested.)
- **Only apps that need it may compile WebAssembly.** An app sets
  `"webAssembly": true` in `apps.json`; its CSP then has
  `script-src 'self' 'wasm-unsafe-eval'`. This keyword allows compiling
  WebAssembly (from our own origin only, as before); it does **not** allow
  `eval()` or any other way of running JavaScript from text. Every other site
  keeps `script-src 'self'`. Tests check both policies, per site.
- **The checker runs in our own worker file**, built by Vite from
  `apps/grammar/src/scripts/checker.worker.ts`, so the page never freezes
  (setting up Harper takes a few seconds on a phone). It's started with
  `startWorker()` from `@shkriuss/ui/worker`, through a Trusted Types policy
  (`shkriuss-worker`) that only allows the site's own build files
  (`/_astro/….js`). Harper's `blob:` worker isn't used.
- **The page script stays within its size budget**: the checker and Harper
  are only in the worker file, which loads after the page.
- **Downloaded once, then offline.** The offline service worker saves the
  WebAssembly file like every other build file. On a first visit the page
  waits for that copy (`offlineCopySaved()`), then loads the checker from it:
  two downloads of the same big file at once can make the browser fail one.
  When a new version is deployed, unchanged build files are copied from the
  old offline copy instead of being downloaded again.
- Harper's licence is shipped with the app (`/licenses/harper.txt`) and linked
  from the page.

## Consequences

- People can check private writing with nothing leaving the device, and it
  works offline after the first visit.
- The first visit downloads about 8 MB. The page says so.
- Harper's checks are rule-based: very good at common mistakes (agreement,
  "a/an", "their/they're", spelling, punctuation), not a full rewrite tool.
  Its messages are in English, as written by Harper.
- `'wasm-unsafe-eval'` is a small, deliberate widening of one app's CSP. A
  bug that let an attacker load their own WebAssembly would still need a file
  on our own origin to load it from (`script-src 'self'`).
- Updates to Harper come through Dependabot like any dependency; the
  browser tests use the real checker, so a change in its behaviour shows up in
  CI.
- Harper's file is one of the site's own build files, which Cloudflare serves
  up to 25 MiB each (`pnpm check:dist` fails above that). It's 19.3 MiB, and
  grew about 26% in one update (harper.js 2.10 to 2.13). Unlike Deep check's
  files, it can't simply be split into parts: harper.js loads it from one
  address, and the offline copy keeps it whole. If an update takes it near
  25 MiB, keep the older harper.js until there's a way: a smaller build of
  Harper, or serving the file in parts and joining them in the checker's
  worker, which changes how it's loaded (and maybe the CSP), so it needs a
  decision record of its own (audit 3 J-11).

## Alternatives

- **LanguageTool's online service, or an AI service**: sends the text away.
- **Running LanguageTool ourselves**: a Java server, which doesn't fit
  Cloudflare Workers and would still see every text.
- **Chrome's built-in Proofreader**: only in desktop Chrome, not on phones.
- **Our own rules**: far less accurate than Harper's years of work.
- **Harper in the page itself (no worker)**: simpler, but the page would
  freeze for a few seconds while it starts on a phone.
- **Allowing `blob:` workers**: weakens the CSP and Trusted Types for every
  script that can create a blob.
