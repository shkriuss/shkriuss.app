# ADR 0003: Local-only apps at launch, no accounts

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Three options were considered:

1. **Local-only:** apps that keep data on the device, with encrypted backups.
2. **Local-first plus a passkey account** with end-to-end encrypted sync.
3. **Cloudflare Access as the account system.**

Sync and key management are the hardest and riskiest parts of such a system. They are roughly as much work as the whole shared platform. The developer uses three devices across two ecosystems: an iPhone, a Pixel and a Pixel Tablet.

## Decision

- **Launch local-only.** User data never leaves the device except in a backup file the user exports, encrypted by default.
- **No accounts, no server-side user data and no backend in v1.**
- **The data model is sync-ready** ([ADR 0004](0004-local-data-and-backups.md)), so accounts can be added later without rewriting the apps.
- **If accounts are ever added,** they will be passkey-only, end-to-end encrypted, and optional per app. The design sketch is in [future/accounts-and-sync.md](../future/accounts-and-sync.md).
- **Cloudflare Access is never a user account system.** It is used only to keep staging private.
- **`account.shkriuss.app` stays reserved.**

## Consequences

- **The simplest and most private system.** There is no server-side user data to breach, the Cloudflare Free plan is enough, and the privacy policy stays short.
- **No automatic multi-device sync.** Moving data means export and import. Import merges, so it works like a manual sync.
- **Data safety depends on backups.** Backups are therefore a first-class feature with reminders.

## Alternatives considered

- **Passkey accounts with end-to-end encrypted sync now:** deferred. It is the riskiest part of the project and is better built on a platform that already works. The roadmap lists when to revisit it.
- **Cloudflare Access as the account system:** rejected.
  - It is built for small teams: free up to 50 users, then priced per user.
  - It needs an email address or a third-party identity.
  - It provides no encryption keys.
  - It blocks the app before it loads, which breaks offline use, installs and updates.
  - It ties user identities to one vendor.
- **Anonymous sync with pairing codes:** simpler than accounts, but clumsy across many apps on several devices. Not needed while the apps are local-only.
