# Release checklist

The checklist for every release of every app. It holds the GrapheneOS
checklist that every release passes
([ADR 0002](../adr/0002-grapheneos-first-minimum-android-13.md), point 4),
and the steps of [release.md](release.md) in the order you do them.

## How it is used

1. Claude copies this page for each release, in the pull request that sets
   the version (prompt R6 in [PROMPTS.md](PROMPTS.md)). The copy is
   `docs/apps/<app>/release-checklist-<version>.md`. Claude fills in the
   app and the version, and writes "Does not apply" and the reason next to
   an item that does not fit the app.
2. You work through the copy on your phones. Parts 1 and 2 use the
   preview of that pull request, before you merge it. Parts 3 and 4 come
   after the merge.
3. Tell Claude in a session what you checked and anything that did not
   match. Claude ticks the boxes in the copy, and fixes this page, in the
   pull request that records the release. No issue is needed.

One shared checklist with a copy per version, results told to Claude
in a session, and the checks on the preview are owner decisions on
[pull request 18](https://github.com/shkriuss/shkriuss.app/pull/18).

Why the preview: it is the release build with another app ID
([build.md](build.md#build-types)). It installs next to the real app, so
your phones keep the old version for the update in part 4. Merge nothing
else that changes the app between part 1 and the release. Then the
release is built from the code you checked.

The names in part 1, steps 2 to 4, are the ones GrapheneOS shows under
**Exploit protection** on **App info**. They come from a screenshot the
owner sent on 2026-11-12. A value may start with "Default", for example
"Default (Blocked)". That counts as the same value.

Open: the names in part 1, steps 6, 8 and 9 (**Sensors**, **Install
available apps** and **Private space**), are not checked on a phone yet.
Write down the names your phone shows, so Claude can fix this page.

## Part 1: GrapheneOS, on the Pixel 9 Pro

1. [ ] Install the pull request's preview
   ([Install a preview](test-a-pull-request.md#install-a-preview)).
2. [ ] Hardened memory allocator on, memory tagging on.
   1. Long-press the preview's icon and tap **App info**. Scroll down to
      **Exploit protection**.
   2. **Exploit protection compatibility mode** is off. When on, it turns
      some of these protections off.
   3. **Hardened memory allocator** says Enabled.
   4. **Memory tagging** says Enabled.
3. [ ] Dynamic code loading via memory restricted, and via storage
   restricted. In the same section, **Dynamic code loading via memory**
   and **Dynamic code loading via storage** both say Restricted.
4. [ ] Native code debugging blocked, WebView JIT restricted. In the same
   section, **Native code debugging** says Blocked, and **WebView JIT**
   says Disabled.
5. [ ] Network permission revoked. On **App info**, tap **Permissions**.
   Network must not be allowed. A data app asks for no network access, so
   Network may not be listed at all.
6. [ ] Sensors permission revoked. In **Permissions**, tap **Sensors**,
   then **Don't allow**.
7. [ ] With all of these set, the app still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open the app and use every screen. Nothing crashes, and nothing is
      missing.
8. [ ] Works in a secondary user profile.
   1. In the Owner user, open Settings and search for **Users**.
   2. Tap the secondary user and use GrapheneOS's **Install available
      apps** to add the preview to it.
   3. Switch to that user, open the app and use every screen.
9. [ ] Works in Private Space.
   1. In Settings, search for **Private space** and open it.
   2. Add the preview with **Install available apps**, as in step 8.
   3. Open the app in Private Space and use every screen.
10. [ ] Reminders fire on time with the screen off, after a reboot, and
    after the first unlock. Only for an app with reminders. Open: the
    exact steps come with the first app that has reminders.

## Part 2: Layout, on the Pixel Tablet and the Pixel 6a

1. [ ] Install the preview on both devices.
2. [ ] On each, open every screen:
   1. in the light theme and in the dark theme (in Settings, search for
      **Dark theme**),
   2. at the default font size and at the largest (search for **Font
      size**),
   3. upright and turned sideways.
3. [ ] No text is cut off, clipped or on top of other text, and nothing
   sits under the system bars.
4. [ ] Uninstall the previews on all three devices when you are done
   ([Install a newer preview](test-a-pull-request.md#install-a-newer-preview),
   step 1).

## Part 3: Release

1. [ ] Merge the pull request.
2. [ ] CI is green on the newest commit of `main`
   ([Run a release](release.md#run-a-release), "Before you start").
3. [ ] Run the release workflow with the app and the version. Approve
   **Sign** ([Run a release](release.md#run-a-release)).
4. [ ] Check the draft
   ([Check and publish the draft](release.md#check-and-publish-the-draft),
   steps 1 to 3).
5. [ ] Publish the draft (the same section, steps 4 to 6).
6. [ ] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `<app>-v<version>` is there, on the commit from the notes.

## Part 4: After publishing

1. [ ] On a phone with the old version from Obtainium, open Obtainium. It
   shows the update. Tap the app, then **Update**. It installs as an
   update, without uninstalling, and the app's data is kept. For an app's
   first release, install it instead
   ([Install with Obtainium](../user/install.md)).
2. [ ] Check the app with AppVerifier
   ([Verify with AppVerifier](../user/verify.md)).
3. [ ] Long-press the app's icon and tap **App info**. It shows the new
   version.
4. [ ] Tell Claude in a session that the release is published, and what
   did not match these steps.
