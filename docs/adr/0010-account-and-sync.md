# 0010. The shkriuss account, and syncing apps between devices

Status: Accepted (2026-10-17). Built in three parts: the account, Calendar and
Tally syncing through it, and replacing the account key after losing a
device. Extended by [ADR 0014](0014-syncing-photos.md): files like photos
sync too, each sealed on its own. Changed by [ADR 0017](0017-storage-limits.md):
each app's copies together have a limit, and copies (and replaced-key notes)
nobody uses for 13 months are deleted. Extended by
[ADR 0016](0016-online-photo-library.md): Photos' online library goes through
the account and is kept in Cloudflare R2, free up to 10 GB, then paid.
Changed by [ADR 0018](0018-passkey-signatures.md): the account service keeps
each passkey's public key, and only hands out or removes a lock for the
passkey's signature made on the Account page. Changed by
[ADR 0019](0019-no-pull-request-previews.md): there are no pull request
previews, so an app pairs only with the real hub (or, in tests, the local
one). Changed by audit 4 (F2-3): an app can keep both versions of the same
change too (`keepSame`, for counts), and only one tab of an app syncs at a
time (see "keep both" below). Changed by audit 5: an edit made with no
connection keeps its time (E-1); "Turn off" works when the browser is full
(E-2); replaced keys are kept for 13 months and apps are done with old keys
for good (A-1); the "turn off" links are for the day (A-5) and say nothing
when sync is already off (C-4); all device links share one object (B-2);
an app loads the code that connects it to the account only when that's
needed, so every page stays within its JavaScript budget (J-2). Changed by
audit 6: a key replacement whose answer was lost is finished the next time the
Account page opens, instead of signing that device out (A-1); "Turn on sync
for …" waits half a second before it works, like "Add this device" (A-2); a
device code's 10 minutes are counted by the clock of the device showing it,
and it's cancelled when it's hidden as expired (A-1); the hub asks the browser
to keep the account, as the apps keep their data (E-6); a device link costs 4
row writes, not 2 or 3, as deleting it counts too (see "Free quota"); a
deletion made with sync off or no connection is kept until it's online, even
after 180 days (S5); an edit keeps its time also when the app is put away
while a sync waits for the server (S22); an older version of an app keeps the
stores a newer one added in the copy (S4); when that code can't be loaded (a
page left open from before an update), "Turn on sync" says to reload the page
rather than check the connection (S40). Changed by audit 7: the Account page
asks the account service once as it opens and acts on that one answer, so a
replacement whose answer was lost is finished then or left for the next time,
never taken for a lost device's (A-1, run 27); the account service answers a
replacement with the note it keeps, so a device replacing a key that another
device replaced first signs out instead of taking it for done, and trying
again after a lost answer shows the same new key (A-2, run 27); a device
showing a code says a device opened it, not that one is signed in (A-6,
run 27); a copied recovery key comes with a word about clipboard histories
(A-3, run 39).

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
     device. The page says that on an iPhone or iPad a download usually goes
     to iCloud Drive, which Apple can read without Advanced Data
     Protection, so a password manager or paper is safer there (audit 6
     D-4). Copied, it says that some keyboards and computers keep a history
     of what's copied (some sync it), to clear once the key is pasted
     where it's kept (audit 7 A-3, run 39).
2. **Passkey (optional).** This works where the password manager supports the
   WebAuthn **PRF** extension, for example Google Password Manager on Android,
   or iCloud Keychain on iOS 18 and later.
   - The passkey produces a secret value. Two keys come from it: a wrap key and
     a lookup token.
   - The server keeps the account secret sealed with the wrap key (AES-256-GCM),
     stored under the SHA-256 hash of the lookup token.
   - The passkey belongs to the hub's own domain, `shkriuss.app`. Browsers let
     any subdomain ask for a passkey of its parent domain. Every app's pages
     refuse passkeys (their `Permissions-Policy` header), and
     `defineAppConfig` won't build an app that asks, but only Chromium-based
     browsers honour that header, and a page's new blank window gets around
     it even there (audit 3 C-4). So the account service also keeps each
     passkey's public key, and hands out or removes a lock only for the
     passkey's signature made on the Account page itself
     ([ADR 0018](0018-passkey-signatures.md)).
   - A passkey that can't do PRF is refused, and the browser is asked to forget
     it (WebAuthn "signal" API, where supported). So is one the account service
     says no lock uses.
   - "Remove a passkey" deletes its lock.
