# Catalog 0.2.0 release checklist

Copied from the [release checklist](../../development/release-checklist.md)
for this release. Tell Claude what you checked, and Claude ticks the
boxes in the pull request that records the release.

## Result

Done. Catalog 0.2.0 was published as `catalog-v0.2.0` on 2026-11-12.

- The owner did all four parts and reported in the session: "everything
  works". For part 1, in the owner's words: "Catalog 0.2.0 works with
  all permissions/exploit protections disabled/blocked". Nothing
  differed from these steps.
- Claude checked on GitHub: the release is built from commit `4bfa6d0`
  on `main`, the merge of
  [pull request 18](https://github.com/shkriuss/shkriuss.app/pull/18).
  The tag `catalog-v0.2.0` points at that commit. The release is not a
  pre-release, and it is immutable. Its notes say the two builds made the
  same APK. The certificate SHA-256 in its notes is the one in
  [fingerprints.md](../../security/fingerprints.md).
- After the update, the owner sent a screenshot of Catalog's **App
  info**: "Version 0.2.0", "App installed from Obtainium". Under
  **Exploit protection**: **Exploit protection compatibility mode** off,
  **Hardened memory allocator** Enabled, **Memory tagging** Enabled,
  **Secure app spawning** Default (Enabled), **Native code debugging**
  Default (Blocked), **WebView JIT** Default (Disabled), **Dynamic code
  loading via memory** and **via storage** Default (Restricted). Part 1,
  steps 2 to 4, now use these names.
- More screenshots of the installed Catalog 0.2.0, the same day. **App
  info**: **Permissions** "No permissions granted", **Mobile data usage**
  "No data used", and the **Force stop** button. **App permissions**:
  **Allowed** "No permissions allowed", **Sensors** under **Not
  allowed**. And the page **Choose apps to install**, with a switch for
  Catalog. Part 1, steps 5 to 9, now use these names.
- The owner sent the way to it for a secondary user: Settings, **System**,
  **Users**, the user, **Install available apps**. That page also has
  **Switch to user**. Part 1, step 8, now follows it.
- On the owner's decision, secure app spawning joined part 1, step 2
  ([ADR 0025](../../adr/0025-secure-app-spawning-in-grapheneos-checklist.md)).
- Still Open: the way from **Private space** to **Choose apps to
  install** (part 1, step 9).

| | |
|---|---|
| App | Catalog, `app.shkriuss.catalog` |
| Preview | Catalog preview, `app.shkriuss.catalog.preview` |
| versionName | `0.2.0` |
| versionCode | `200900`, by the rule in [ADR 0021](../../adr/0021-version-names-and-version-codes.md) |
| Tag | `catalog-v0.2.0` |
| What changed | [Catalog changelog](../../../android/app/catalog/CHANGELOG.md), 0.2.0 |

"Every screen" means the start screen and all 22 pages it lists. Tap a
page to open it, and Back to return. On each page, also try the samples
under "Try it".

The names in part 1 are the ones GrapheneOS shows. A value may start
with "Default", for example "Default (Blocked)". Open: the way from
**Private space** to **Choose apps to install** in step 9, as in the
[release checklist](../../development/release-checklist.md#how-it-is-used).

## Part 1: GrapheneOS, on the Pixel 9 Pro

Before you merge the pull request that added this page.

1. [x] Install Catalog preview from that pull request
   ([Install a preview](../../development/test-a-pull-request.md#install-a-preview)).
   It installs next to the real Catalog. Leave Catalog 0.1.0 as it is on
   every device, for part 4.
2. [x] Hardened memory allocator on, memory tagging on, secure app
   spawning on.
   1. Long-press the Catalog preview icon and tap **App info**. Scroll
      down to **Exploit protection**.
   2. **Exploit protection compatibility mode** is off. When on, it turns
      some of these protections off.
   3. **Hardened memory allocator** says Enabled.
   4. **Memory tagging** says Enabled.
   5. **Secure app spawning** says Enabled. Added after this release by
      [ADR 0025](../../adr/0025-secure-app-spawning-in-grapheneos-checklist.md).
      The owner's screenshot shows it "Default (Enabled)" for Catalog
      0.2.0.
3. [x] Dynamic code loading via memory restricted, and via storage
   restricted. In the same section, **Dynamic code loading via memory**
   and **Dynamic code loading via storage** both say Restricted.
4. [x] Native code debugging blocked, WebView JIT restricted. In the same
   section, **Native code debugging** says Blocked, and **WebView JIT**
   says Disabled. Catalog has no WebView, so WebView JIT changes nothing
   for it.
5. [x] Network permission revoked. On **App info**, tap **Permissions**.
   The page **App permissions** opens. Catalog asks for no permissions,
   so Network is not listed, and **Allowed** says "No permissions
   allowed".
6. [x] Sensors permission revoked. On **App permissions**, **Sensors** is
   under **Not allowed**. If it is under **Allowed**, tap it and change
   it.
7. [x] With all of these set, Catalog still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open Catalog preview and use every screen. Nothing crashes, and no
      page is empty.
8. [x] Works in a secondary user profile.
   1. In the Owner user, open Settings, tap **System**, then **Users**.
   2. Tap the secondary user, then **Install available apps**. The page
      **Choose apps to install** opens.
   3. Turn on the switch next to Catalog preview.
   4. Go back and tap **Switch to user**. Open Catalog preview and use
      every screen.
9. [x] Works in Private Space.
   1. In Settings, search for **Private space** and open it.
   2. Add Catalog preview on **Choose apps to install**, as in step 8.
   3. Open Catalog preview in Private Space and use every screen.
10. [x] Reminders: does not apply. Catalog has no reminders.

## Part 2: Layout, on the Pixel Tablet and the Pixel 6a

Before you merge the pull request.

1. [x] Install Catalog preview on both devices.
2. [x] On each, open every screen:
   1. in the light theme and in the dark theme (in Settings, search for
      **Dark theme**),
   2. at the default font size and at the largest (search for **Font
      size**),
   3. upright and turned sideways.
3. [x] No text is cut off, clipped or on top of other text, and nothing
   sits under the system bars.
4. [x] On the Pixel Tablet, and on a phone held sideways, Navigation
   shows a rail. On the Pixel Tablet held sideways, List and detail shows
   two panes.
5. [x] Uninstall Catalog preview on all three devices when you are done
   ([Install a newer preview](../../development/test-a-pull-request.md#install-a-newer-preview),
   step 1). Catalog 0.1.0 is not touched.

## Part 3: Release

1. [x] Merge the pull request. Merge nothing else that changes Catalog or
   `core/design` before step 5.
2. [x] CI is green on the newest commit of `main`
   ([Run a release](../../development/release.md#run-a-release), "Before
   you start").
3. [x] Run the release workflow with app `catalog` and version `0.2.0`.
   Approve **Sign** ([Run a release](../../development/release.md#run-a-release)).
4. [x] Check the draft `catalog-v0.2.0`
   ([Check and publish the draft](../../development/release.md#check-and-publish-the-draft),
   steps 1 to 3):
   1. **Build** showed the package `app.shkriuss.catalog` and version
      `0.2.0`.
   2. The files are `catalog-v0.2.0.apk`, `catalog-v0.2.0-mapping.txt`
      and `SHA256SUMS`.
   3. It does not say "Pre-release".
5. [x] Publish the draft (the same section, steps 4 to 6).
6. [x] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `catalog-v0.2.0` is there, on the commit from the notes.

## Part 4: After publishing

This is the first update of any app. It also checks the
[Updates](../../user/install.md#updates) steps of the install guide.

1. [x] On the phone with Catalog 0.1.0 from Obtainium, open Obtainium. It
   shows an update for Catalog. Tap Catalog, then **Update**. Android
   installs it as an update, without uninstalling 0.1.0 first.
2. [x] Check Catalog with AppVerifier
   ([Verify with AppVerifier](../../user/verify.md)).
3. [x] Long-press the Catalog icon and tap **App info**. It shows version
   0.2.0.
4. [x] Open Catalog. The start screen lists 22 pages in two groups,
   Tokens and Components.
5. [x] Tell Claude in a session that Catalog 0.2.0 is published, and what
   did not match these steps. Claude then records the release: the
   changelog's 0.2.0 heading and date, "Released: 0.2.0" on the
   [apps page](../../user/apps.md), the status in the README, the note in
   the install guide's Updates section, and the ticks on this page.
