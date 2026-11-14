# Catalog

Documents for Catalog (`app.shkriuss.catalog`), the design gallery used
during development. What each version changed is in its
[changelog](../../../android/app/catalog/CHANGELOG.md).

Pages:

- [Release checklist 0.3.0](release-checklist-0.3.0.md): the
  [release checklist](../../development/release-checklist.md), filled in
  for Catalog 0.3.0, with a sampling the owner chose instead of the
  full pass. Its parts 1 and 2 are also the look for the Phase 1 gate.
  Done: 0.3.0 was released on 2026-11-13.
- [Release checklist 0.2.0](release-checklist-0.2.0.md): the
  [release checklist](../../development/release-checklist.md), filled in
  for Catalog 0.2.0. Done: 0.2.0 was released on 2026-11-12.

Catalog 0.1.0 had no checklist. It was the rehearsal of the release flow
([release.md](../../development/release.md#rehearsal-with-catalog)).

Open, for the next change to Catalog:

1. Remove the receiver of `androidx.profileinstaller` in Catalog's
   manifest, as Water does. It is exported to callers with
   `android.permission.DUMP`, the system and the developer shell. The
   owner decided this for Water on pull request 40, and asked for Catalog
   to follow in its next change
   ([permissions.md](../../security/permissions.md#catalog-appshkriusscatalog)).