3. **Adding a device with a QR code.**
   - The signed-in device seals the secret with a new one-time 256-bit key.
     The account service keeps it under a random 128-bit id for 10 minutes.
   - The QR code is a link to the Account page with the id and the key after
     `#`. Browsers never send that part to any server.
   - The new device fetches the sealed secret once, then it's deleted. It
     immediately removes the key from the address bar, shows the account code,
     and asks before signing in.
   - The first device shows when the code has been used: that a device
     opened it, so it can sign in. It doesn't say the device is signed in,
     as its person may still tap Cancel (audit 7 A-6, run 27).
   - "Done" (or showing a new code, or signing out) cancels the code at
     once: the device that made it sends a token only it has
     (`DELETE /api/account/link/<id>`). If that doesn't get through, it keeps
     trying until the code expires, and says so if a device used it
     meanwhile (audit finding A-2: hiding the code used to leave it working,
     with nobody watching).
   - The device showing the code counts its 10 minutes by its own clock,
     from just before it sends the code to the account service, and
     cancels the code when it hides it then. Before, it compared the service's time of expiry
     with its own clock: one running 15 minutes ahead hid each code at once
     as expired, and left it working, unwatched (audit 6 A-1).

**Account code:** an 8-character fingerprint of the secret (40 bits from
HKDF), like `K7Q2-M9XD`.

- It's shown on every signed-in device, so people can check that their devices
  are on the same account.
- It's also shown before a link is accepted. That catches a link sent by
  someone else, which would otherwise sync your data to their account.

### What is kept where

- **On the device:** the account secret, in `localStorage` for the hub only,
  under `shkriuss-device:account`. It's never in backups, and signing out
  deletes it. On the device that replaced the key, the old keys are kept
  there too (at most 5, for 13 months each, as long as the account service
  keeps its note: [ADR 0017](0017-storage-limits.md), audit 5 A-1), so apps
  can move their old copies. A device signed out because its key was
  replaced elsewhere keeps nothing of it, as when signing out (audit 3 D-8).
  Once signed in, the Account page asks the browser to keep its data
  (persistent storage), as each app does after its first save, so it's
  less likely to be deleted when the device runs short of space (audit 6
  E-6).
- **On the hub's server.** The hub's Worker runs only for `/api/account/*`,
  with one Durable Object for all device links together (a row each), and
  one per passkey lock or replaced key. It stores:
  - sealed passkey locks;
  - sealed device links, for at most 10 minutes (expired ones are deleted
    by the next request, so a dropped alarm can't leave one behind:
    [ADR 0017](0017-storage-limits.md), audit 5 B-2);
  - a note that an account key was replaced, under the SHA-256 hash of a
    token only that key can make.

  There is no list of accounts and no account id, and nothing ties an entry
  to a person or to any app's data.

- **Checks on the server:**
  - Requests from other sites are refused (`Sec-Fetch-Site`).
  - Bodies are limited to 1 KB (4 KB for passkeys, which carry a signature
    and a public key).
  - Only sealed values of the right shape are accepted.
  - Shared helpers live in `packages/server`.

### Replacing the account key (a lost device)

A lost or stolen signed-in device holds the account secret. On a device the
person still has, **"Replace the account key"** on the Account page:

1. Makes a new secret and shows its recovery key. Nothing changes until the
   person confirms they saved it.
2. Tells the account service that the old key is replaced, for good
   (`PUT /api/account/status`, with a token derived from the old key). The
   note also holds a tag made from both keys (`successorTag`), which only a
   device that has both can check: one with only the old key learns nothing
   about the new one from it.
