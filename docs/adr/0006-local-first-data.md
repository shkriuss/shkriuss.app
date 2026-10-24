# 0006. User data stays on the device

Status: Accepted (2026-10-16). Extended by [ADR 0009](0009-push-notifications.md):
an app may offer notifications while it's closed, opt-in, with messages
encrypted on the device. Extended by [ADR 0010](0010-account-and-sync.md): an
optional, end-to-end encrypted account to sync apps between devices. Extended
by [ADR 0013](0013-photos-on-the-device.md): photos are kept in IndexedDB.
Extended by [ADR 0016](0016-online-photo-library.md): Photos' optional online
library goes through the account and is kept in Cloudflare R2, free up to
10 GB, then paid.

## Context

Collect as little data as possible; anyone may use the apps.

## Decision

- Apps save data in the browser's `localStorage` through `@shkriuss/storage`
  (versioned, validated, with migrations). Nothing is sent to a server.
- Each app is its own origin, so apps can't read each other's data.
- Every app that saves data shows **Your data** (`<DataControls />`): back up,
  restore, or delete everything (backups: see [ADR 0008](0008-encrypted-backups.md);
  Photos has no backup, [ADR 0015](0015-photos-app.md)).
- Each app lists what it stores in `apps.json` (`dataStored`); the privacy
  page is generated from that.
- No cookies, no analytics.

## Consequences

- No accounts, no servers, no breach risk on our side, no cost.
- Data doesn't sync between devices, and clearing browser data deletes it.
  Downloading a copy is the backup.

## If an app needs sync or accounts later

Write a new ADR first. Preferred order: (1) file export/import, (2)
end-to-end encrypted sync where the server only stores encrypted blobs
(Cloudflare D1/KV/R2 behind a small Worker), (3) passkeys or Cloudflare
Access for sign-in. Never store passwords. Update the privacy page and the
token permissions in the same pull request, and flag any cost.
