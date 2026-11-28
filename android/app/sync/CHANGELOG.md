# Sync changelog

Sync (`app.shkriuss.sync`) keeps the apps of shkriuss.app the same on
your phones and tablets, through a server in your own Cloudflare
account. It carries only what that server cannot read. Its
specification is [docs/apps/sync/spec.md](../../../docs/apps/sync/spec.md).

## Unreleased

Not released yet.

- The app starts, and shows one line: "Sync's screens are not built
  yet." The screens replace it.
- Everything Sync does without its screens is in place, with tests:
  - joining a server: the address, the server's answer, a setup code
    kept until the join ends, this phone's key, made in the Keystore and
    never leaving it, the join that an app with your recovery key signs,
    and the server's every answer to it;
  - a run: every 15 minutes with a network, soon after an app asks, and
    when you ask. It fetches what changed, sends each app's changes,
    moves files only on Wi-Fi unless **Files on mobile data** is on,
    and compares everything when an app asks. Each step can stop and go
    on at the next run;
  - what stops sync, in the order Sync shows it, and the waits: until
    00:00 UTC after the server's limit for the day, every 4 hours after
    three runs that could not reach the server, and a full server;
  - the list of devices, a new name for this phone, removing a device,
    a code to add a device, leaving the server and closing it.
- Sync talks only to the server you type: over HTTPS, with the
  authorities built into Android, no redirect, and one `User-Agent` for
  every phone.
- Sync answers only the apps of shkriuss.app signed with its own
  certificate, and keeps nothing of theirs but where each one stands.