3. Signs this device in with the new key, and remembers the old one.

Before step 2, the device notes the new key it's replacing the old one
with. The service may note the old key while its answer is lost (the
connection drops, or the page is closed); then the next time the Account
page opens, the note's tag names that new key, which only this device
could have made, so it finishes step 3 instead of taking itself for a
lost device. Before, it signed out and forgot the old key, so no app could
move its old copy any more (audit 6 A-1). The page asks the service once as
it opens, and acts on that one answer: if the service can't be reached,
nothing changes until the next time. It used to ask twice, and when only
the first check failed, the second still took it for a lost device (audit 7
A-1, run 27).

The service answers step 2 with the note it keeps, and only the first
note counts. If its tag names another key, another device replaced the key
first (another of the person's, or the lost one): this device doesn't sign
in with its own new key, which no other device would have, but signs out,
as a device with a replaced key does, and says why. And "Replace the
account key" started again after an answer that never came shows the same
new key, so trying again finishes that replacement. Before, the service
answered every replacement alike: this device signed in with its new key,
kept the old one for the apps, and nothing ever told it (audit 7 A-2, run
27).

Then:

- **Every device with the old key** asks the account service when it opens
  the Account page, and signs out if the key was replaced. The old recovery
  key, links made with it, and passkeys that unlock it can't sign in any more,
  as long as the service keeps its note: 13 months after anyone last asked
  about it, an old passkey the person didn't remove signs in to the old key
  again ([ADR 0017](0017-storage-limits.md), audit 6 A-3).
  If the service can't be reached, the device carries on and checks next time.
  Signed out this way, it forgets the key and which apps synced there, as
  signing out does; the Account page names those apps, which keep syncing
  with the old key until sync is turned on in them again (audit 3 D-8). So
  only the device that replaced the key moves the apps' old copies; one that
  nobody moves is deleted once no device has used it for 13 months. The
  note's tag stays on the server for devices still on an older version of
  the hub, which check it when they sign in again.
- **A device keeps old keys only for the account that replaced them.** When
  it signs in, it keeps a replaced key only if the tag says the new account
  replaced it (or replaced a key that did). Signed in to another account (a
  link from someone else's device, say), it forgets them: their apps would
  otherwise move this account's old data into that one (audit finding A-3).
  Keys noted before the tag was added have none, and are forgotten too.
- **Apps.** The Account page lists the apps that sync, each with a link that
  opens the app and starts "Turn on sync" (`#sync=connect`). When an app
  connects, the hub also gives it its keys from the replaced account keys.
  The app's next sync brings the old online copy into the new one (merging as
  usual), then deletes the old copy, marked as moved. Devices still using the
  old copy turn sync off and say the key was replaced; their data stays. The
  lost device can still write anything to the old copy, so nothing in it can
  stop the move: a copy that doesn't open has nothing to bring and is
  deleted all the same, and one from a newer version of the app (or that
  fails the app's checks) waits until the app is updated, while syncing with
  the new key goes on. A replaced key with nothing online for the app gets
  the note that it moved too, so the lost device can't start a copy with it
  (audit 3 B-1); so does one whose copy was deleted, and "Delete the online
  copy" marks the old copies it deletes as moved. An app remembers the old
  keys it's done with (their copy moved here or on another device, or
  deleted) and never fetches them again, however often the hub hands them
  over; "Delete all data" forgets that list with the rest (audit 5 A-1).
- **Sync history.** A device keeps what it knew at its last sync when sync is
  turned off (by the person, or because the copy was deleted or moved), and
  keeps noting edits and deletions while it's off. Turning sync on again, with
  either key, then syncs those properly instead of starting over. "Delete all
  data" forgets it, and so does restoring a backup while sync is off, so older
  data never counts as new. Restoring while sync is on replaces the data on
  every device, on purpose: the restored data syncs as new edits, as the
  Restore dialog warns. When the browser has no room to keep that history
  as sync turns off, the key alone goes, and sync is off all the same: a
  later "Turn on sync" starts like the first time. Before, "Turn off" that
  couldn't be saved left sync on, while the page said it was off (audit 5
  E-2); if not even the key can go, the page says what's wrong instead.

