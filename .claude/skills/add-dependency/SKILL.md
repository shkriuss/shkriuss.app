---
name: add-dependency
description: Evaluate and add an npm package safely. Use before adding or upgrading a major version of any dependency in this repository.
---

# Add a dependency

Every dependency is code we ship to users or run with full trust ([ADR 0007](../../../docs/decisions/0007-security-baseline.md)). First look for a way without one: the web platform, a package already in the catalog, or a few lines of our own code.

## 1. Evaluate

Put the answers in the pull request description.

- **Purpose:** what it does that we cannot reasonably do ourselves.
- **License:** `pnpm view <name> license`. A runtime dependency must use a license listed in `tooling/checks/license-policy.json`. Anything else: stop and ask the user.
- **Maintenance:** release history (`pnpm view <name> time --json`), maintainers, open security advisories.
- **Weight:** for runtime dependencies, the bundle-size cost and the number of transitive dependencies (`pnpm view <name> dependencies`).
- **Install scripts:** pnpm blocks them. If the package needs one, stop and ask the user before adding it to `allowBuilds`.
- **Browser safety (runtime dependencies):** it must work under the production security headers: no `eval` or `new Function`, no injected `<style>` tags, no remote resources, compatible with Trusted Types.

## 2. Add

1. Choose a version published at least 3 days ago; pnpm refuses newer ones (`minimumReleaseAge`).
2. Add `name: x.y.z` (exact version, keep the list sorted) to the `catalog:` in `pnpm-workspace.yaml`.
3. Reference it as `"name": "catalog:"` in the package's `dependencies` or `devDependencies`.
4. Run `pnpm install`, then `pnpm verify`.

## Never

- Add a dependency only to save a few lines.
- Add `allowBuilds` or `minimumReleaseAgeExclude` entries without the user's explicit approval.
- Load anything from a CDN or another origin at runtime.
