# Catalog 0.2.0 release checklist

Copied from the [release checklist](../../development/release-checklist.md)
for this release. Tell Claude what you checked, and Claude ticks the
boxes in the pull request that records the release.

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

Open: the exact names of the GrapheneOS settings in part 1, as in the
[release checklist](../../development/release-checklist.md#how-it-is-used).
Write down the names your phone shows.

## Part 1: GrapheneOS, on the Pixel 9 Pro

Before you merge the pull request that added this page.

1. [ ] Install Catalog preview from that pull request
   ([Install a preview](../../development/test-a-pull-request.md#install-a-preview)).
   It installs next to the real Catalog. Leave Catalog 0.1.0 as it is on
   every device, for part 4.
2. [ ] Hardened memory allocator on, memory tagging on.
   1. Long-press the Catalog preview icon and tap **App info**.
   2. Find the exploit protection settings. The hardened memory allocator
      must be on. If there is an exploit protection compatibility mode, it
      must be off, because it turns the hardened memory allocator off.
   3. Memory tagging must be on.
3. [ ] Dynamic code loading via memory restricted, and via storage
   restricted. Both are on the same **App info** page.
4. [ ] Native code debugging blocked. WebView JIT restricted. Catalog has
   no WebView, so restricting WebView JIT changes nothing for it.
5. [ ] Network permission revoked. On **App info**, tap **Permissions**.
   Catalog asks for no permissions, so Network must not be listed.
6. [ ] Sensors permission revoked. In **Permissions**, tap **Sensors**,
   then **Don't allow**. If Sensors is not listed, write that down.
7. [ ] With all of these set, Catalog still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open Catalog preview and use every screen. Nothing crashes, and no
      page is empty.
8. [ ] Works in a secondary user profile.
   1. In the Owner user, open Settings and search for **Users**.
   2. Tap the secondary user and use GrapheneOS's **Install available
      apps** to add Catalog preview to it.
   3. Switch to that user, open Catalog preview and use every screen.
9. [ ] Works in Private Space.
   1. In Settings, search for **Private space** and open it.
   2. Add Catalog preview with **Install available apps**, as in step 8.
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
5. [ ] Uninstall Catalog preview on all three devices when you are done
   ([Install a newer preview](../../development/test-a-pull-request.md#install-a-newer-preview),
   step 1). Catalog 0.1.0 is not touched.

## Part 3: Release

1. [ ] Merge the pull request. Merge nothing else that changes Catalog or
   `core/design` before step 5.
2. [ ] CI is green on the newest commit of `main`
   ([Run a release](../../development/release.md#run-a-release), "Before
   you start").
3. [ ] Run the release workflow with app `catalog` and version `0.2.0`.
   Approve **Sign** ([Run a release](../../development/release.md#run-a-release)).
4. [ ] Check the draft `catalog-v0.2.0`
   ([Check and publish the draft](../../development/release.md#check-and-publish-the-draft),
   steps 1 to 3):
   1. **Build** showed the package `app.shkriuss.catalog` and version
      `0.2.0`.
   2. The files are `catalog-v0.2.0.apk`, `catalog-v0.2.0-mapping.txt`
      and `SHA256SUMS`.
   3. It does not say "Pre-release".
5. [ ] Publish the draft (the same section, steps 4 to 6).
6. [ ] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `catalog-v0.2.0` is there, on the commit from the notes.

## Part 4: After publishing

This is the first update of any app. It also checks the
[Updates](../../user/install.md#updates) steps of the install guide.

1. [ ] On the phone with Catalog 0.1.0 from Obtainium, open Obtainium. It
   shows an update for Catalog. Tap Catalog, then **Update**. Android
   installs it as an update, without uninstalling 0.1.0 first.
2. [ ] Check Catalog with AppVerifier
   ([Verify with AppVerifier](../../user/verify.md)).
3. [ ] Long-press the Catalog icon and tap **App info**. It shows version
   0.2.0.
4. [ ] Open Catalog. The start screen lists 22 pages in two groups,
   Tokens and Components.
5. [ ] Tell Claude in a session that Catalog 0.2.0 is published, and what
   did not match these steps. Claude then records the release: the
   changelog's 0.2.0 heading and date, "Released: 0.2.0" on the
   [apps page](../../user/apps.md), the status in the README, the note in
   the install guide's Updates section, and the ticks on this page.
