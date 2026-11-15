# Water 1.0.0 release checklist

Copied from the [release checklist](../../development/release-checklist.md)
for this release, in step 2.6. Every step on a phone is written out here,
with Water's words. Tell Claude what you checked, and Claude ticks the
boxes in the pull request that records the release.

## Result

Not done yet.

| | |
|---|---|
| App | Water, `app.shkriuss.water` |
| Preview | Water preview, `app.shkriuss.water.preview` |
| versionName | `1.0.0` |
| versionCode | `10000900`, by the rule in [ADR 0021](../../adr/0021-version-names-and-version-codes.md) |
| Tag | `water-v1.0.0` |
| Pre-release | No. The version has no hyphen. |
| What changed | [Water changelog](../../../android/app/water/CHANGELOG.md), 1.0.0 |
| User guide | [water.md](../../user/water.md), with its known problems |

The names in part 1 are the ones GrapheneOS shows. A value may start
with "Default", for example "Default (Blocked)". That counts as the same
value.

## Before you start

1. Parts 1 to 3 use Water preview from the pull request that added this
   page, before you merge it. Parts 4 and 5 come after the merge.
2. **Test words only.** Whenever Water preview asks for a recovery key,
   let it make a new one, and write those 24 test words on paper. Never
   type your real recovery words into a preview build. A preview makes
   the same keys as the real app from the same words.
