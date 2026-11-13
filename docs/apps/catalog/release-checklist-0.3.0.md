# Catalog 0.3.0 release checklist

Copied from the [release checklist](../../development/release-checklist.md)
for this release. Tell Claude what you checked, and Claude ticks the
boxes in the pull request that records the release.

| | |
|---|---|
| App | Catalog, `app.shkriuss.catalog` |
| Preview | Catalog preview, `app.shkriuss.catalog.preview` |
| versionName | `0.3.0` |
| versionCode | `300900`, by the rule in [ADR 0021](../../adr/0021-version-names-and-version-codes.md) |
| Tag | `catalog-v0.3.0` |
| What changed | [Catalog changelog](../../../android/app/catalog/CHANGELOG.md), 0.3.0 |

"Every screen" means the start screen and all 24 pages it lists. Tap a
page to open it, and Back to return. On each page, also try the samples
under "Try it". On the two pages under **Shared screens**, tap every
state: 13 on **Recovery key screens** and 19 on **App lock screens**.
Back returns to the list.

The names in part 1 are the ones GrapheneOS shows. A value may start
with "Default", for example "Default (Blocked)".

This checklist is only for the release. The look at the shared screens
for the Phase 1 gate also uses Catalog 0.3.0, once it is published
([PROMPTS.md](../../development/PROMPTS.md#phase-1-gate-you), steps 1
to 3).

## Part 1: GrapheneOS, on the Pixel 9 Pro

Before you merge the pull request that added this page.

1. [ ] Install Catalog preview from that pull request
   ([Install a preview](../../development/test-a-pull-request.md#install-a-preview)).
   It installs next to the real Catalog. Leave Catalog 0.2.0 as it is on
   every device, for part 5.
2. [ ] Hardened memory allocator on, memory tagging on, secure app
   spawning on.
   1. Long-press the Catalog preview icon and tap **App info**. Scroll
      down to **Exploit protection**.
   2. **Exploit protection compatibility mode** is off. When on, it turns
      some of these protections off.
   3. **Hardened memory allocator** says Enabled.
   4. **Memory tagging** says Enabled.
   5. **Secure app spawning** says Enabled
      ([ADR 0025](../../adr/0025-secure-app-spawning-in-grapheneos-checklist.md)).
3. [ ] Dynamic code loading via memory restricted, and via storage
   restricted. In the same section, **Dynamic code loading via memory**
   and **Dynamic code loading via storage** both say Restricted.
4. [ ] Native code debugging blocked, WebView JIT restricted. In the same
   section, **Native code debugging** says Blocked, and **WebView JIT**
   says Disabled. Catalog has no WebView, so WebView JIT changes nothing
   for it.
5. [ ] Network permission revoked. On **App info**, tap **Permissions**.
   The page **App permissions** opens. Catalog asks for no permissions,
   so Network is not listed, and **Allowed** says "No permissions
   allowed". This is new to check in 0.3.0: `core/security` asks for
   `USE_BIOMETRIC`, and Catalog removes it.
6. [ ] Sensors permission revoked. On **App permissions**, **Sensors** is
   under **Not allowed**. If it is under **Allowed**, tap it and change
   it.
7. [ ] With all of these set, Catalog still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open Catalog preview and use every screen. Nothing crashes, and no
      page or state is empty.
8. [ ] Works in a secondary user profile.
   1. In the Owner user, open Settings, tap **System**, then **Users**.
   2. Tap the secondary user, then **Install available apps**. The page
      **Choose apps to install** opens.
   3. Turn on the switch next to Catalog preview.
   4. Go back and tap **Switch to user**. Open Catalog preview and use
      every screen.
9. [ ] Works in Private Space.
   1. In Settings, tap **Security and privacy**, then **Private space**.
   2. Tap **Install available apps**, and turn on the switch next to
      Catalog preview, as in step 8.
   3. Open Catalog preview in Private Space and use every screen.
10. [ ] Reminders: does not apply. Catalog has no reminders.

## Part 2: Layout, on the Pixel Tablet and the Pixel 6a

Before you merge the pull request.

1. [ ] Install Catalog preview on both devices.
2. [ ] On each, open every screen:
   1. in the light theme and in the dark theme (in Settings, search for
      **Dark theme**),
   2. at the default font size and at the largest (search for **Font
      size**),
   3. upright and turned sideways.
3. [ ] No text is cut off, clipped or on top of other text, and nothing
   sits under the system bars.
4. [ ] On the Pixel Tablet, and on a phone held sideways, Navigation
   shows a rail. On the Pixel Tablet held sideways, List and detail shows
   two panes.
5. [ ] The screenshot switch, on one of the two devices. It is the one
   thing on the new pages that unit tests cannot check.
   1. Open **Recovery key screens** and turn on **Block screenshots, as
      in an app**.
   2. Tap a state and try to take a screenshot. Android refuses it.
   3. Open the recent apps. Catalog preview shows blank.
   4. Go back to the page and turn the switch off. A screenshot works
      again.

## Part 3: Keys, on all three devices

1. [ ] Create a recovery key: does not apply. Catalog holds no keys. Its
   manifest removes the screens of `core/security`, so it cannot create
   or keep a recovery key.
2. [ ] StrongBox on the security screen: does not apply, for the same
   reason. The security screen samples on **Recovery key screens** show
   rows such as **StrongBox: a separate security chip**. They are sample
   data, not the keys of your phone.
3. [ ] Uninstall Catalog preview on all three devices when you are done
   ([Install a newer preview](../../development/test-a-pull-request.md#install-a-newer-preview),
   step 1). Catalog 0.2.0 is not touched.

## Part 4: Release

1. [ ] Merge the pull request. Merge nothing else that changes Catalog,
   a module it is built from (`core/design`, `core/security`,
   `core/crypto`) or the build (`android/build-logic`, `android/gradle`)
   before step 5.
2. [ ] CI is green on the newest commit of `main`
   ([Run a release](../../development/release.md#run-a-release), "Before
   you start").
3. [ ] Run the release workflow with app `catalog` and version `0.3.0`.
   Approve **Sign** ([Run a release](../../development/release.md#run-a-release)).
4. [ ] Check the draft `catalog-v0.3.0`
   ([Check and publish the draft](../../development/release.md#check-and-publish-the-draft),
   steps 1 to 3):
   1. **Build** showed the package `app.shkriuss.catalog` and version
      `0.3.0`.
   2. The files are `catalog-v0.3.0.apk`, `catalog-v0.3.0-mapping.txt`
      and `SHA256SUMS`.
   3. It does not say "Pre-release".
5. [ ] Publish the draft (the same section, steps 4 to 6).
6. [ ] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `catalog-v0.3.0` is there, on the commit from the notes.

## Part 5: After publishing

1. [ ] On a phone with Catalog 0.2.0 from Obtainium, open Obtainium. It
   shows an update for Catalog. Tap Catalog, then **Update**. Android
   installs it as an update, without uninstalling 0.2.0 first. Catalog
   stores no data, so there is no data to keep.
2. [ ] Check Catalog with AppVerifier
   ([Verify with AppVerifier](../../user/verify.md)).
3. [ ] Long-press the Catalog icon and tap **App info**. It shows version
   0.3.0.
4. [ ] Open Catalog. The start screen lists 24 pages in three groups:
   Tokens, Components and Shared screens.
5. [ ] Tell Claude in a session that Catalog 0.3.0 is published, and what
   did not match these steps. Claude then records the release:
   1. the changelog's 0.3.0 heading and date, "Released: 0.3.0" on the
      [apps page](../../user/apps.md), the status in the README, and the
      ticks on this page;
   2. Catalog 0.3.0 in the lists of releases made before the key
      rehearsal, in
      [ADR 0013](../../adr/0013-signing-key-custody-and-rotation.md),
      point 8, and in step 2.7 of
      [PROMPTS.md](../../development/PROMPTS.md#27-restore-and-rotation-rehearsal);
   3. a look inside the published APK, as
      [third-party.md](../../development/third-party.md) asks of the
      first release APK that uses `core/crypto`: the word list and its
      licence file are both in it.