### Syncing apps through the account

Code: `packages/sync`, plus `<SyncControls />` in `@shkriuss/ui`. An app opts
in with `sync: true` in `apps.json`.

- **Connecting an app ("Turn on sync").**
  - The app asks its own Worker where its hub is (`/api/sync/hub`; worked out
    from the app's address, so PR previews pair with their own hub), and
    keeps the time it answers with, to the millisecond, as when sync was
    turned on (see Storage, below).
  - It makes a one-time ECDH P-256 key pair, keeps the private half in this
    tab, and opens `/account/?connect=<app>&from=<its address>&key=…&state=…`.
  - The hub only continues if `from` is that app's real address (on the real
    site, `https://<app>.shkriuss.app`; in a preview, the same preview's app)
    and the one-time key is a real P-256 key (a link with 65 bytes that
    aren't one used to leave the confirm button busy for good: audit 5 A-3).
    After the person confirms, it derives the app's own key, seals it to the
    one-time public key, and goes back to the app with the result after `#`.
    Any website can open an app with `#sync=connect`: that only starts this
    request, which the person confirms on the hub with the account code in
    view, and cancelling changes nothing (audit 5 C-4). Like "Add this
    device", "Turn on sync for …" works only half a second after it's on
    screen in a window that has focus, so the second click of a
    double-click that website asked for, landing as its own window closes,
    can't confirm it (audit 4 C-6, audit 6 A-2).
  - The app opens it, removes it from the address bar, and forgets the
    one-time key. The app and the hub never call each other's servers, and
    the CSP stays `'self'`.
- **Turning sync off from the Account page.**
  - The hub can't see inside apps: they're other sites, and there are no
    cookies. So when the person confirms "Turn on sync for …", the hub
    remembers on this device which app it was, at which address, with which
    account code (`shkriuss-device:synced-apps`). Signing out forgets it, and
    a new account key (another code) starts again with every app off.
  - For those apps, the list of apps says "Turn off sync in …". The link opens
    the app with `#sync=off&proof=…`. The proof comes from the app's own key
    (HKDF, `turnOffProof`), so only the account the app syncs with can make
    it: a link from anyone else leaves sync on, and the app says so. It's
    made for the day, and the app takes today's and yesterday's, so a link
    that lands in the browser's history (which browsers sync to their own
    servers) can't turn sync off for good; the page makes fresh links each
    time it comes back on screen (audit 5 A-5).
  - Sync turned off inside the app isn't seen by the hub. Its link still says
    "Turn off" until it's tapped, which then finds sync already off, and
    changes nothing and says nothing: any website can open the link too
    (audit 5 C-4).
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
    Moving to a new account key does the same, with a note that it moved.
  - Turning sync on again after a deletion starts a new copy (a moved one
    can't be started again). The note says when the copy was deleted, and
    each device notes when sync was last turned on there (with the same key
    or another), both by the sync server's clock (to the millisecond), so a
    wrong clock on a device can't change the answer. A device where sync was turned on after
    the deletion starts the new copy, or joins one another device started.
    Every other device turns off, whether it had synced yet or not, before
    it puts any files there: a new copy keeps when the copy before it was
    deleted, for that check (audit 4 E-1). An app still running a version
    from before this (a page left open, or the first time it opens after
    the change, while the update downloads) doesn't check, and would join
    a copy started again; the next time it opens, it does.
    The copy asks the storage meter (another object) before it deletes
    anything, so a request that fails half-way deletes nothing and can be
    tried again (audit 3 B-1).
  - If what a device knew can't be saved after a sync saved the data (the
    browser is full), the data is put back as it was, and the sync just
    failed: otherwise the next one would take what came in for new edits
    made on this device (audit 3 E-1).
  - Limits: about 1.4 MB of compressed data per app, and 120 changes per 10
    minutes per account.
  - The Worker only reads an upload, in one go, and passes it on; the copy's
    object checks the rest. Reading a full-size copy piece by piece took the
    Worker 11 to 36 ms of CPU time on Cloudflare, and checking it about 8 ms
    more, over the free plan's 10 ms (audit finding B-9). Now it takes at
    most about 6 ms. An object has 30 seconds.
- **The copy.** The data of every synced store, as JSON, compressed (gzip),
  then sealed with AES-256-GCM, labelled with the app's name. A device
  doesn't open a copy that would unpack to more than 64 MB (real copies are a
  few MB): a lost device could otherwise upload a few KB that unpack to
  gigabytes and crash the app wherever it's opened.
