# Sync

Documents for Sync (`app.shkriuss.sync`): the one app of the suite with
a network. It keeps the other apps the same on your phones and tablets,
through a server in your own Cloudflare account, and carries only what
that server cannot read.

Pages:

- [Specification](spec.md): the join steps, the screens Apps, Devices
  and Settings, which networks carry files, what a long transfer shows,
  the problems and what each says, what Sync keeps on the phone, what
  happens when something goes wrong, permissions and TalkBack notes, and
  what is out of scope for version 1.

How sync works:

- The protocol, every call and every rule:
  [sync-protocol.md](../../architecture/sync-protocol.md).
- The decisions: [ADR 0005](../../adr/0005-no-network-permission-in-data-apps.md)
  (no network in the data apps, the courier interface) and
  [ADR 0009](../../adr/0009-sync-protocol-and-server.md) (the protocol
  and the server).
- The server: `backend/` ([backend.md](../../development/backend.md)).
  What each data app does for sync: `android/core/sync-client`.

The app itself is `android/app/sync`, with everything but its screens
in `android/feature/sync`. Its screens are not built yet.
