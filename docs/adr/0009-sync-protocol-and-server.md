# 0009 Sync protocol and server

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 5, 6, 7, 10, 13 and 16, and
  the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- Sync is optional. Every app works fully without it (section 1).
- The Sync app moves ciphertext only. See
  [0005](0005-no-network-permission-in-data-apps.md).
- The threat model defends against a compromised or curious sync server,
  and against takeover of the Cloudflare account (section 10). Traffic
  analysis of sync timing and sizes is out of scope.
- The Cloudflare free plan sets these limits: 10 ms CPU per request,
  100,000 requests a day, and 100,000 D1 row writes a day.

## Decision

1. The server is one Cloudflare Worker.
   - D1 holds encrypted records with server-assigned sequence numbers. Each
     record is one opaque blob. See [0006](0006-tink-and-key-hierarchy.md).
   - R2 holds encrypted file chunks.
2. Devices pull changes since a cursor and push batches.
3. Conflicts are resolved on the device. The last writer wins per record,
   with deletion markers.
4. The design stays within the free-plan limits above.
5. Each device signs with its own non-exportable key. The server checks it
   (section 6).
6. Each user deploys the backend to their own Cloudflare account from this
   repository.
7. The backend is licensed AGPL-3.0. See [0018](0018-licences.md).

## Options rejected

- **Durable Objects.** More moving parts than one Worker with D1 and R2
  needs. Revisit this for live push.
- **CRDT libraries.** Their cores are native code or JavaScript, which the
  apps cannot ship. One user with a few devices does not need them.
- **Resolving conflicts on the server.** Impossible, because the server
  sees only ciphertext.

## Consequences

- The server stores only ciphertext.
- When two devices change the same record, the last write wins.
- Deleted records stay as deletion markers. Synced records are never
  hard-deleted (section 5).
- A user who wants sync needs a Cloudflare account. The self-hosting guide
  goes in `docs/self-hosting/`.
- A `backend` workflow comes later (section 13).
- A sync format change bumps the format version, keeps readers for every
  older version, adds a decision record, and updates `docs/architecture/`
  ("Changing formats" in [CLAUDE.md](../../CLAUDE.md)).
- Phase 5 ends when three devices stay consistent through offline edits and
  conflicts (section 16).
- Open: the protocol details. These include the request and response
  formats, cursors, batching, file chunks, the conflict rules, when
  deletion markers may be purged, a hostile server, and lost or revoked
  devices. They come in `docs/architecture/sync-protocol.md` in Phase 5,
  step 1, which completes this record
  ([PROMPTS.md](../development/PROMPTS.md)).