- **Merging** (`packages/sync/src/merge.ts`).
  - An app's data is a list of items with ids, such as Calendar's events or
    Tally's counters.
  - Each item carries the time it last changed, inside the encrypted copy.
    When two devices both changed an item, the newest change wins. A change
    always gets a time after the version it was made from, so a device
    whose clock is behind doesn't lose its own edits. The time is that of
    the sync a moment after the change, or, when that sync can't reach the
    copy (no connection) or the app is put away before it's done, the time
    it noted the change then: before, a change made on day 1 with no
    connection got the time of the first sync that reached the copy, day 21
    say, and beat a newer change made elsewhere on day 10 (audit 5 E-1).
    That includes a change made while a sync waits for the server, and one
    noted while an upload is on its way, which that upload's last step
    used to save over (audit 6 S22).
  - Deleting leaves a marker with the time, so deletions sync. Markers are
    dropped after 180 days. A device away longer still deletes an item it
    saw in the copy that the same copy no longer has, unless it changed the
    item since. A marker made on a device with sync off, or with no
    connection, stays until a sync has taken the deletion online, however
    long that takes: before, the first edit there after 180 days dropped it,
    and the item came back on every device (audit 6 S5).
  - The list's order is merged the same way: the newest move wins. Adding or
    deleting an item isn't a move, so it doesn't undo a move made on another
    device (audit finding E-12). Items only the other device has go where it
    put them: just before the item that followed them there, or at the end.
  - On a device's first sync, its items count as older than what's already
    online, so turning on sync (say, after restoring an old backup) never
    overwrites newer edits. Its other items are added.
  - **Keeping both versions (optional, per app).** An app can ask for this
    instead of "newest wins" with `conflictCopy`; Calendar, Meals, Notes,
    Reminders, Shelf and Tally do. When an item was changed on this device and on another since
    this device's last sync, the other device's version keeps the item and
    this device's becomes a new item, named "… (second version)"
    (`secondVersionName`, which shortens the name to fit the app's
    limits). A change also wins over a
    deletion on another device, so no edit is lost. The same change made
    on both is one edit, unless the app also asks for `keepSame`, for
    items whose changes are events: Tally does, so a glass counted on each
    device (5 to 6 on both) is kept twice, but 0 on both (a reset on each)
    is one change (audit 4 F2-3). A change is known by the moment the
    device's sync first noted it; two tabs of one device syncing at once
    would each note the same change at a moment of their own, so only one
    tab of an app syncs at a time (`navigator.locks`; a tab waits at most a
    minute for another, which could be frozen in the background). Two
    devices whose clocks are both behind the last change note theirs at the
    same moment, and those still count as one, as before. It starts from a
    device's second sync after updating to this version, because it needs to
    know which data version the device last synced.
  - Data from a newer version of the app is never overwritten: the older
    device waits until it updates. That includes single items a newer
    version added without a new data version (a currency an older version
    doesn't offer, say): an app drops or changes items it can't read, and
    those would spread as deletions, so the device waits instead of saving
    them (audit finding F2-8). A whole store that a newer version syncs and
    this one doesn't (one an app adds to `createSync` later) is kept in the
    copy as it is, and so are the photos online: before, an older version
    left the store out of its upload, and a newer device then took what it
    had seen there for deleted long ago, and deleted it everywhere (audit 6
    S4). An old key's copy with such a store waits for a device that syncs
    it to bring it along, and so does a copy older than one the device saw
    (see "What a server could do" below), whose store would be older too.
    Older data is upgraded with the store's own
    migration and checked with its own validation before it's saved. After
    such an update, only what was really changed on a device counts as
    edited: it compares with its data as still saved in the old version.
  - Data on the device that this version can't read (from a newer version,
    after a rollback, or failing its own checks) is never saved over or
    synced: the device says so and waits for an update.
