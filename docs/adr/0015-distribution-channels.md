# 0015 Distribution channels

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 13), 12, 14 and 16

## Context

- The project has no Google developer registration for now. See
  [0016](0016-no-google-developer-registration-for-now.md).
- Releases are draft GitHub releases that the owner publishes. See
  [0014](0014-release-flow-and-reproducible-builds.md).

## Decision

1. Now: GitHub Releases, installed and updated with Obtainium.
2. Users verify the signing certificate with AppVerifier against the
   fingerprints on the hub site.
3. Later:
   - IzzyOnDroid.
   - An F-Droid-format repository on a subdomain.
   - The main F-Droid repository, through its reproducible-build route.
   - Accrescent, when it reopens to new apps.

## Options rejected

None recorded. The later channels are deferred, not rejected.

## Consequences

- The hub site must show the signing fingerprints. Only the owner provides
  them, in `docs/security/fingerprints.md`.
- The user docs explain how to install and verify (section 12).
- The Phase 0 gate includes installing Catalog through Obtainium
  (section 16).
- The route into the main F-Droid repository depends on reproducible
  builds. See [0014](0014-release-flow-and-reproducible-builds.md).
