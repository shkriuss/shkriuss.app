# 0001. Static sites built with Astro

Status: Accepted (2026-10-16). Extended by [ADR 0009](0009-push-notifications.md)
and [ADR 0010](0010-account-and-sync.md): optional features have server code
for `/api/*`. Pages are bigger than first guessed: see the budgets in
[ADR 0007](0007-testing-strategy.md).

## Context

The hub and the apps are small personal tools. The owner is a beginner and
works only from a phone, so the stack must be simple, well documented, fast
and private, with as little to maintain as possible.

## Decision

- Build every site with **Astro 7** in static mode: pages are HTML and CSS at
  build time, and JavaScript is only sent where a page asks for it.
- Write interactivity in plain **TypeScript** inside Astro `<script>` tags.
  Markup that scripts need to repeat goes in a `<template>`, which scripts
  copy and fill with `textContent`.
- No UI framework for now.

## Consequences

- Very small pages (about 7–9 KB gzipped each), quick to load on slow phones.
- No server code, so nothing to patch or secure on a server.
- Large, very interactive apps would get awkward in plain TypeScript. When
  one does, add **Svelte** islands (`@astrojs/svelte`, via the
  `integrations` option of `defineAppConfig`) for that app, with a new ADR.

## Alternatives

- **SvelteKit / Next.js:** more powerful, but more concepts and heavier
  output than these apps need.
- **No framework (hand-written HTML):** fewest dependencies, but no shared
  components or layouts, so the "one design system" goal is harder.