- **When devices sync:** when the app opens or comes back on screen, about
  1.5 seconds after each change, every minute while it's open, and with
  "Sync now". A request that gets no answer within 20 seconds (more for a
  big copy or photo on a slow connection) counts as no connection: the app
  says so and tries again later, instead of waiting for ever on a network
  that hangs. The Account page's requests and Photos' online library have
  the same limit.
- **What app servers can see:** that an account uses the app, how big its
  copy is, and when it changes. Never the contents, and not which account is
  whose.
- **What a server could do if it went wrong** (audit finding A-8). It can't
  read or change the data, or pass one app's or account's copy off as
  another's: every copy is sealed and labelled. It could hold back changes,
  answer "no change" when there is one, keep an old copy, or say the copy
  was deleted (devices then turn sync off and keep their data). An old copy
  deletes nothing on devices, whether the server was restored from a backup
  or sends it on purpose: each copy carries how many times devices have
  written it, sealed so the server can't change it, and a device that has
  seen a newer copy merges an older one like a device that was away, without
  taking what it lacks as deleted. A copy from before that count existed is
  older than any that has it, whatever version the server gives it
  (audit 3 B-3). Whoever controls the servers could also
  change the apps themselves, so these limits matter most for mistakes.
- **What doesn't sync:** settings that belong to one device, such as
  whether to send reminders while the app is closed (the device's
  notification settings), reminder bookkeeping and the theme. An app's
  reminder times are part of its data, and do sync (Water, Meals and Budget
  keep them as settings; audit 6 D-1). "Delete all data" turns sync off on
  that device first, so the deletion doesn't spread.

## Consequences

**Good**

- There are no passwords to leak and no personal data.
- Servers hold only sealed values.
- It works without Google: the recovery key and QR codes work everywhere.
- Free plan: Durable Object requests are counted against the same
  100,000-a-day allowance as notifications. An account uses a handful per
  sign-in, and a device code one every 2 seconds while it's shown (up to 300
  in its 10 minutes); an app with sync uses about one a minute while it's
  open, and one or two per change.

**Costs and limits**

- **Lost recovery key.** If the person loses the recovery key and every
  signed-in device, the account and anything synced are gone for good. The
  Account page and the downloaded key file say so.
- **Lost device.** Replacing the key protects each app from the moment its
  sync is turned on again (on any of the person's devices), which moves its
  copy to the new key. Until then, the lost device can still see and change
  that app's online copy, so the Account page lists the apps still on the
  old key. Anything synced before could already have been read on the lost
  device.
  - Edits made on the lost device before an app moves its copy come along
    with the move.
  - Someone holding the lost device could replace the key first. Then the
    person's own devices are signed out (also the one where they then
    replace it: audit 7 A-2, run 27); they create a new account and turn
    on sync again, and their data comes along from their devices.
  - If the lost device also has the person's password manager, a new passkey
    would reach it too. The Account page says to remove the device from the
    password manager first.
  - Notifications while an app is closed ([ADR 0009](0009-push-notifications.md))
    aren't tied to the account: each device has its own random key for
    them, which only it knows. So replacing the key doesn't stop them on the
    lost device: its repeating reminders keep arriving there (an Android
    lock screen shows their titles by default) until it's erased, its
    browser stops allowing the app's notifications, or the app hasn't been
    opened on it for 13 months. Nothing the person's other devices do can
    stop them. The Account page and the privacy page say so, and to erase or
    lock the lost device remotely (Find My, Find My Device) (audit 3 A-1).
