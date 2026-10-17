# 0010. The shkriuss account, and syncing apps between devices

Status: Accepted (2026-10-17). Part 1 (the account) and part 2 (Calendar and
Tally syncing through it) are built. Part 3 (replacing the account key after
losing a device) is planned.

## Context

People want the same data on their phone, tablet and computer. That needs a
server, so it changes "data stays on the device" ([ADR 0006](0006-local-first-data.md)).
The requirements:

- **Optional.** Every app keeps working fully without it.
- **End-to-end encrypted.** Servers only ever hold data they can't read.
- **No personal data.** No email, password or name.
- **Works without Google,** for example on GrapheneOS.
- **Free plan only.**
- **Separate origins.** Each app is its own origin (`<app>.shkriuss.app`), so
  apps can't share browser storage, and the CSP only lets a page talk to its
  own origin.

## Decision

### The account lives on the hub

- The **Account page** (`shkriuss.app/account/`) creates and holds the account
  on each device. The account is a random 256-bit **account secret**, made on
  the device.
- Every key comes from the secret with HKDF-SHA-256 and a label for its
  purpose. Code: `packages/account`, `packages/crypto`.
- **Apps never see the account secret.** When an app connects, the
  hub gives it only that app's own key, derived with the app's name. A bug in
  one app can't expose the account or another app.

### Signing in: three ways, no email, password or name

1. **Recovery key.** The secret written out as 56 letters and digits, in 14
   groups of 4.
   - It uses Crockford base32, which has no I, L, O or U, so letters can't be
     mistaken for digits.
   - The last group is a check computed with SHA-256, so typos are caught.
   - It's shown when the account is created. The account isn't saved until the
     person confirms they've saved the key.
   - It can be downloaded as a text file, and seen again on any signed-in
     device.
2. **Passkey (optional).** This works where the password manager supports the
   WebAuthn **PRF** extension, for example Google Password Manager on Android,
   or iCloud Keychain on iOS 18 and later.
   - The passkey produces a secret value. Two keys come from it: a wrap key and
     a lookup token.
   - The server keeps the account secret sealed with the wrap key (AES-256-GCM),
     stored under the SHA-256 hash of the lookup token.
   - The passkey belongs to the hub's own domain.
   - A passkey that can't do PRF is refused, and the browser is asked to forget
     it (WebAuthn "signal" API, where supported).
   - "Remove a passkey" deletes its lock.
3. **Adding a device with a QR code.**
   - The signed-in device seals the secret with a new one-time 256-bit key.
     The account service keeps it under a random 128-bit id for 10 minutes.
   - The QR code is a link to the Account page with the id and the key after
     `#`. Browsers never send that part to any server.
   - The new device fetches the sealed secret once, then it's deleted. It
     immediately removes the key from the address bar, shows the account code,
     and asks before signing in.
   - The first device shows when the code has been used.

**Account code:** an 8-character fingerprint of the secret (40 bits from
HKDF), like `K7Q2-M9XD`.

- It's shown on every signed-in device, so people can check that their devices
  are on the same account.
- It's also shown before a link is accepted. That catches a link sent by
  someone else, which would otherwise sync your data to their account.

### What is kept where

- **On the device:** the account secret, in `localStorage` for the hub only,
  under `shkriuss-device:account`. It's never in backups, and signing out
  deletes it.
- **On the hub's server.** The hub's Worker runs only for `/api/account/*`,
  with one Durable Object per link or passkey lock. It stores:
  - sealed passkey locks;
  - sealed device links, for at most 10 minutes.

  There is no list of accounts and no account id, and nothing ties an entry
  to a person or to any app's data.

- **Checks on the server:**
  - Requests from other sites are refused (`Sec-Fetch-Site`).
  - Bodies are limited to 1 KB.
  - Only sealed values of the right shape are accepted.
  - Shared helpers live in `packages/server`.

### Syncing apps through the account

Code: `packages/sync`, plus `<SyncControls />` in `@shkriuss/ui`. An app opts
in with `sync: true` in `apps.json`.

