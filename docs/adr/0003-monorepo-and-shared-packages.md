# 0003. Monorepo with a registry, design system and shared config

Status: Accepted (2026-10-16)

## Context

Goals: one shared design, a fix made once applies everywhere, and adding an
app is one small step.

## Decision

- A **pnpm workspace** with `apps/*` (sites) and `packages/*` (shared code).
  Internal packages are TypeScript source consumed directly (no build step).
- `packages/registry/apps.json` is the **single list of apps**. The hub's
  list, each app's name and icon, the privacy page table and the generator
  all read it. Unit tests check it against the `apps/` folders and each
  `wrangler.jsonc`.
- `@shkriuss/ui` holds tokens, CSS, components, the page shell and icons.
- `@shkriuss/astro-config` gives every site the same Astro settings plus a
  build step that writes `_headers`, the web manifest, icons and the service
  worker. An app's `astro.config.ts` is three lines.
- `templates/app` + `pnpm new-app` (or the **New app** workflow) create apps.
- Third-party versions are pinned once in the pnpm **catalog**.

## Consequences

- Design, headers, icons, offline support and tests change in one place.
- Shared code changes affect every site at once, which is the point, but
  makes CI important: every site is built and tested on every pull request.

## Alternatives

- **One repo per app:** isolated, but the design system would need publishing
  and every fix would mean many pull requests.
- **Auto-discovering apps from folders only:** one fewer file, but app
  metadata would be scattered and the privacy page harder to generate.