- **Passkey support varies.** Where a password manager can't do PRF, the
  recovery key and QR codes still work.
- **Device clocks decide "newest".** A device whose clock is far off can win
  or lose a conflict it shouldn't. Edits on different items never conflict.
  Deleting by age (Water's drinks older than a year, Meals' old plans and
  shopping lists) would let a clock set years ahead delete what every
  device still keeps, so while sync is on it counts back from the sync
  server's clock at the last sync (each answer says its time in `Date`),
  never from a later date on the device (`trustedNow`, audit F1-4). With
  sync off it's the device's own clock, or old data would never go: what a
  clock set far ahead deletes then reaches the others only if sync is
  turned on again.
- **Same item, two devices.** When the same item is changed on two devices
  before they sync, changes aren't combined. In apps that keep both
  versions, the person ends up with two items to tidy by hand: for Tally,
  counting the same counter on two devices at once gives two counters to add
  up; in Calendar, both events keep their reminder until one is deleted. In
  the other apps the newest change wins, and the other device's change to
  that item is lost.
- **iPhone Home Screen apps** keep their own storage, separate from Safari. An
  app added to the Home Screen may need its own sign-in on the hub when it
  connects.
- **Someone sees the QR code.** Anyone who sees a QR code before it's used,
  cancelled ("Done") or expired could use it first. The device showing it
  then says a device opened it and to replace the key if it wasn't one of
  the person's, and the person's own device says someone already used the
  code, so it's noticed.
- **The account code is 8 characters (40 bits).** It catches a link from
  someone else by mistake, but a determined attacker who knows a person's
  code could make an account with the same code by brute force. Linking only
  from a code you just made on your own device is what's safe.
- **Signing out** forgets the account on that device, but each app there
  keeps its own key and syncs until its sync is turned off; the sign-out
  dialog lists those apps.
- **Free quota.** As with [ADR 0009](0009-push-notifications.md), someone
  determined could use up the daily free quota. Things would pause until the
  next day; nothing is exposed and nothing costs money. Someone could also
  fill one app's room for online copies, which doesn't reset daily
  ([ADR 0017](0017-storage-limits.md)). Besides the 100,000 requests a day,
  the free plan allows 100,000 row writes a day for every app's objects
  together (each `setAlarm()` is one, and so is each row deleted), and
  those run out first: a device link writes 4 rows in all (2 when it's
  made, and 2 more when it's deleted after it expires; the first link also
  sets an alarm), a stranger's first sync copy about 7, so some 14,000 to
  25,000 such requests pause the online features until 00:00 UTC, far
  fewer than the requests allowed (`tests/unit/free-plan.test.ts` pins
  those counts: audit 5 B-4). Links made late in a UTC day are deleted
  after midnight, out of the next day's writes. (Until audit 6 this said
  2 or 3 rows a link, and up to 50,000 requests: the deletes weren't
  counted.)
- **Two tabs of an app, one of them syncing.** Only one tab syncs at a
  time, but the other saves as usual, and the browser passes writes between
  tabs with a delay: a save in the other tab that lands in the few
  milliseconds between a sync's reading of a store and its saving of the
  merge is overwritten by the merge. It needs an edit at that very moment
  (a few milliseconds a minute in the biggest apps); closing it would take
  a lock around every save in every app, so it stays as it is (audit 5
  E-9, a suspicion: it can't be shown in the tests' shared storage).
- **The hub now runs a small Worker for `/api/account/*`.** Every other request
  is still a static file.
- **QR codes are made by our own encoder** (`packages/ui/src/lib/qr.ts`), not a
  dependency. It's tested module for module against two independent encoders,
  for every mask, at versions 1, 2, 4 to 7 and 10 (the encoder goes up to
  version 10).

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
