# Release checklist

The checklist for every release of every app. It holds the GrapheneOS
checklist that every release passes
([ADR 0002](../adr/0002-grapheneos-first-minimum-android-13.md), point 4,
and [ADR 0025](../adr/0025-secure-app-spawning-in-grapheneos-checklist.md)),
and the steps of [release.md](release.md) in the order you do them.

## How it is used

1. Claude copies this page for each release, in the pull request that sets
   the version (prompt R6 in [PROMPTS.md](PROMPTS.md)). The copy is
   `docs/apps/<app>/release-checklist-<version>.md`. Claude fills in the
   app and the version, and writes "Does not apply" and the reason next to
   an item that does not fit the app.
2. You work through the copy on your phones. Parts 1 to 3 use the
   preview of that pull request, before you merge it. Parts 4 and 5 come
   after the merge.
3. Tell Claude in a session what you checked and anything that did not
   match. Claude ticks the boxes in the copy, and fixes this page, in the
   pull request that records the release. No issue is needed.

One shared checklist with a copy per version, results told to Claude
in a session, and the checks on the preview are owner decisions on
[pull request 18](https://github.com/shkriuss/shkriuss.app/pull/18).

Why the preview: it is the release build with another app ID
([build.md](build.md#build-types)). It installs next to the real app, so
your phones keep the old version for the update in part 5. Merge nothing
else that changes the app between part 1 and the release. Then the
release is built from the code you checked.

The names in part 1 are the ones GrapheneOS shows. They come from
screenshots the owner sent on 2026-11-12. A value may start with
"Default", for example "Default (Blocked)". That counts as the same
value.

## Part 1: GrapheneOS, on the Pixel 9 Pro

1. [ ] Install the pull request's preview
   ([Install a preview](test-a-pull-request.md#install-a-preview)).
2. [ ] Hardened memory allocator on, memory tagging on, secure app
   spawning on.
   1. Long-press the preview's icon and tap **App info**. Scroll down to
      **Exploit protection**.
   2. **Exploit protection compatibility mode** is off. When on, it turns
      some of these protections off.
   3. **Hardened memory allocator** says Enabled.
   4. **Memory tagging** says Enabled.
   5. **Secure app spawning** says Enabled
      ([ADR 0025](../adr/0025-secure-app-spawning-in-grapheneos-checklist.md)).
3. [ ] Dynamic code loading via memory restricted, and via storage
   restricted. In the same section, **Dynamic code loading via memory**
   and **Dynamic code loading via storage** both say Restricted.
4. [ ] Native code debugging blocked, WebView JIT restricted. In the same
   section, **Native code debugging** says Blocked, and **WebView JIT**
   says Disabled.
5. [ ] Network permission revoked. On **App info**, tap **Permissions**.
   The page **App permissions** opens. Network must not be under
   **Allowed**. A data app asks for no network access, so Network is not
   listed at all.
6. [ ] Sensors permission revoked. On **App permissions**, **Sensors** is
   under **Not allowed**. If it is under **Allowed**, tap it and change
   it.
7. [ ] With all of these set, the app still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open the app and use every screen. Nothing crashes, and nothing is
      missing.
8. [ ] Works in a secondary user profile.
   1. In the Owner user, open Settings, tap **System**, then **Users**.
   2. Tap the secondary user, then **Install available apps**. The page
      **Choose apps to install** opens.
   3. Turn on the switch next to the preview.
   4. Go back and tap **Switch to user**. Open the app and use every
      screen.
9. [ ] Works in Private Space.
   1. In Settings, tap **Security and privacy**, then **Private space**.
   2. Tap **Install available apps**, and turn on the switch next to the
      preview, as in step 8.
   3. Open the app in Private Space and use every screen.
10. [ ] Reminders fire on time with the screen off, after a reboot, and
    after the first unlock. Only for an app with reminders. Do every part
    of
    [Steps for the three devices: reminders](emulator-tests.md#steps-for-the-three-devices-reminders)
    with the preview, in the app's own words:
    1. Part 1: the question for notifications, a reminder on time with
       the screen off, and its buttons on the lock screen.
    2. Part 2: **Later**, and a tap on the reminder.
    3. Part 3: a reminder while notifications are not allowed, and while
       its channel is off.
    4. Part 4: a restart, before and after the first unlock.
    5. Part 5: an app update. Only from the app's second release. Before
       that, write "Does not apply" and why.
    6. Part 6: a new time zone.
    7. Part 7: a secondary user profile.
    8. Part 8: Private Space.
    9. Part 9: **Force stop**.

    The copy for the version writes every step out in the app's words.
11. [ ] A TalkBack pass over every screen, sheet and dialog, for every
    app. Turn on TalkBack (in Settings, search for **TalkBack**). Move
    through each one with a swipe. Check:
    1. TalkBack reads every button, field, switch and row with a name,
       and reads nothing that is only decoration.
    2. Amounts, times and units are read in words, as the app's
       specification says.
    3. After a sheet or a dialog closes, the focus goes back to what
       opened it.
    4. For an app with buttons on its notifications: how TalkBack reads
       each button.

    The copy for the version lists every screen, sheet and dialog by
    name. Then turn TalkBack off.

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
4. [ ] Reminders, on both devices. Only for an app with reminders. Parts
   1 to 4 of
   [Steps for the three devices: reminders](emulator-tests.md#steps-for-the-three-devices-reminders),
   as in part 1, step 10.

## Part 3: Keys, on all three devices

Steps 1 and 2 are only for an app that holds keys, step 3 for an app
with the app lock, and step 4 for an app that makes backups. Catalog has
none of these: write "Does not apply" next to them. Use test words in
every step, never your real recovery words. An emulator has no
StrongBox, so only these devices can check it
([crypto-design.md](../security/crypto-design.md#strongbox-and-other-hardware),
point 8).

1. [ ] On the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a: open the
   preview, create a recovery key for testing (never your real words),
   and keep it on the phone with the system prompt.
2. [ ] On each of the three, open the app's security screen. Under
   **Keys on this phone**, every key says **StrongBox: a separate
   security chip**.
3. [ ] The app lock, on all three devices. Only for an app with the app
   lock. Every step of
   [Steps for the three devices: the app lock](emulator-tests.md#steps-for-the-three-devices-the-app-lock):
   turning it on, when it locks, the recent apps, the pickers and
   sharing, the app lock screen and screenshots, and notifications. For
   an app with reminders, check that a reminder shows its hidden form
   and has no buttons while the app lock is on.
4. [ ] Backup and restore, on all three devices. Only for an app that
   makes backups. Every step of
   [Steps for the three devices: backup and restore](emulator-tests.md#steps-for-the-three-devices-backup-and-restore).
   A backup made on one device is restored on a second device, after
   the same test words are entered there. Check that everything the
   backup holds is there.
5. [ ] Uninstall the previews on all three devices when you are done
   ([Install a newer preview](test-a-pull-request.md#install-a-newer-preview),
   step 1).

## Part 4: Release

1. [ ] Merge the pull request.
2. [ ] CI is green on the newest commit of `main`
   ([Run a release](release.md#run-a-release), "Before you start").
3. [ ] No known vulnerability is open
   ([Dependency graph](ci.md#dependency-graph)).
   1. Open
      `github.com/shkriuss/shkriuss.app/actions/workflows/dependency-graph.yml`.
      The newest run on `main` is green. If the merge changed `android/`,
      it is the run for the merge.
   2. Open `github.com/shkriuss/shkriuss.app/security/dependabot`. No
      alert is open.
   3. If an alert is open, stop. Tell Claude in a session which library
      it names. Claude checks whether it ships in the app.
4. [ ] Run the release workflow with the app and the version. Approve
   **Sign** ([Run a release](release.md#run-a-release)).
5. [ ] Check the draft
   ([Check and publish the draft](release.md#check-and-publish-the-draft),
   steps 1 to 3).
6. [ ] Publish the draft (the same section, steps 4 to 6).
7. [ ] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `<app>-v<version>` is there, on the commit from the notes.

## Part 5: After publishing

1. [ ] On a phone with the old version from Obtainium, open Obtainium. It
   shows the update. Tap the app, then **Update**. It installs as an
   update, without uninstalling, and the app's data is kept. For an app's
   first release, install it instead
   ([Install with Obtainium](../user/install.md)). If the version is a
   pre-release (it has a hyphen, such as `1.0.0-rc.1`), first turn on
   **Include prereleases** in the app's settings in Obtainium
   ([Pre-releases](../user/install.md#pre-releases)).
2. [ ] Check the app with AppVerifier
   ([Verify with AppVerifier](../user/verify.md)).
3. [ ] Long-press the app's icon and tap **App info**. It shows the new
   version.
4. [ ] Tell Claude in a session that the release is published, and what
   did not match these steps.