3. The Phase 2 gate asks you to use Water daily for two weeks before the
   release ([PROMPTS.md](../../development/PROMPTS.md#phase-2-gate-you)).
   Use Water preview for that, between part 3 and part 4.
4. Merge nothing else that changes Water between part 1 and the release.
   Then the release is built from the code you checked.
5. Do the reminder steps between 00:30 and 23:00.
6. Write down everything that does not match a step, with the exact
   words the phone showed.

Two things that many steps use:

**Start fresh.**

1. Uninstall Water preview.
2. Install the same preview APK again.

Water preview then has no drink, no reminder of today, no recovery key,
and has never asked for notifications.

**Set the next reminder for about two minutes from now.**

1. Open Water preview and tap **Settings**.
2. Tap **Every**, choose **30 minutes** and tap **Save**.
3. If it is later than 21:00, tap **Until**, type 23 and 59, and tap
   **OK**.
4. Tap **From**. Type the time 28 minutes before now: at 14:05, type 13
   and 37. Tap **OK**.
5. If **Remind me to drink** is off, turn it on.
6. Check: under **Until**, Water says "Next reminder at", two minutes
   from now (14:07 in the example).

This works only while today has no drink and no reminder later than
**From**. So each part that uses it starts fresh.

### The screens, sheets and dialogs of Water

Parts 1 and 2 ask you to open each of these. How to reach each one is
next to it.

Screens:

1. **Today**, with no drink, with drinks, and with "Goal reached" (tap
   **+500 ml** four times).
2. **History**, and one day opened from it.
3. **Settings**, scrolled to its end.
4. **Licences** (Settings, under About), and one part opened from it.

Sheets and messages:

5. **Add a drink**: on Today, tap **Other amount**.
6. **Edit drink**: on Today, tap a drink.
7. The time picker of a drink: in the sheet, tap the time.
8. The messages "Added 250 ml" and "Drink deleted", each with **Undo**.

Dialogs of Settings:

9. **Daily goal**, also with a value that is too large, such as 20000.
10. **Unit**.
11. **Quick amounts**, also with a value that is too large, such as 5000.
12. **Every**.
13. **From** and **Until**, also with a time that is refused: set
    **Until** to 15 minutes after **From**.
14. **Allow notifications**: after a start fresh, turn on **Remind me
    to drink**.

Backup and restore (Settings, under Backup):

15. **Set up your recovery key first**: tap **Make a backup**, or **App
    lock**, while Water has no recovery key.
16. **Enter your recovery key first**: tap **Restore a backup** while
    Water has no recovery key.
17. **Writing the backup** and **Checking the backup**.
18. **Backup written**.
19. **Restore this backup?**
20. **Restoring the backup** and **Backup restored**.
21. **Not a backup**: pick a photo for a restore.
22. **Finish your recovery key**: it shows only after a setup that
    stopped half-way. If you see it in any step, check it too.

The screens of the recovery key and the app lock (Settings, under
Security):

23. The security screen: tap **Recovery key**.
24. **Create your recovery key**, with the 24 words and the four words to
    confirm.
25. **Enter your recovery key**.
26. Showing the words again, from the security screen.
27. The app lock screen: tap **App lock**. Also its choice **Lock the
    app**.
28. Turning the app lock on: the warning and the four words.
29. The lock screen of Water, while the app lock is on.

The reminder:

30. The reminder in the notification shade, with **Drank 150 ml** and
    **Later**, and its hidden form while the app lock is on.

## Part 1: GrapheneOS, on the Pixel 9 Pro

1. [ ] Install Water preview from the pull request that added this page.
   1. Open the pull request on GitHub, and tap the **Conversation** tab.
   2. Find the comment **Preview of this pull request**. Tap the link of
      Water's preview, and download the APK.
   3. Open the downloaded file and tap **Install**. If Android asks
      whether your browser may install apps, allow it and go back.
   4. Water preview installs next to the real Water, which is not
      released yet.
2. [ ] Hardened memory allocator on, memory tagging on, secure app
   spawning on.
   1. Long-press the Water preview icon and tap **App info**. Scroll
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
   says Disabled. Water has no WebView, so WebView JIT changes nothing
   for it.
5. [ ] Network permission revoked. On **App info**, tap **Permissions**.
   The page **App permissions** opens. Network is not listed at all:
   Water asks for no network access. **Notifications** is listed, under
   **Allowed** or **Not allowed**, depending on your answer to Android's
   question.
6. [ ] Sensors permission revoked. On **App permissions**, **Sensors** is
   under **Not allowed**. If it is under **Allowed**, tap it and change
   it.
7. [ ] With all of these set, Water still works.
   1. On **App info**, tap **Force stop**, so the settings apply.
   2. Open Water preview. Open each item of
      [the list above](#the-screens-sheets-and-dialogs-of-water), from 1
      to 30. In each dialog, tap **Cancel** unless the item says
      otherwise. Nothing crashes, and nothing is empty or missing.
8. [ ] Works in a secondary user profile.
   1. In the Owner user, open Settings, tap **System**, then **Users**.
   2. Tap the secondary user, then **Install available apps**. The page
      **Choose apps to install** opens.
   3. Turn on the switch next to Water preview.
   4. Go back and tap **Switch to user**. Open Water preview. Log a
      drink with **+250 ml**. Open **History**, the day, and
      **Settings**.
9. [ ] Works in Private Space.
   1. In Settings, tap **Security and privacy**, then **Private space**.
   2. Tap **Install available apps**, and turn on the switch next to
      Water preview, as in step 8.
   3. Open Water preview in Private Space. Log a drink with **+250 ml**.
      Open **History**, the day, and **Settings**.
10. [ ] Reminders fire on time with the screen off, after a restart, and
    after the first unlock. Water skips a reminder whose time passed more
    than a minute ago, for example while the phone was off. It never
    shows one late. Do the nine parts below.

    Part 1, the question, on time with the screen off, and **Drank**:

    1. Start fresh. Set the next reminder for about two minutes from
       now. When you turn on **Remind me to drink**, a dialog "Allow
       notifications" explains first.
    2. Tap **Not now**. Check: the switch stays on, and the line says
       "Reminders are on, but Water may not show notifications yet.",
       with **Allow**.
    3. Tap **Allow**, then **Continue**. Android asks. Tap **Allow** in
       Android's question. Check: the line says "Next reminder at" and
       the time.
    4. Turn the screen off, unplug the phone and leave it alone.
    5. Check: the reminder comes in the minute it was set for: "Time for
       some water", "0 of 2,000 ml today", and the buttons **Drank 150
       ml** and **Later**.
    6. On the lock screen, tap **Drank 150 ml**. Check: Android asks you
       to unlock the phone first, and nothing happens before. Unlock.
    7. Check: the reminder is gone. Open Water preview: Today shows
       "150 ml" at the top of the drinks, with the time of the tap. The
       line says "Next reminder at", 30 minutes after the tap.
    8. Tap the drink, tap **Delete**, then **Undo** in the message.
       Check: the drink is back.

    Part 2, **Later**:

    9. Start fresh. Set the next reminder for about two minutes from
       now, and allow notifications: **Continue**, then **Allow**.
    10. When the reminder comes, tap **Later**, and unlock. Check: the
        reminder is gone. Open Water preview: the line says "Next
        reminder at", 15 minutes after the tap.
    11. Wait 15 minutes. Check: the reminder comes again, with the
        numbers of that moment.
    12. Open **Settings** in Water preview, then leave Water. Tap the
        notification itself, not a button. Check: Water preview opens
        on **Today**.

    Part 3, a reminder while notifications are not allowed:

    13. Start fresh. Set the next reminder for about two minutes from
        now. In the dialog, tap **Continue**. In Android's question, tap
        **Don't allow**.
    14. Check: the line says "Notifications are off for Water. Reminders
        are silent.", with **Open settings**.
    15. Wait until two minutes after the time. Check: no reminder showed
        and nothing made a sound.
    16. Tap **Open settings**. Check: Android's notification page of
        Water preview opens. Allow its notifications there, and go back.
    17. Check: the line says "Next reminder at", 30 minutes after the
        silent one. The silent reminder counted as shown.
    18. Tap **Open settings** again. On Android's page, tap **Drink
        reminders** and turn it off. Go back. Check: the line says
        "Drink reminders are turned off in Android's settings. Reminders
        are silent.", and **Open settings** opens the page of **Drink
        reminders**. Turn it on again.

    Part 4, a restart of the phone, before and after the first unlock:

    19. Start fresh. Allow notifications. Set the next reminder as
        above, but type in **From** the time 26 minutes before now, so
        that it comes in about four minutes.
    20. Restart the phone at once. Unlock it before the time. Do not
        open Water preview.
    21. Check: the reminder comes at its minute. Do not answer it.
    22. About 25 minutes later, restart the phone again. Do not unlock
        it until two minutes after the next time, 30 minutes after the
        reminder of step 21.
    23. Check: nothing showed on the lock screen and nothing made a
        sound.
    24. Unlock the phone. Check: no reminder appears. Open Water
        preview: the line says "Next reminder at", one hour after the
        reminder of step 21.

    Part 5, an app update:

    25. Does not apply. 1.0.0 is Water's first release, and two preview
        builds have different keys, so one cannot update the other. It
        is checked with the first update of Water.

    Part 6, a new time zone:

    26. Start fresh. Allow notifications. Set the next reminder for
        about two minutes from now, and let it come. Do not answer it.
    27. In Android's Settings, search for **Time zone**. Turn off the
        automatic time zone and choose a zone that is one hour ahead.
    28. Open Water preview. Check: the line says "Next reminder at" a
        time in the new zone's clock: 30 minutes after the reminder of
        step 26, one hour later on the clock. It comes at that time.
    29. Turn the automatic time zone on again.

    Part 7, a secondary user profile:

    30. In the secondary user of step 8, start fresh: uninstall Water
        preview there and install it again with **Install available
        apps**. Set the next reminder for about two minutes from now and
        allow notifications.
    31. Switch back to the Owner without ending the session.
    32. Check: with **Send notifications to current user** off, nothing
        shows in the Owner. After a switch to the secondary user, the
        reminder is there, with its time.
    33. Turn **Send notifications to current user** on in the secondary
        user. In Water preview there, tap **Later**, and switch to the
        Owner. Check: 15 minutes later the reminder shows in the Owner.
    34. In the secondary user, note the time on Water's line, then end
        its session. Switch to it after that time has passed and unlock
        it. Check: no reminder appears. Water's line names the next one.

    Part 8, Private Space:

    35. In the Private Space of step 9, set the next reminder for about
        two minutes from now and allow notifications. If Water preview
        there already has drinks of today, uninstall it and install it
        again first, as in step 9.
    36. Lock the Private Space. Wait until two minutes after the time.
    37. Check: nothing showed.
    38. Unlock the Private Space. Do not open Water preview. Check: no
        reminder appears. Open Water preview: the line names the next
        one.

    Part 9, "Force stop":

    39. Start fresh. Allow notifications. Set the next reminder for
        about two minutes from now.
    40. On **App info** of Water preview, tap **Force stop**. Wait until
        two minutes after the time.
    41. Check: the reminder did not come. Open Water preview. Check: no
        reminder appears, and the line names the next one.
11. [ ] A TalkBack pass over every screen, sheet and dialog.
    1. Turn on TalkBack: in Settings, search for **TalkBack**.
    2. Open each item of
       [the list above](#the-screens-sheets-and-dialogs-of-water), from 1
       to 30. Move through each with a swipe to the right. Check:
       1. TalkBack reads every button, field, switch and row with a
          name. It reads nothing that is only decoration, such as the
          check next to "Goal reached".
       2. Amounts are read with the unit in words, such as "250
          millilitres". The summary of Today is one item, such as "1,250
          of 2,000 millilitres today, 62 percent". A drink is one item,
          such as "14:05, 250 millilitres". A day of History is one item.
       3. Section headers are headings: with the reading control set to
          **Headings**, a swipe down jumps from one to the next.
       4. "Added 250 ml" and "Drink deleted" are read when they appear,
          with **Undo**.
       5. A value that is too large is read under its field (items 9,
          11 and 13).
    3. Where the focus goes after a sheet or a dialog closes. For each of
       items 5, 6, 7 and 9 to 14: open it, then close it with **Save**,
       **Cancel**, **OK** or Back. Check: TalkBack's focus goes back to
       the button or row that opened it. Write down each one where it
       goes somewhere else.
    4. How "ml" and "fl oz" are read on the buttons of a reminder
       ([spec.md](spec.md#open), item 5):
       1. Set the next reminder for about two minutes from now, after a
          start fresh, and allow notifications.
       2. When the reminder comes, open the notification shade, and move
          to its buttons. Write down exactly what TalkBack reads for
          **Drank 150 ml** and for **Later**.
       3. Start fresh. In Water preview, tap **Settings**, **Unit**,
          choose **US fluid ounces (fl oz)** and tap **Save**. The quick
          amounts become 5, 8 and 16 fl oz.
       4. Set the next reminder for about two minutes from now, and
          allow notifications. When the reminder comes, write down
          exactly what TalkBack reads for **Drank 5 fl oz**.
    5. Turn TalkBack off.

## Part 2: Layout, on the Pixel Tablet and the Pixel 6a

1. [ ] Install Water preview on both devices, as in part 1, step 1.
2. [ ] On each, open each item of
   [the list above](#the-screens-sheets-and-dialogs-of-water), from 1 to
   29, four times:
   1. in the light theme, at the default font size, upright;
   2. in the light theme, at the largest font size, turned sideways;
   3. in the dark theme, at the default font size, turned sideways;
   4. in the dark theme, at the largest font size, upright.

   In Settings, search for **Dark theme** and for **Font size**. On the
   Pixel Tablet turned sideways, Today shows two panes, and History and
   Licences open a day or a part beside the list.
3. [ ] No text is cut off, clipped or on top of other text, and nothing
   sits under the system bars.
4. [ ] Reminders, on both devices: parts 1 to 4 of part 1, step 10,
   steps 1 to 24, on each device.

## Part 3: Keys, on all three devices

Use test words in every step, never your real recovery words.

1. [ ] On the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a: start
   fresh. Open Water preview, tap **Settings**, then **Recovery key**.
   Create a recovery key for testing, write the 24 test words on paper,
   and confirm the four words it asks for. When the system prompt asks
   to keep the recovery key on this phone, answer it.
2. [ ] On each of the three, on the same security screen, under **Keys
   on this phone**, every key says **StrongBox: a separate security
   chip**.
3. [ ] The app lock, on each of the three devices.

   Before you start: Water preview has the recovery key of step 1, kept
   on the phone, and no drink today. The phone has a PIN and a
   fingerprint. Log no drink until step 14.

   Turning it on:

   1. In **Settings**, tap **Recovery key**. Check: the security screen
      says it keeps the recovery key. Go back and tap **App lock**. Turn
      the app lock on. Check: the plain warning, one prompt, four words,
      then a second prompt. Type one wrong word first. Check: Water
      says that a word does not match and shows no words. Then, while
      the four fields show, switch to another app and back. Check: the
      prompt asks again, and then four words show. Turn the phone while
      the four fields show. Check: no new prompt, and the words you
      typed stay.

   When it locks:

   2. Under **Lock the app**, choose **When it leaves the screen**.
      Switch to another app, then back. Check: the lock screen comes
      first. No content of Water shows for a moment, neither in the
      recent apps nor on the way back.
   3. Open the recent apps. Check: Water preview shows blank there.
   4. Choose **5 minutes**. With Water on the screen, turn the screen
      off, wait 10 seconds, turn it on and unlock the phone. Check: the
      lock screen, and no content first.
   5. Still **5 minutes**. Switch to another app. Turn the screen off
      for 10 seconds, turn it on, unlock the phone, and go back to
      Water. Check: Water shows either its content or the lock screen,
      but never its content first and the lock screen after. The picture
      in the recent apps is blank. Write down which one it showed:
      Android 14 and later may hold the screen-off broadcast back, so the
      content is allowed here, as the user guide says.
   6. Still **5 minutes**. Switch to another app for more than 5
      minutes, then go back. Check: the lock screen comes first.
   7. With **When it leaves the screen**, open the prompt and answer it
      with the PIN instead of the fingerprint. Check: Water opens and
      does not lock again right away.

   Pickers and sharing. Water has no files. Its pickers are those of
   **Make a backup** and **Restore a backup**:

   8. Keep **When it leaves the screen**. Tap **Make a backup**, so that
      Android's file picker opens. Tap **Save**. Check: the lock screen
      comes first; after the prompt, the backup is written and checked:
      "Backup written".
   9. Tap **Restore a backup**, so that the file picker opens. In the
      recent apps, swipe Water preview away, or use **Force stop**, while
      the picker is open. Then pick the backup of step 8. Check: Water
      starts locked, and after the prompt the screen is there. Write
      down whether the question "Restore this backup?" showed. If it
      did, tap **Cancel**.
   10. Sharing: does not apply. Water shares nothing.

   The app lock screen and the windows:

   11. Open the app lock screen while Water is unlocked. Check: the
       prompt opens before anything shows. Close the prompt. Check: the
       screen closes.
   12. Turn on **Hide in recent apps and block screenshots**. Try a
       screenshot on a screen of Water. Check: Android refuses it, and
       the recent apps show Water preview blank. Turn it off again.

   Notifications:

   13. Turn the app lock off. Set the next reminder for about two
       minutes from now, without a start fresh, and allow notifications:
       **Continue**, then **Allow**. Let the reminder show. Then turn the
       app lock on. Check: the reminder in the shade changes to
       "Drink reminders" and "The app lock hides this notification. Open
       the app to see it.", with no new sound. Its buttons **Drank 150
       ml** and **Later** are gone. A tap on it opens Water behind its
       lock screen.
   14. Wait for the next reminder: it comes 30 minutes after the one of
       step 13. Check: it shows in the hidden form, without amounts and
       without **Drank** and **Later**. Turn on **Show the text in
       notifications** on the app lock screen, and wait for the reminder
       after it, 30 minutes later. Check: "Time for some water", the
       amounts, and both buttons.

   Without a kept recovery key. Do this last, because it clears Water:

   15. Turn the app lock off. In Android's Settings, open **Apps**,
       **Water preview**, **Storage**, and tap **Clear storage**. Open
       Water preview, tap **Settings**, **Recovery key**, and enter the
       24 test words. When the prompt asks to keep the recovery key on
       this phone, close it. Then turn the app lock on. Check: it asks
       for all 24 words on the screen "Enter your recovery key", then
       one prompt. Check on the security screen: the key is still not
       kept.
4. [ ] Backup and restore. On one device, then on a second one.

   Before you start, on the first device:

   - Start fresh, so that Water preview has no recovery key.
   - In **Settings**, set **Daily goal** to 2,500 ml and **Every** to 2
     hours. Turn on **Remind me to drink**, and allow notifications.
   - Log three drinks on Today.

   1. In **Settings**, tap **Make a backup**. Check: with no recovery
      key, "Set up your recovery key first" shows. Tap **Create a
      recovery key** and finish, with new test words on paper. Check:
      Android's "create document" screen opens by itself, with the name
      `water-<today's date>.shkbackup`.
   2. Turn on TalkBack. Tap **Save**. Check: "Writing the backup",
      "Checking the backup", then "Backup written" and "It holds 3
      drinks." Check that TalkBack speaks each of them once. Turn
      TalkBack off.
   3. Make a second backup into a storage app that is not the phone's
      own storage, for example a USB stick. Check: the same end. If it
      says "Backup written, not checked", write down which storage app
      it was.
   4. Delete one drink. Tap **Restore a backup** and pick the file of
      step 2. Check: the question names the date and time of step 2 and
      3 drinks. Tap **Cancel**. Check: nothing changed.
   5. Restore the file. Check: "Backup restored", and the drink stays
      deleted, as the question said.
   6. Pick a photo for a restore. Check: "Not a backup", and nothing
      changed.
   7. On a second device, start fresh. Tap **Restore a backup**. Check:
      "Enter your recovery key first". Tap **Enter the words**, and enter
      the 24 test words of step 1. Check: the picker opens by itself.
      Restore the file of step 2, or its copy on the USB stick, on the
      same day. Check: Today shows the three drinks and the goal of 2,500 ml, and
      **Settings** shows **Every** 2 hours and **Remind me to drink** on,
      as on the first device.
   8. Still on the second device: check that the reminder line on
      **Today** says "Reminders are on, but Water may not show
      notifications yet." and offers **Allow**. Tap **Allow**, then
      **Continue**, then **Allow** in Android's question. Check: a
      reminder comes at the time the line names.
   9. Turn the app lock on, with **When it leaves the screen**. Make a
      backup. Check: after the picker, the lock screen comes first, and
      after the prompt the backup is written and checked.
5. [ ] Uninstall Water preview on all three devices when you are done:
   long-press its icon, tap **App info**, then **Uninstall**. Also in
   the secondary user and in Private Space.

## Part 4: Release

1. [ ] Merge the pull request. Merge nothing else that changes Water, a
   module it is built from (`android/feature/water` and `android/core`)
   or the build (`android/build-logic`, `android/gradle`) before step 5.
2. [ ] CI is green on the newest commit of `main`. Open the **Actions**
   tab and tap **CI**. The top run on `main` has a green tick. Right
   after the merge, wait for it.
3. [ ] The first time only: turn on the dependency graph and Dependabot
   alerts.
   1. Open `github.com/shkriuss/shkriuss.app/settings`.
   2. In the menu, under **Security and quality**, tap **Advanced
      Security**.
   3. Under **Dependency graph**, tap **Enable**. Leave **Automatic
      dependency submission** at **Disabled**.
   4. Under **Dependabot**, enable **Dependabot alerts**. Leave
      **Dependabot security updates**, **Grouped security updates** and
      version updates off.
   5. Open
      `github.com/shkriuss/shkriuss.app/actions/workflows/dependency-graph.yml`.
      Tap **Run workflow**, leave the branch at `main`, and tap **Run
      workflow**.
4. [ ] No known vulnerability is open.
   1. Open
      `github.com/shkriuss/shkriuss.app/actions/workflows/dependency-graph.yml`.
      The newest run on `main` is green: both **List** and **Submit**.
      The summary of **Submit** says "GitHub answered:" and then
      "SUCCESS" or "ACCEPTED".
   2. Open `github.com/shkriuss/shkriuss.app/security/dependabot`. No
      alert is open.
   3. If an alert is open, stop. Tell Claude in a session which library
      it names. Claude checks whether it ships in Water.
5. [ ] Run the release workflow.
   1. Open `github.com/shkriuss/shkriuss.app/actions/workflows/release.yml`.
   2. Tap **Run workflow**. Leave the branch at `main`.
   3. Pick the app `water`. Type the version `1.0.0`.
   4. Tap **Run workflow**. Pull the page down to reload it, then tap
      the new run, "Release water 1.0.0".
   5. Wait for **Build** and **Rebuild and compare**.
   6. **Sign** then shows "Waiting". Tap **Review deployments**, tick
      `release` and tap **Approve and deploy**.
   7. Wait for **Sign** and **Draft release** to finish.
6. [ ] Check the draft `water-v1.0.0`.
   1. Open `github.com/shkriuss/shkriuss.app/releases`, and find the
      draft named `water-v1.0.0`.
   2. The notes link to the run you just started, and it is green.
      **Build** showed the package `app.shkriuss.water` and version
      `1.0.0`.
   3. The certificate SHA-256 in the notes is the same as the current
      certificate in
      [fingerprints.md](../../security/fingerprints.md).
   4. It has three files: `water-v1.0.0.apk`,
      `water-v1.0.0-mapping.txt` and `SHA256SUMS`.
   5. It does not say "Pre-release".
7. [ ] Publish the draft. Tap the pencil next to it. Do not change the
   tag or the target. Tap **Publish release**.
8. [ ] Open `github.com/shkriuss/shkriuss.app/tags`. The tag
   `water-v1.0.0` is there, on the commit from the notes.

## Part 5: After publishing

1. [ ] Install Water with Obtainium, on the Pixel 9 Pro. It is Water's
   first release, so install it, do not update.
   1. Open Obtainium and tap **Add app**.
   2. In **App source URL**, type
      `https://github.com/shkriuss/shkriuss.app`.
   3. In **Filter release titles by regular expression**, type
      `^water-v`.
   4. If the version is a pre-release (it has a hyphen, such as
      `1.0.0-rc.1`), turn on **Include prereleases** for Water. 1.0.0 is
      not one, so leave it off.
   5. Tap **Add**. Obtainium shows `water-v1.0.0`. Tap **Install**.
   6. If Android asks whether Obtainium may install apps, allow it, then
      go back and tap **Install** again.
2. [ ] Check Water with AppVerifier.
   1. Open AppVerifier and pick Water.
   2. Its package name is `app.shkriuss.water`.
   3. Compare the SHA-256 it shows with the current certificate in
      [fingerprints.md](../../security/fingerprints.md). Every pair is
      the same. Water is not in the table of that page yet: Claude adds
      it after this step.
3. [ ] Long-press the Water icon and tap **App info**. It shows version
   1.0.0.
4. [ ] Open Water. It opens on **Today**, with no setup. **Settings**
   shows **Version** 1.0.0 under About.
5. [ ] Tell Claude in a session that Water 1.0.0 is published, with
   your results. Paste the prompt below, with your results in place of
   `<results>`.

## The prompt after publishing

```text
Read CLAUDE.md and docs/apps/water/release-checklist-1.0.0.md. I
published Water 1.0.0 as water-v1.0.0. These are my results of that
checklist, part by part, with the exact words the phones and TalkBack
showed: <results>.

Record the release:

1. docs/user/apps.md: Water's status becomes "Released: 1.0.0".
2. README.md: the status names Water 1.0.0 as released, next to
   Catalog 0.3.0.
3. The hub site: add docs/user/water.md, docs/user/recovery-key.md,
   docs/user/app-lock.md, docs/user/backup.md and
   docs/user/reminders.md to site/site.json. First remove these
   sentences from them:
   - water.md: "Water is not released yet."
   - recovery-key.md, app-lock.md and backup.md: "It is not released
     yet."
   - reminders.md: "No released app has reminders yet. The first one
     will be Water, whose reminders were built in Phase 2, step 4."
   Update docs/user/README.md and docs/development/site.md to match.
4. I am the owner and I ask you to add the row
   "| Water | `app.shkriuss.water` |" to the table "Apps signed with
   this key" in docs/security/fingerprints.md. Change nothing else on
   that page.
5. The results of the phone checks:
   - docs/security/threat-model.md, open point 5 under "Open in other
     pages";
   - docs/architecture/notifications.md, open question 4;
   - docs/user/reminders.md, "Not yet checked on a phone";
   - docs/development/emulator-tests.md, the three sections "Steps for
     the three devices: ...";
   - docs/user/app-lock.md and docs/user/backup.md;
   - docs/apps/water/spec.md, open item 5: how TalkBack reads "ml" and
     "fl oz" on the buttons of a reminder.
   Close what passed. Fix any step or page that did not match, and
   tell me what you changed.
6. android/app/water/CHANGELOG.md: the 1.0.0 heading with its date, and
   "Released as water-v1.0.0". In the checklist: tick the boxes and
   write its Result.
7. docs/development/PROMPTS.md: record the Phase 2 gate.
8. Check the published water-v1.0.0.apk as Claude did for Catalog
   0.3.0: its SHA-256 against SHA256SUMS and the notes, its version and
   version code, its five permissions, no native library, its
   certificate against fingerprints.md, and the licence files of
   docs/development/third-party.md.

Do not start a workflow and do not create a tag. If a result shows a
bug, stop and tell me before you change anything else.
```
