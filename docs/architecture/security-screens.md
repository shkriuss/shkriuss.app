# Recovery key screens and the app lock

The screens of the recovery key, the security screen and the optional
app lock, in `android/core/security`. Every app that holds keys uses
them. They build on `core/crypto` and follow
[crypto-design.md](../security/crypto-design.md), "The recovery key" and
"The app lock".

The module also holds the protection against other apps
([Overlays and accessibility services](#overlays-and-accessibility-services)),
the dialog for the moment the key is first needed
([The recovery key when first needed](#the-recovery-key-when-first-needed))
and the handover between apps
([The handover between apps](#the-handover-between-apps)).
Water is the first app that uses the module.

## What an app does

1. Its app class implements `SecurityHost`: it hands out the app's one
   `ShkCrypto`, built and started when the app starts, and its one
   `AppLockWatcher`, started in `onCreate`
   ([What an app does for the app lock](#what-an-app-does-for-the-app-lock)).
   Android creates the screens itself, so they reach both through the
   app class, as `core/notify` reaches `Notify`
   ([ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md)).
2. It opens a screen with an intent from `SecurityScreens`:
   - `securityIntent`: the security screen, from the app's settings.
   - `createIntent`: create a recovery key, for example at the first
     start.
   - `enterIntent`: enter the words of a recovery key the user has.
   - `appLockIntent`: the app lock screen, from the app's settings.
3. Where a button starts a backup, a restore or the app lock, it calls
   `RecoveryKeyFirstNeed`, so that the recovery key comes when it is
   first needed
   ([The recovery key when first needed](#the-recovery-key-when-first-needed)).
4. It gets the permissions `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`,
   the eight screens, the status provider and the `<queries>` of the
   handover through the module's manifest
   ([permissions.md](../security/permissions.md#apps-that-use-coresecurity),
   [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md),
   [ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md),
   [ADR 0041](../adr/0041-the-handover-between-apps.md)).

The APK rules check fails the build of an app whose merged manifest has
one of the eight screens without both permissions
([build.md](../development/build.md#apk-rules-check)).

## The screens

Each flow is an activity of its own. Only the handover screen is
exported, with no permission: it checks the calling app first
([The handover between apps](#the-handover-between-apps)).

| Screen | What it shows |
|---|---|
| `SecurityActivity` | Where the recovery key stands: none, a setup that stopped, or set up with its key ID. With none, it says how to use a key that another app of the suite has: "If another shkriuss app already has your recovery key, tap I have a recovery key and enter the same words." With a keeper on the phone, also **Get the keys from Water**. Whether this phone keeps it, or which app does: "The recovery key is kept in Water", with **Open Water**. The screen lock. Each hardware key and where it lives: StrongBox, TEE, secure hardware of an unnamed kind, or software only. A repair notice, and "Give up these files" when a keyset no words can bring back is damaged. |
| `CreateRecoveryKeyActivity` | Before the words; the 24 words; four of them to confirm at positions picked at random; storing; keeping the key with the system prompt; done. With the start-over extra, the new key starts a stopped setup over. |
| `EnterRecoveryKeyActivity` | The 24 words, typed one at a time; the check; storing, which also repairs a damaged keyset; keeping; done. Other words in a stopped setup offer to start over. |
| `ShowRecoveryKeyActivity` | Before the prompt; the words, once per prompt. |
| `AppLockActivity` | The app lock screen ([The app lock](#the-app-lock)). |
| `TurnOnAppLockActivity` | Turning the app lock on: the warning, the words, the prompt. In an app that does not keep the key, with a keeper of its key on the phone, also **Check the words in Water**. |
| `HandoverActivity` | A keeper's handover screen: another app of the suite asks for its own keys, or for four words to be checked. Exported with no permission. It checks the caller first and shows a refused caller nothing ([The handover between apps](#the-handover-between-apps)). |
| `GetKeysActivity` | Getting this app's keys from a keeper: it opens the keeper's handover screen, stores what comes back and says how it went. |

Why activities and not screens inside the app's own window:

- The window gets `FLAG_SECURE` and the shield against other apps in
  `onCreate`, before anything is drawn.
- A flow's ViewModel, and the recovery key with it, ends when its
  activity finishes.
- A turn of the phone keeps the key in the ViewModel. It is never in a
  saved state.
- No navigation library is needed. Water, the first app, does not use
  Navigation 3 either
  ([ADR 0003](../adr/0003-kotlin-compose-material-3-navigation-3.md),
  point 2).

## The recovery key when first needed

An app opens on its main screen with no setup. The recovery key comes
when a backup, a restore or the app lock is first asked for
([ADR 0035](../adr/0035-recovery-key-when-first-needed.md)). The dialog,
its words and the "go on after" are built once, in `FirstNeed.kt`, so
every app shows the same.

What an app does:

1. The screen with the buttons keeps one
   `rememberRecoveryKeyFirstNeedState()` and draws
   `RecoveryKeyFirstNeed(state, onReady)` once, inside `AppLockGate`.
2. A button calls `state.start(need)`. `RecoveryKeyNeed` says which of
   the three it is for: `BACKUP`, `RESTORE` or `APP_LOCK`.
3. `onReady(need)` is the app's next step: the file picker, or the app
   lock screen.

What it does:

1. It reads the app's keys, on a background thread.
2. The app has its keys from a recovery key: `onReady` runs at once. No
   dialog shows.
3. It has none: one dialog shows.

   | Form | Title | Buttons |
   |---|---|---|
   | A backup, or the app lock | "Set up your recovery key first", with one sentence on why, which differs for the two, and under it: "If another shkriuss app already has your recovery key, tap I already have one and enter the same words." | **Create a recovery key**, **I already have one**, **Not now**. With a keeper on the phone, also **Get the keys from Water**, one for each keeper. |
   | A restore | "Enter your recovery key first" | **Enter the words**, **Cancel**. There is no "create": a new key cannot open an old backup. With a keeper on the phone, also **Get the keys from Water**. |
   | A setup that stopped, whatever was started | "Finish your recovery key" | **Open the security screen**, **Not now** |

4. A button opens `CreateRecoveryKeyActivity`, `EnterRecoveryKeyActivity`,
   `GetKeysActivity` or `SecurityActivity`. The keepers are asked when
   the dialog shows, on the background thread.
5. When that screen closes, however it was closed, the keys are read
   again. The screens give back no result: only the keys say whether
   they are there.
   - The app now has its keys: `onReady` runs, so the app goes on with
     what the user started, without another tap.
   - It has not: nothing else happens. The user is back on the app's
     screen.
6. "Not now", "Cancel", Back and a tap outside the dialog end it.

More:

- What the user started, and where it stands, is in the screen's saved
  state. So it holds through a turn of the phone and through a long
  setup, also when Android stops the app in between. No key and no word
  is ever in it.
- A start while another one is not done is ignored.
- If the keys cannot be read now, nothing happens. The security screen
  says what is wrong.
- The dialog is a window of its own. It takes the shield of the screen
  it opens over, if that has one (`shieldedLike`). An app's own screen
  has none.
- The dialog can never show while the app lock is on: the app lock needs
  the recovery key. It is still drawn inside the gate, as every dialog
  is, and `FirstNeedBehindTheAppLockTest` checks that it goes when the
  app locks.
- The three buttons of the first form use the third button of
  `ShkDialog` in `core/design`
  ([design-system.md](../development/design-system.md#optional-parts-for-backup-and-the-recovery-key)).

## The handover between apps

A keeper gives another app of the suite its own keys, never the
recovery key ([ADR 0041](../adr/0041-the-handover-between-apps.md);
[crypto-design.md](../security/crypto-design.md#setting-up-a-second-app-on-the-same-phone)).
The parts are in `Handover.kt`, `HandoverCalls.kt`,
`HandoverViewModels.kt` and `KeeperStatusProvider.kt`.

The other apps:

1. `SuiteApps` is how a screen sees the other apps of the suite.
   `AndroidSuiteApps` asks Android; a ViewModel takes it through its
   constructor, and tests pass their own.
2. `peerName` applies the check of ADR 0041, point 9: a data app of the
   suite, of the same build kind, with exactly one signer whose
   certificate bytes are those of this app. `SuitePeers` holds the rule
   on its own, without Android.
3. `keepers` lists the apps with a handover screen that pass the check,
   and asks each one's status provider whether it keeps the recovery
   key now, and its short name. It is slow, so it runs on the
   background thread.

The keeper's side, `HandoverActivity` and `HandoverViewModel`:

1. It reads the request with `HandoverRequest.of`, first, before it
   shows anything: Android's calling package, which must pass the check,
   then the request's version and mode. A caller that fails, or a
   request it cannot read, gets a cancelled result that says `REFUSED`.
   A request of a newer version gets `UPDATE`. Either way the screen
   closes at once and shows nothing.
2. It shows the two apps' names and the short name of the kept key, and
   **Allow** and **Do not allow**. It does not ask for the keeper's own
   app lock: it shows no data of the keeper.
3. **Allow** shows the system prompt of the Recovery guard.
   - For the keys: `core/crypto` makes the asking app's keys inside the
     prompt step. The recovery key never reaches the screen.
   - For the check of the words: the prompt reads the kept key, four
     words are asked, as when the keeper turns its own app lock on, and
     `handOverAfterWords` makes the keys marked as checked.
4. When the screen stops, the kept key and keys not handed over leave
   memory. A turn of the phone does not count. A prompt answered after a
   stop gives nothing.
5. The screen checks the caller once more (`handoverResult`): it must
   still be the app that asked, and still pass. Then it gives it the
   keys in the result, and closes. Otherwise it gives `REFUSED` and no
   keys. The keys never stay in the ViewModel after that.
6. A keeper that does not keep the key now says so, with **Close**, and
   gives `NOT_KEEPER`. So does a kept copy that is damaged when the
   prompt runs (`closingRefusal`). The screen sets that result as soon
   as it shows, so Back gives it too. The asking app then says so: "Get
   the keys" tells the user to enter the words instead, and the check of
   the words for the app lock asks for all 24.
7. **Do not allow**, or leaving the screen, gives a cancelled result
   with no reason.

The keeper's status provider, `KeeperStatusProvider`:

1. Exported with no permission. Its `call` checks Android's calling
   package with `peerName` first, and gives a caller that fails no
   answer.
2. Its one call, `status`, says whether the app keeps the recovery key
   now, and the key ID of its current key (`KeeperStatus`). It reads the
   keys on each call, so the answer is live. A key that cannot be read
   now counts as not kept.
3. It answers no query, opens no file and changes nothing.

The asking app's side, `GetKeysActivity`, `GetKeysViewModel` and
`KeeperCall`:

1. `KeeperCall` is made in the screen's `onCreate`. It registers its
   callback for the result with no lifecycle, and drops it when the
   screen is destroyed. So Android hands it the answer at once, also
   while the screen is stopped, and AndroidX never keeps the answer as a
   pending result in the screen's saved state
   ([ADR 0041](../adr/0041-the-handover-between-apps.md), point 20). It
   checks the keeper before it opens it, and again when the answer comes
   back. Android may end the asking app's process while the keeper's
   screen is in front. So the screen's saved state holds the application
   ID of the app that was asked, and nothing else, and the answer reaches
   the new screen with it. The turn-on screen's model holds an answer
   that comes before its warning is read, until it is.
2. `KeeperAnswer.of` reads the answer: the keys, which `core/crypto`
   reads and checks, or why there are none. `REFUSED` reads as "this app
   cannot take keys from that one": one of the two is signed otherwise,
   or not up to date.
3. `GetKeysViewModel` stores the keys with `storeHandedOverKeys` and says
   how it went. A "no" on the keeper's screen closes it, and nothing
   changed.
4. The turn-on screen uses the same `KeeperCall` for **Check the words
   in Water**, which it offers only for keepers of its own key ID, and
   takes the keys as its proof with `checkWordsAtKeeper`.

Keepers on the other screens:

1. The security screen lists the keepers each time it comes to the
   front. With no recovery key, or a setup that stopped, it offers **Get
   the keys from Water** for every keeper. With a keyset file to repair,
   or an app lock that was reset, it offers it for the keepers of its own
   key ID, or for every keeper when it cannot tell its key ID, as with a
   damaged `record` (`SecurityState.getKeysKeepers`). Set up and not kept: "The recovery key is kept in Water",
   only for keepers of its own key ID, with **Open Water**.
2. The keeping step asks "Keep it here too?" when a keeper of the same
   key is on the phone ([crypto-design.md](../security/crypto-design.md#creating-it),
   step 6). After **Not now**, the done screen names that keeper
   (`FlowDone.keptIn`) instead of saying the paper is the only copy.
   So does **Not now** after **Keep it here too** and a prompt that was
   closed or failed.

## What protects the words

"Screens that show or take the words" in crypto-design.md, as built:

1. `secureWindow` sets `FLAG_SECURE` and
   `setRecentsScreenshotEnabled(false)`, and turns autofill and content
   capture off for the whole window. Every screen calls it first.
2. The words are plain text, never in a `SelectionContainer`. Nothing
   puts them on the clipboard.
3. The word field asks the keyboard for a password field that shows its
   letters, adds `IME_FLAG_NO_PERSONALIZED_LEARNING` and
   `TYPE_TEXT_FLAG_NO_SUGGESTIONS`, and turns autocorrect off.
4. Nothing is copied or cut from the word field, and nothing is pasted
   into it (`noCopyCutPaste` in `WordField.kt`):
   - The field's text menu has no entry, so Android shows no menu. That
     also takes out the entries that hand selected text to another app,
     such as "Share". A click of the right mouse button opens nothing.
   - The keys for copy, cut and paste are taken before the field sees
     them: Ctrl with C, X, V or Insert, Shift with Insert, and the keys
     Copy, Cut and Paste. A keyboard app sends its own copy, cut and
     paste as those keys.
   - The accessibility actions copy, cut and paste do nothing. TalkBack
     may still list them.
   - The field takes only `a` to `z`, at most eight letters, and at most
     one new letter per change.

   These are the ways a text field of Compose Foundation 1.12.1 copies,
   cuts and pastes. A newer version is read again for others.
   - Smart selection is off for the whole app:
     `AppLockWatcher.start()`, which every app calls first in its app
     class, sets `ComposeFoundationFlags.isSmartSelectionEnabled` to
     false. Otherwise a long press would hand the selected letters to
     Android's text classifier. A newer version of Compose is checked
     for this flag too.
5. The words of the list that start with what is typed show as buttons
   under the field, in the screen itself. A popup would be a second
   window. When the letters start no word of the list, the field says so
   under it at once, as its error, which TalkBack reads
   (`WordInput.startsNoWord`). The create flow's four fields and the
   entry field are the same `WordField`.
6. Dialogs inherit `FLAG_SECURE` from the screen, and take its shield
   against other apps
   ([Overlays and accessibility services](#overlays-and-accessibility-services)).
7. The words leave the show screen when it stops: the phone's screen
   turns off or another app comes to the front. A new prompt shows them
   again. A prompt that was asked for before the stop shows nothing,
   whether its answer comes before the stop or after it: the check and
   the stop both run on the main thread.
   The create and enter flows keep the key while stopped, because
   nothing is stored yet and a screen times out while the user writes.
   A flow that ends on its failure screen drops the key as that screen
   shows. The screen has only "Done" and no way back to the words.
8. A preview build shows a warning on every screen: never type your real
   recovery words into it.
9. Other apps' windows are hidden, a tap under another app's window does
   nothing, and only accessibility tools can read the screen
   ([Overlays and accessibility services](#overlays-and-accessibility-services)).

## Overlays and accessibility services

Decided by the owner
([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)).
The ADR says what Android offers, and why these choices.

| Where | Other apps' windows | A tap under another app's window | Accessibility services |
|---|---|---|---|
| The eight screens | Hidden while the screen shows | Does nothing | Only accessibility tools |
| Their four dialogs | Hidden: the screen behind still shows | Does nothing | Only accessibility tools |
| The lock screen | Hidden while the app is locked | Reaches the screen | Every service |

How it is built, in `WindowShield.kt`:

1. `shieldWindow` sets `filterTouchesWhenObscured` on the window's root
   view, and calls `setAccessibilityDataSensitive(YES)` there. Every view
   below inherits both, Compose's own view too.
   - `secureWindow` calls it, so the five screens that show or take the
     words get it with the rest.
   - The app lock screen calls it itself: whether it blocks screenshots
     follows the app's setting.
2. `hideOtherAppsWindows` calls Android's `Window.setHideOverlayWindows`.
   - Each of the eight screens calls it in `onCreate`.
   - They are `ShieldedScreen`s, so the app lock watcher leaves that part
     of their window alone.
3. A dialog is a window of its own. `Modifier.shieldedLike` copies the
   shield of the screen behind it onto the dialog's window when the
   dialog is drawn.
   - The four dialogs of the security screen and the app lock screen
     pass it.
   - A notice of the app lock over an app's screen passes it too. That
     screen has no shield, so neither has the notice.
4. While the gate is `LOCKED`, the watcher has every other window of the
   app hide other apps' windows.
   - It sets this when the lock comes, in Android's callback before the
     screen starts again.
   - It takes it away when the gate opens.
5. Without `HIDE_OVERLAY_WINDOWS`, Android would throw.
   `hideOtherAppsWindows` does nothing instead, and the screen keeps the
   rest. Two checks make sure the permission is there:
   - `ManifestTest` checks the module's manifest;
   - the APK rules check fails the build of an app that has a screen of
     this module and does not request both permissions
     ([build.md](../development/build.md#apk-rules-check)).

What the user sees:

- While one of these screens shows, other apps' floating windows
  disappear: screen dimmers, chat heads, the buttons of other apps'
  screen recorders. They come back after. Android's own windows stay:
  the status bar, the keyboard, TalkBack, notifications and the system
  prompt.
- A tap under another app's window does nothing, and nothing says so.
  With other apps' windows hidden, it hardly ever happens. The user
  guide says to close the app that draws over others.
- Only accessibility services that declare themselves accessibility
  tools can read these screens or act on them.
  - An assistive app that does not declare itself an accessibility tool
    cannot read these screens.
  - A harmful service can falsely claim to be a tool
    ([threat model](../security/threat-model.md#out-of-scope)).
  - TalkBack must keep reading them.

Not covered, as accepted deviations in the
[threat model](../security/threat-model.md#platform):

1. The lock screen takes a tap under another app's window and speaks to
   every accessibility service. It shows only the app's name and
   "Unlock", which opens the system prompt. It must stay usable with
   every assistive app.
2. A tap on a screen that another window covers only elsewhere is not
   refused. That would refuse taps whenever a video in
   picture-in-picture overlaps the screen.
3. The other screens of the apps hide no other app's windows. They show
   records, not keys, and a dimmer would vanish whenever the app is
   open.

## The system prompt

1. Only `core/security` shows it: Android's own `BiometricPrompt`, a
   strong fingerprint or the phone's PIN, pattern or password.
2. `core/crypto` hands out a `PromptStep`. The screen gives its
   `cryptoObject` to the prompt and never sees the cipher.
3. Success: the step finishes on a background thread. A cancel or an
   error: the step is thrown away, and the screen shows its button again.
4. When the screen goes away, for example when the phone is turned, the
   prompt is cancelled. It never comes back by itself.

## The app lock

The optional app lock of "The app lock" in crypto-design.md, as screens.
With it on, the app asks for the system prompt before it shows
anything. The prompt opens the `file-key` keyset, so files need it. The
rows of the database are only behind an access gate: the app lock does
not encrypt them
([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)). The
user guide says so honestly ([app-lock.md](../user/app-lock.md)).

### What an app does for the app lock

1. The app class builds one `AppLockWatcher` and calls `start()` in
   `onCreate`, before any screen starts. It hands it out as
   `SecurityHost.appLock`.
2. Every screen of the app puts its content in `AppLockGate`, inside
   `ShkTheme`.
3. If the app uses `core/notify`, it passes
   `hidesText = appLock::hidesNotificationText` to `Notify`, and
   `onTextHidden = { notify.hideShownText() }` to the watcher. An app
   without notifications passes `onTextHidden = {}`. Neither has a
   default, so no app can forget them.
4. Its settings open `SecurityScreens.appLockIntent`, through
   `RecoveryKeyFirstNeed` with `RecoveryKeyNeed.APP_LOCK`
   ([The recovery key when first needed](#the-recovery-key-when-first-needed)).
   The security screen has a button for it too.
5. It draws every sheet and dialog from inside the gate, so that they go
   with the rest of the screen when the app locks.
6. Its unit tests have one test that starts every screen of the app
   locked, and fails unless each shows the lock screen and nothing of its
   own, and that opens each sheet and dialog, locks the app, and fails
   unless only the lock screen shows. Copy Water's
   `EveryScreenIsBehindTheAppLockTest`
   ([Every screen is behind the gate](#every-screen-is-behind-the-gate)).

```kotlin
class WaterApp : Application(), SecurityHost, NotifyHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, AppName.of("water")).also { it.start() } }
    override val appLock: AppLockWatcher by lazy {
        AppLockWatcher(this, crypto, onTextHidden = { notify.hideShownText() })
    }
    override val notify: Notify by lazy {
        Notify(this, channels, reminders, reminders, Clock.System, hidesText = appLock::hidesNotificationText)
    }

    override fun onCreate() {
        super.onCreate()
        appLock.start()
        water.start() // Empties what a restore left behind, and finishes a pending move of the file keys.
        notify.start()
    }
}

class WaterActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShkTheme { AppLockGate { WaterScreens(models, versionName) } } }
    }
}
```

### The gate

`AppLockGate` shows what `AppLockWatcher.gate` says:

| Gate | What shows |
|---|---|
| `CHECKING` | Nothing yet: the first read of the keys. |
| `OPEN` | The screen. The app lock is off, or the app is unlocked. |
| `LOCKED` | The lock screen, never the screen. The system prompt shows by itself once for each lock, then from the "Unlock" button. Back leaves the app (`moveTaskToBack`). |

1. While locked, the screen's content is not composed. Nothing of it is
   drawn, and TalkBack cannot reach it. A test checks that not one frame
   of it is drawn on the way back.
   - While locked, the window hides other apps' windows. No other app
     can draw a fake system prompt over the lock screen
     ([Overlays and accessibility services](#overlays-and-accessibility-services)).
2. The content's saved state is kept by a `SaveableStateHolder`, and the
   screen's ViewModels live on. So after the prompt the screen is as it
   was.
3. The gate fails at once if the watcher did not see its screen start:
   an app class that never called `start()`, or called it late.
4. If the prompt finds the key file of the app lock damaged, the lock
   screen sends the user to the 24 words. The repair turns the app lock
   off ("A damaged keyset file" in crypto-design.md), and the end of the
   enter flow says so, with a button to the app lock screen.
5. A notice shows over the screen once per run of the app: the app lock
   was reset because the screen lock was removed, or it went off while
   the app was unlocked for the same reason. Some phones keep the Lock
   key's alias then, and Android only says that the key is permanently
   invalidated when the lock screen starts its prompt. The vault then
   counts the key as gone, and the lock screen has the watcher read the
   state again, so the notice shows.
6. The watcher reads the keys again whenever a screen of the app starts,
   and after each flow. `core/crypto` is the truth: a keyset write drops
   the keys from memory (for example keeping the recovery key), and the
   next read locks the gate.
7. An unlock counts only if the app has not locked since its prompt was
   asked for. The file keys come into memory on a background thread,
   after the prompt. If the app locked meanwhile, for example because it
   left the screen, the watcher drops those keys again, the gate stays
   locked, and the lock screen shows its prompt again. The watcher
   decides this on the main thread, where every lock runs
   (`AppLockWatcher.unlocked`). After a lock, a read of the keys never
   opens the gate. Only a prompt does, or turning the app lock on.
   Turning it on counts on the same terms: the mark is taken on the main
   thread before its last prompt shows, so leaving the app after the
   prompt was answered leaves it locked (`AppLockWatcher.turnedOn`).

The screens of the recovery key are not behind the gate. They show no
records, "Show the words" has its own prompt, and the repair must be
reachable while the app cannot be unlocked.

### Every screen is behind the gate

The gate protects only the screens that put their content in it. A
check makes sure every screen does.

What it does, for each app, as a unit test that runs in `check`:

1. The app class of the test, `LockedAppForTests` of `core/testing`, has
   real keys on the stand-in for the Keystore. It turns the app lock on
   and drops the file keys before the watcher starts, as after Android
   stopped the app. So every screen starts locked.
2. The test reads the activities of the app's merged manifest, the file
   that goes into the APK. It leaves out only the eight screens of this
   module, which are not behind the gate on purpose.
3. It starts each one, and fails, naming the screen and what it showed,
   unless:
   - the lock screen shows, once. The gate tags it with
     `LOCK_SCREEN_TEST_TAG`. The tag changes nothing that shows, and no
     screen of the suite gives test tags to accessibility services;
   - nothing beside it, in any window of the screen, holds a text, a
     label, a state or an action. A node around it may only group or
     tag;
   - the screen's content view holds Compose views only.
4. It fails too if the manifest has no screen to check, so it cannot
   pass by checking nothing.

A screen that starts locked never draws its content, so the check above
never sees a sheet or a dialog. A second part checks them:

1. The app class of the test, `AppLockOnForTests` of `core/testing`,
   turns the app lock on but keeps the app open, as after the system
   prompt.
2. For each sheet and dialog of the app, a test starts the screen, opens
   the sheet or the dialog as the user would, and checks that it opened
   in a window of its own.
3. It turns the screen off, as the user would. The app locks.
4. `AppLockCheck.checkLockedNow` then fails, naming what shows, unless
   only the lock screen shows, in every window of the screen.

A sheet or a dialog drawn from inside the gate leaves with the rest of
the screen. One drawn beside the gate would stay, and the check would
name it. After the system prompt it comes back as it was, with what was
typed in it.

Each app has one such test class: Water's
`EveryScreenIsBehindTheAppLockTest`, which every later app copies with
its own app classes and its own sheets and dialogs. The helper is in
`core/testing`, which the build keeps out of every app
([build.md](../development/build.md#shared-test-helpers)).

What it cannot see:

- Something drawn with no semantics at all, such as a picture with no
  label in a window of its own.
- A dialog that is a plain Android view and not Compose.
- A screen in another module that is not in the app's manifest. Such a
  screen cannot start in the app.

Review keeps these out. No screen of the suite uses them.

### When the app locks

The watcher decides on the main thread, inside Android's activity
callbacks.

1. **The app leaves the screen**: the last started screen of the app
   stops. A stop for a turn of the phone does not count, nor does going
   from one screen of the app to another.
   - App lock off: the file keys leave memory. They load again without a
     prompt.
   - App lock on, and the phone is no longer interactive: the screen
     turned off with the app on it. The app locks at once.
   - App lock on, with "When it leaves the screen": the app locks at once.
   - Otherwise the watcher notes the time.
2. **The app comes back** (`onActivityPreStarted`, before Android draws
   it again): if the time away is at least the chosen time, the app
   locks. The time is counted with `SystemClock.elapsedRealtime`, which
   the user cannot change. The gate's state is Compose state, written
   there on the main thread, so the first frame is the lock screen.
3. **Android stopped the app**: no file keys are in memory, so it starts
   locked.
4. **The screen-off broadcast**, registered at runtime, is a help only.
   It locks while the phone is still not interactive. One that arrives
   after the screen is on again is ignored: a lock then would show the
   content first and lock after.
5. There is no delayed lock while the app is away. It would not be sure
   to run.

While the app lock is on, every window of the app has
`setRecentsScreenshotEnabled(false)`. Android takes its picture of the
app as it leaves, before it locks, and shows that picture in the recent
apps and on the way back. Without it, there is no old picture to show.

What cannot be made sure: with a timer, if the user switches to another
app and then turns the screen off, and comes back before the chosen
time, the app may still be unlocked. Android holds the screen-off
broadcast back while the app waits, `ACTION_SCREEN_OFF`
cannot be declared in a manifest, and work after a screen stopped is not
sure to run. "When it leaves the screen" has no such case. The user
guide says so.

### Pickers and the share sheet

1. A system picker or the share sheet is another app's screen, so the
   app has left the screen. There is no exemption for the app's own
   pickers. Whoever holds the phone in the picker does not get back in
   without the prompt.
2. On the way back, if the app must lock, the lock screen comes first.
3. The picker's result reaches the screen's ViewModel as usual. While
   locked, the gate keeps the screen's saved state, with the keys of its
   result launchers, so a result that arrives while the screen is not
   composed waits in Android's registry and arrives after the prompt
   (`AppLockGateTest`).
4. Work that needs a file key, such as adding the picked file, finds the
   file keys locked: `FileCrypto` refuses. The rule for apps: keep the
   picked item in the ViewModel, and go on when `AppLockWatcher.gate` is
   `OPEN` again.
5. Work that needs no file key and that the user started before leaving,
   such as writing a backup to the chosen place, goes on. It shows
   nothing.
6. If Android stops the app while the picker is open, the app starts
   locked. The registry keeps the launched keys in the saved state, so
   the result arrives once the gate opens.

### The app lock screen

1. While the app lock is on, it asks for the system prompt each time it
   opens, before it shows anything. Closing the prompt, or a prompt that
   fails, closes the screen. A turn of the phone asks again. So whoever
   is handed the open app cannot turn the lock off, pick a longer time
   or show the text of notifications.
2. The prompt is `beginUnlock` of the Lock key, which reads the keyset
   file and works also while the app is unlocked. So it unlocks the app
   too. Like the lock screen's prompt, it counts only if the app has not
   locked since it was asked for ([The gate](#the-gate)). Otherwise
   nothing of the settings shows, and the screen asks again.
3. If the app locks while the screen is away, it asks again. It reads
   the watcher's state on the main thread, so the first frame after the
   lock shows nothing of the settings.
4. It shows:
   - the state: on, off, or reset;
   - why the app lock cannot be turned on: no screen lock, no recovery
     key, a setup that stopped, or file keys still moving;
   - turn on, and turn off (after a dialog);
   - while on: "Lock the app" (a dialog of the five choices) and the
     switch "Show the text in notifications";
   - always: "Hide in recent apps and block screenshots", which adds
     `FLAG_SECURE` to every window of the app, and a plain paragraph on
     what the app lock protects.
5. It is not behind the gate: its own prompt does that job.
6. Like the other screens of the module, it hides other apps' windows,
   ignores a tap under another app's window, and speaks only to
   accessibility tools. So no other app can steer a tap
   onto "Turn off" or "Show the text in notifications".

### Turning it on

`TurnOnAppLockActivity` takes recovery words, so it calls `secureWindow`
like the recovery key screens.

1. The plain warning: if the screen lock is removed and the words are
   lost, the files of this app on this phone can never be opened again.
2. A keeper app: one prompt of the Recovery guard reads the kept key,
   then four words at positions picked at random. A wrong word is named;
   the words are never shown. If the kept copy cannot be read, the app
   asks for all 24 words instead. If the screen stops while the key is
   in memory (the phone's screen turns off, or another app comes to the
   front), the key leaves memory, as on the screen that shows the words.
   A turn of the phone does not count. The prompt asks again on the way
   back. The key that the prompt read is kept on the main thread, where
   the stop is handled, so a stop that comes just as the read ends keeps
   nothing.
3. An app that does not keep the key: all 24 words, on the screen of
   "Enter your recovery key" (the same composable and rules). Words that
   give this app's own `record` key are the proof. The key is not kept.
4. The check gives a `WordsProof`, which names the key ID of the
   `record` key it was checked against. `beginTurnOn` refuses a proof for
   another key. The prompt of the new Lock key turns the app lock on. A closed prompt leaves it off and can be opened
   again with the same check.
5. The recovery key leaves memory right after the check.

### Settings

The three settings are in a small file of their own, as `core/notify`
keeps its state ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)):
when the app locks, the screenshot block, and the text of notifications.
Whether the app lock is on is not a setting: only the `file-key` keyset
file says that.

## State

- Each screen has one ViewModel that exposes one immutable state as a
  `StateFlow` (CLAUDE.md). The states are plain classes in
  `SecurityStates.kt`.
- Every call into `ShkCrypto` runs on a background thread: StrongBox is
  slow.
- The ViewModel gets `ShkCrypto` through its constructor. Its factory
  reads it from the app class.

## Catalog

- Catalog shows each state with sample words on the page "Recovery key
  screens". The screens are drawn without their activity, so the content
  composables are public behind the opt-in marker `SecurityScreenSamples`,
  which only Catalog uses.
- Catalog shows each state of the app lock screens on the page "App
  lock screens": the lock screen, the app lock screen, its dialogs drawn
  in place, the notices, and turning it on.
- Catalog lists the four forms of the first-need dialog on the page
  "Recovery key when first needed". Each opens on a screen of its own,
  drawn in place (`RecoveryKeyFirstNeedSample`). The dialog shows no
  recovery words, so the page has no switch to protect it.
- Catalog's manifest removes `USE_BIOMETRIC`, `HIDE_OVERLAY_WINDOWS`,
  the eight screens, the status provider and the `<queries>`. It holds no keys, has no app lock and takes no part in
  a handover. Its pages show the handover screens with sample names.
- The switch **Protect this page, as in an app** on both pages calls
  `secureWindow`, to try it on a phone. It blocks screenshots and shields
  the page and the dialogs opened from it. It cannot hide other apps'
  windows: Catalog has no permission. It is off by default, so that the
  owner can send screenshots of the page.

## Tests

- `FlowViewModelsTest`: every flow with real cryptography on the
  stand-in for the Keystore, with the prompt answered, closed and gone.
  This includes start over, repair, giving files up and a phone with no
  screen lock. A prompt asked for before the show screen stopped shows no
  words, also when the stop runs before its answer arrives. A flow on its
  failure screen holds no recovery key.
- `SecurityActivitiesTest`: every screen blocks screenshots and keeps
  autofill and content capture away. Every screen ignores a covered tap,
  every view of it is marked for accessibility tools only, and it hides
  other apps' windows. Without the permission, every screen still starts
  and keeps the rest. A word is typed and picked. Letters
  that start no word are named under the field at once, and the next key
  takes nothing. The list shows only the words entered and the current
  one. A paste never lands. The keyboard gets a password field with no
  suggestions and no learning. Every button has a label and a 48 dp
  target.
- `ConfirmWordsTest`: the four fields that confirm a new key name letters
  that start no word, each under its own field.
- `DialogShieldTest`: the four dialogs take the shield of their screen. A
  dialog over a screen without one has none.
- `ManifestTest`: the module asks for exactly `USE_BIOMETRIC` and
  `HIDE_OVERLAY_WINDOWS`, defines no permission, exports only the
  handover screen and the status provider, both with no permission, and
  sees only the apps with a handover screen.
- `HandoverGateTest`: the real gate, with apps installed in Robolectric's
  package manager with their signing information. Who passes the check
  and who is refused: another certificate, two signers, a lineage, Sync,
  Catalog, a preview, a stranger, an app not installed. The handover
  screen started by refused callers and with hostile requests gives
  `REFUSED` or `UPDATE` and shows nothing. The real screen gives the
  keys after **Allow** and the prompt, and gives `REFUSED` instead when
  the asking app was replaced by one signed otherwise before the second
  check. The status provider with no caller, with a refused one, and
  with the caller that Android names, not one that the call names.
  Which apps are listed as keepers. The result callback gets an answer
  while the screen is stopped and leaves nothing of it in the saved
  state.
- `HandoverRulesTest`: who may take part in a handover, every refused
  app, how a keeper reads a request, how an asking app reads every
  answer and checks the keeper again, and what the status provider says
  to whom.
- `HandoverViewModelsTest`: both sides of the handover with real
  cryptography on the stand-in: Allow and the prompt, a closed prompt,
  a keeper that does not keep the key, keys and the kept key dropped
  when the screen stops, the check of four words, every outcome on the
  asking app's side, an app lock that was reset, "keep it here too",
  the check of the words for the app lock, and the security screen's
  keepers.
- `SecurityContentTest` and `FirstNeedTest`: the choices to get the keys
  from a keeper, on the security screen and in the dialog, and the
  screen they open.
- `WordInputTest`: what a word field accepts and offers, and which
  letters start no word.
- `WordFieldTest`: select all and copy by keys leaves the clipboard as
  it was, and so do cut by keys and the accessibility actions. Paste by
  keys or by the accessibility action brings nothing into the field.
  The text menu is offered nothing, and the right mouse button opens no
  menu.
- Catalog's `SecurityScreensScreenshotTest`: every state in the four
  standard configurations: phone light at font scale 1.0, phone dark at
  2.0, tablet light at 2.0 and tablet dark at 1.0.
- `AppLockWatcherTest`: each timer choice, a turn of the phone, moving
  between the app's own screens, the screen turned off with the app on
  it, a screen-off broadcast in time and late, a watcher that finds no
  keys in memory starting locked, a keyset write that drops the keys,
  the window flags, `hidesNotificationText`, `onTextHidden` and the
  notices. An unlock whose file keys come after the app locked again
  does not count, from the lock screen and from the app lock screen, and
  the prompt is asked for again. One that comes while the app is away
  but not locked counts. After a lock, a read of the keys does not open
  the gate. While locked, every screen of the app hides other apps'
  windows, set before the screen starts again. The eight screens of the
  module always do. Without the permission, the lock screen still shows.
- `AppLockGateTest`: nothing of the screen while locked, not one frame
  drawn on the way back, the screen as it was after the prompt, a closed
  prompt, Back, a picker's result kept across a lock, and the reset
  notice. `AppLockGateWithoutAWatcherTest`: the gate fails when the
  watcher was not started.
- `AppLockViewModelsTest`: the lock screen's prompt, once per lock; the
  app lock screen's prompt each time it opens, closed, gone and after a
  lock; why it cannot be turned on; the settings kept; turning off;
  turning on in a keeper and in an app that does not keep the key, with
  wrong words, other words, closed prompts and a kept copy that cannot
  be read; the kept key dropped when the screen stops, also while the
  prompt still reads it and right after it was read, kept through a turn
  of the phone, and the prompt asking again on the way back; the mark
  of the last prompt, taken before it shows; a Lock key that Android
  calls permanently invalidated, which leads to the reset notice.
- `AppLockActivitiesTest`: the app lock screen's labels and touch
  targets.
- `AppLockCheckTest`: the check that every screen is behind the gate,
  on sample screens. It passes a screen whose content is all in the
  gate, and fails, naming the screen, for a screen with no gate, with
  content beside the gate, with a label around it, with a dialog
  outside it, with a plain view beside the Compose content, and for an
  app with no screen to check. `AppLockCheckWithoutALockedAppTest`: the
  check refuses an app that does not start locked. `MergedManifestTest`
  of `core/testing`: how the check reads a merged manifest.
- `FirstNeedFormTest`: which form shows for each need, with keys, with
  none and after a setup that stopped. `FirstNeedTest`: with keys the
  app goes on at once and no dialog shows; each form with its words and
  buttons; the screen each button opens; the app goes on when that
  screen closes and the keys are there; nothing happens when it closes
  without them; "Not now", "Cancel" and Back; a turn of the phone keeps
  the dialog and keeps what was started while a screen is open.
  `FirstNeedBehindTheAppLockTest`: the dialog inside a gate goes when
  the app locks.
- `AppLockGateTest` and `AppLockActivitiesTest` wait for the state they
  read. The lock screen and the app lock screen work on a background
  thread, and Compose's `waitForIdle` does not wait for it. Without the
  wait, a slow thread makes such a test fail now and then
  ([build.md](../development/build.md#tests-that-wait-for-a-background-thread)).
- Water's `EveryScreenIsBehindTheAppLockTest`: every screen of Water's
  merged manifest, locked, and every sheet and dialog of Water, with
  those of backup and restore and the Licences screen
  ([Every screen is behind the gate](#every-screen-is-behind-the-gate)). `FlowViewModelsTest` also covers the note that a repair or
  the words after a reset turned the app lock off.
- Catalog's `FirstNeedScreenshotTest`: the four forms of the first-need
  dialog in the four standard configurations.
- Catalog's `AppLockScreensScreenshotTest`: every state of the app lock
  screens in the four standard configurations.
- Catalog's `CatalogScreenTest`: the switch on both pages protects the
  page and takes the protection away again.

What a unit test cannot show: `setRecentsScreenshotEnabled`, the real
prompt, a real keyboard, a real picker, an app that Android stops while
a picker is open, and how a real phone delivers the screen-off
broadcast. Also: that Android really hides other apps' windows and drops
a covered tap, and which accessibility services it lets read a screen,
TalkBack among them.
They are checked on the owner's devices with Water ([emulator-tests.md](../development/emulator-tests.md#what-an-emulator-cannot-check)).

## Open

- The names of the buttons that open these screens in an app, and where
  they are. Set with Water. Named in Water's
  [specification](../apps/water/spec.md#settings-screen): "Recovery key"
  and "App lock" in the Security section of Settings, and the dialog of
  [ADR 0035](../adr/0035-recovery-key-when-first-needed.md) when the key
  is first needed. Closed.
- How an app shows files that were given up (open question 13 of
  crypto-design.md).
- The check that every app that uses these screens requests
  `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`. It is part of the APK
  rules check, with Water's allow list
  ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md),
  point 5). Closed. Water is the first app with these
  screens. Catalog removes both the screens and the permissions
  ([permissions.md](../security/permissions.md#water-appshkriusswater)).
- The lock screen and the app lock screen take their background thread
  from `Dispatchers.IO` themselves. They could take it from
  `AppLockWatcher`, which tests already replace, so that a test would
  not have to wait for it. That changes which thread unlocks in a real
  app, so it is the owner's call. For now, the tests wait for the
  thread ([Tests](#tests)).
