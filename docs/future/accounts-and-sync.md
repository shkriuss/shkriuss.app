# Future: accounts and end-to-end encrypted sync

- **Status:** design sketch, **not approved for implementation** (see [ADR 0003](../decisions/0003-local-only-at-launch.md)).
- **Facts checked:** 2026-10. Browser and platform support changes quickly; re-verify everything here before writing an ADR.

## When to revisit

- Moving data between devices with backup files has become a burden, or
- other people need the apps on several devices.

## What we keep today so this stays possible

- Sync-ready records ([ADR 0004](../decisions/0004-local-data-and-backups.md)).
- `account.shkriuss.app` stays reserved.
- Each app's own origin can serve `/api/*` later (Workers `run_worker_first` routes), so no CORS and no new subdomains would be needed.

## Sketch

- **Optional, per app.** Local-only stays the default. Turning sync on uploads encrypted copies of the existing data.
- **Passkeys only** (WebAuthn, relying-party ID `shkriuss.app`). No email, password or name; an account is a random id plus its passkeys.
- **Keys.**
  - A random 256-bit master key, which the server stores only in wrapped (encrypted) form. One wrapped copy per passkey, using a key derived (HKDF) from that passkey's PRF output, and one copy wrapped by a 256-bit recovery key that the user saves.
  - A key per app, derived with HKDF.
  - A random key per collection, so a collection can later be shared with another account.
  - Records are encrypted with AES-256-GCM, padded, and bound to their ids.
  - WebCrypto only.
- **Unlocking.** One passkey tap per app on each device, because each origin — and on iOS each installed app — has its own isolated storage. The app key is then kept on the device as a non-extractable `CryptoKey`.
- **PRF support (2026-10).**
  - Works with iCloud Keychain (iOS/macOS 18+), Google Password Manager, 1Password, Proton Pass and YubiKey 5.2+.
  - Windows Hello: only on recent Windows 11 (24H2 or later).
  - Unreliable in Dashlane, Bitwarden and Samsung Pass.
  - Therefore:
    - an account's first passkey must support PRF;
    - devices without PRF unlock with a phone via QR code (hybrid transport), or with the recovery key;
    - PRF support is detected from actual results, never from `getClientCapabilities()`.
- **Backend.**
  - Each app's Worker forwards `/api/*` to one backend Worker through a service binding: same origin, no CORS.
  - One SQLite-backed Durable Object per user.
  - The account id is stored in the passkey's user handle, so there is no central user table.
  - Sessions use per-app `__Host-` cookies (HttpOnly, Secure, SameSite=Strict).
- **Sync protocol.**
  - The server stores opaque `(id, version, ciphertext)` rows.
  - Push is a per-record compare-and-swap. On a conflict, the client decrypts both versions and merges them with the ADR 0004 rules.
  - Pull fetches the changes after version N.
  - The server can see only the account id, which apps sync, how many records there are and their (padded) sizes, and when syncing happens.
- **Operations.**
  - Move to Workers Paid ($5/month) once other people use sync. The Free plan allows 100,000 Worker requests per day, 10 ms CPU per request and 5 GB of Durable Object storage.
  - Worker Previews' service bindings reach the production backend, so staging needs a separately named backend.
  - Every backend deploy restarts the Durable Objects and drops open WebSockets.
  - Durable Object point-in-time recovery keeps data for up to 30 days after deletion. This must be disclosed.

## Rejected alternatives

- **Cloudflare Access as the account system:** see ADR 0003.
- **Related Origin Requests** to limit which subdomains can use the passkeys: every major browser supports it since 2026, but the server already verifies origins and releases wrapped keys only after a verified sign-in, so it would add a moving part for little gain.
- **Existing sync engines:**
  - Jazz 2 makes its server a trusted authority, so it is no longer end-to-end encrypted.
  - secsync is dormant.
  - Evolu is good, but brings its own identity model, and its relay does not run on Durable Objects.