- **Connecting an app ("Turn on sync").**
  - The app asks its own Worker where its hub is (`/api/sync/hub`; worked out
    from the app's address, so PR previews pair with their own hub).
  - It makes a one-time ECDH P-256 key pair, keeps the private half in this
    tab, and opens `/account/?connect=<app>&from=<its address>&key=…&state=…`.
  - The hub only continues if `from` is that app's real address (on the real
    site, `https://<app>.shkriuss.app`; in a preview, the same preview's app).
    After the person confirms, it derives the app's own key, seals it to the
    one-time public key, and goes back to the app with the result after `#`.
  - The app opens it, removes it from the address bar, and forgets the
    one-time key. The app and the hub never call each other's servers, and
    the CSP stays `'self'`.
- **Storage.**
  - The app's own key gives two more keys: a token for its server, and a key
    for the data.
  - Each app's Worker keeps one sealed copy per account, in a Durable Object
    (`SyncCopy`) named by the token's SHA-256 hash, with a version number.
  - An upload must name the version it was based on. If another device wrote
    first, the server says so (409) and the device merges again; nothing is
    overwritten unseen.
  - "Delete the online copy" deletes the data and leaves a small note, so
    other devices learn it was deleted and turn sync off (keeping their data).
  - Limits: about 1.4 MB of compressed data per app, and 120 changes per 10
    minutes per account.
- **The copy.** The data of every synced store, as JSON, compressed (gzip),
  then sealed with AES-256-GCM, labelled with the app's name.
- **Merging** (`packages/sync/src/merge.ts`).
  - An app's data is a list of items with ids, such as Calendar's events or
    Tally's counters.
  - Each item carries the time it last changed, inside the encrypted copy.
    When two devices both changed an item, the newest change wins.
  - Deleting leaves a marker with the time, so deletions sync. Markers are
    dropped after 180 days.
  - The list's order is merged the same way; new items from the other device
    go at the end.
  - On a device's first sync, its items count as older than what's already
    online, so turning on sync (say, after restoring an old backup) never
    overwrites newer edits. Its other items are added.
  - Data from a newer version of the app is never overwritten: the older
    device waits until it updates. Older data is upgraded with the store's own
    migration and checked with its own validation before it's saved.
- **When devices sync:** when the app opens or comes back on screen, about
  1.5 seconds after each change, every minute while it's open, and with
  "Sync now".
- **What app servers can see:** that an account uses the app, how big its
  copy is, and when it changes. Never the contents, and not which account is
  whose.
- **What doesn't sync:** settings that belong to one device, such as
  notifications, reminder bookkeeping and the theme. "Delete all data" turns
  sync off on that device first, so the deletion doesn't spread.

## Consequences

**Good**

- There are no passwords to leak and no personal data.
- Servers hold only sealed values.
- It works without Google: the recovery key and QR codes work everywhere.
- Free plan: Durable Object requests are counted against the same
  100,000-a-day allowance as notifications. An account uses a handful per
  sign-in or linked device; an app with sync uses about one a minute while it's
  open, and one or two per change.

**Costs and limits**

- **Lost recovery key.** If the person loses the recovery key and every
  signed-in device, the account and anything synced are gone for good. The
  Account page and the downloaded key file say so.
- **Lost device.** A lost or stolen signed-in device holds the account secret.
  A planned "replace the account key" step (pull request 3) will lock it out.
- **Passkey support varies.** Where a password manager can't do PRF, the
  recovery key and QR codes still work.
- **Device clocks decide "newest".** A device whose clock is far off can win
  or lose a conflict it shouldn't. Edits on different items never conflict.
- **Same item, two devices.** When the same item is changed on two devices
  before they sync, one change is kept whole (the newest), not combined. For
  Tally, two devices counting the same counter at the same time keep one count.
- **iPhone Home Screen apps** keep their own storage, separate from Safari. An
  app added to the Home Screen may need its own sign-in on the hub when it
  connects.
- **Someone sees the QR code.** Anyone who sees a QR code within its 10 minutes
  could use it first. The first device then says it was used, while the
  person's own device sees an error, so it's noticed.
- **Free quota.** As with [ADR 0009](0009-push-notifications.md), someone
  determined could use up the daily free quota. Things would pause until the
  next day; nothing is exposed and nothing costs money.
- **The hub now runs a small Worker for `/api/account/*`.** Every other request
  is still a static file.
- **QR codes are made by our own encoder** (`packages/ui/src/lib/qr.ts`), not a
  dependency. It's tested module for module against two independent encoders,
  for every mask, at versions 1 to 10.

## Alternatives

- **Email and password accounts.** These need personal data and stored
  passwords, and servers that authenticate people. Not needed for sync.
- **One central sync server that every app calls.**
  - Apps would make requests to another origin, which our CSP and "own origin
    only" rule forbid.
  - PR previews would talk to the real server.
- **Passkeys in every app** (one passkey for all subdomains).
  - Every app would hold the whole account secret.
  - Devices without PRF would still need another way in, in every app.
- **The secret derived directly from a passkey.**
  - That allows only one passkey per account.
  - Accounts made with a recovery key could never add one.
- **The secret itself in the QR code or link.** It would stay in browser
  history, which browsers may sync to their own servers.
- **A cookie on `.shkriuss.app` to share the key between apps.** Browsers send
  cookies to the server with every request.
- **A QR code library.** A dependency for about 300 lines of well-defined code.
