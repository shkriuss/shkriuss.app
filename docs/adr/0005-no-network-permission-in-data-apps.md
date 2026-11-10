# 0005 No network permission in data apps, separate Sync app

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 4), 3, 4, 7, 10
  and 16, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- Every app works fully with no account and no network (section 1).
- Sync is optional.
- The threat model defends against other apps on the device, network
  attackers, and a compromised or curious sync server (section 10).

## Decision

1. Data apps have no network permission. They never declare
   `android.permission.INTERNET`.
2. A separate Sync app, `app/sync`, does all networking. It is the only app
   with the network permission.
3. Courier model: each data app exposes a signature-protected interface. It
   hands out encrypted change-sets and encrypted file streams. The Sync app
   moves ciphertext only.
4. WorkManager is used in the Sync app only (section 3).

## Options rejected

- **The network permission in every data app.** Every app could then reach
  the network. With no permission declared, anyone can check on any Android
  that a data app cannot connect. Only one small app needs a network audit.
  The cost is accepted: more work, and sync needs a second app.

## Consequences

- Each data app works fully without the Sync app.
- The Sync app never sees plaintext.
- A signature-protected interface only works between apps signed with the
  same key. The whole suite has one signing key. See
  [0013](0013-signing-key-custody-and-rotation.md).
- On GrapheneOS, revoking the network permission changes nothing for data
  apps, because they declare none (section 16).
- The protocol and the server are in
  [0009](0009-sync-protocol-and-server.md).
- Open: the details of the interface. They are designed in Phase 5, step 1,
  which completes this record ([PROMPTS.md](../development/PROMPTS.md)).
