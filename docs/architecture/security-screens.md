# Recovery key screens and the app lock

The screens of the recovery key, the security screen and the optional
app lock, in `android/core/security`. Every app that holds keys uses
them. They build on `core/crypto` and follow
[crypto-design.md](../security/crypto-design.md), "The recovery key" and
"The app lock".

Built in Phase 1, step 7: the recovery key screens in session A, the
app lock in session B ([The app lock](#the-app-lock)). Step 1.10 added
the protection against other apps
([Overlays and accessibility services](#overlays-and-accessibility-services)).

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
3. It gets the permissions `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`
   and the six screens through the module's manifest
   ([permissions.md](../security/permissions.md#apps-that-use-coresecurity),
   [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md),
   [ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)).

## The screens

Each flow is an activity of its own. None is exported.

| Screen | What it shows |
|---|---|
| `SecurityActivity` | Where the recovery key stands: none, a setup that stopped, or set up with its key ID. Whether this phone keeps it. The screen lock. Each hardware key and where it lives: StrongBox, TEE, secure hardware of an unnamed kind, or software only. A repair notice, and "Give up these files" when a keyset no words can bring back is damaged. |
| `CreateRecoveryKeyActivity` | Before the words; the 24 words; four of them to confirm at positions picked at random; storing; keeping the key with the system prompt; done. With the start-over extra, the new key starts a stopped setup over. |
| `EnterRecoveryKeyActivity` | The 24 words, typed one at a time; the check; storing, which also repairs a damaged keyset; keeping; done. Other words in a stopped setup offer to start over. |
| `ShowRecoveryKeyActivity` | Before the prompt; the words, once per prompt. |
| `AppLockActivity` | The app lock screen ([The app lock](#the-app-lock)). |
| `TurnOnAppLockActivity` | Turning the app lock on: the warning, the words, the prompt. |

Why activities and not screens inside the app's own window:

- The window gets `FLAG_SECURE` and the shield against other apps in
  `onCreate`, before anything is drawn.
- A flow's ViewModel, and the recovery key with it, ends when its
  activity finishes.
- A turn of the phone keeps the key in the ViewModel. It is never in a
  saved state.
- No navigation library is needed. Whether the apps use Navigation 3 is
  still open ([ADR 0003](../adr/0003-kotlin-compose-material-3-navigation-3.md),
  point 2).

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
4. The field's text menu shows nothing. It takes only `a` to `z`, at most
   eight letters, and at most one new letter per change. So a paste never
   lands, also not through the paste action TalkBack offers.
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
   again. The create and enter flows keep the key while stopped, because
   nothing is stored yet and a screen times out while the user writes.
8. A preview build shows a warning on every screen: never type your real
   recovery words into it.
9. Other apps' windows are hidden, a tap under another app's window does
   nothing, and on Android 14 and later only accessibility tools can read
   the screen
   ([Overlays and accessibility services](#overlays-and-accessibility-services)).

## Overlays and accessibility services

Decided by the owner in step 1.10, on 2026-11-13
([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)).
The ADR says what Android 13 to 17 offers, and why these choices.

| Where | Other apps' windows | A tap under another app's window | Accessibility services, Android 14 and later |
|---|---|---|---|
| The six screens | Hidden while the screen shows | Does nothing | Only accessibility tools |
| Their four dialogs | Hidden: the screen behind still shows | Does nothing | Only accessibility tools |
| The lock screen | Hidden while the app is locked | Reaches the screen | Every service |

How it is built, in `WindowShield.kt`:

1. `shieldWindow` sets `filterTouchesWhenObscured` on the window's root
   view. On Android 14 and later it also calls
   `setAccessibilityDataSensitive(YES)` there. Every view below inherits
   both, Compose's own view too.
   - `secureWindow` calls it, so the five screens that show or take the
     words get it with the rest.
   - The app lock screen calls it itself: whether it blocks screenshots
     follows the app's setting.
2. `hideOtherAppsWindows` calls Android's `Window.setHideOverlayWindows`.
   - Each of the six screens calls it in `onCreate`.
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
   - the APK rules check is to check each app from step 2.5
     ([Open](#open)).

What the user sees:

- While one of these screens shows, other apps' floating windows
  disappear: screen dimmers, chat heads, the buttons of other apps'
  screen recorders. They come back after. Android's own windows stay:
  the status bar, the keyboard, TalkBack, notifications and the system
  prompt.
- A tap under another app's window does nothing, and nothing says so.
  With other apps' windows hidden, it hardly ever happens. The user
  guide says to close the app that draws over others.
- On Android 14 and later, only accessibility services that declare
  themselves accessibility tools can read these screens or act on them.
  - An assistive app that does not declare itself an accessibility tool
    cannot read these screens.
  - A harmful service can falsely claim to be a tool
    ([threat model](../security/threat-model.md#out-of-scope)).
  - TalkBack must keep reading them. The owner checks that on the Pixel
    9 Pro with the Catalog preview, before the merge of step 1.10.
- Android 13 has no way to keep a window from accessibility services that
  are not tools. There, every accessibility service the user turned on
  can read these screens.

Not covered, as accepted deviations in the
[threat model](../security/threat-model.md#platform):

1. Android 13: no accessibility marking, as above.
2. The lock screen takes a tap under another app's window and speaks to
   every accessibility service. It shows only the app's name and
   "Unlock", which opens the system prompt. It must stay usable with
   every assistive app.
3. A tap on a screen that another window covers only elsewhere is not
   refused. That would refuse taps whenever a video in
   picture-in-picture overlaps the screen.
4. The other screens of the apps hide no other app's windows. They show
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
4. Its settings open `SecurityScreens.appLockIntent`. The security
   screen has a button for it too.

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
        notify.start()
    }
}

class WaterActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShkTheme { AppLockGate { WaterScreen() } } }
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
   the app was unlocked for the same reason.
6. The watcher reads the keys again whenever a screen of the app starts,
   and after each flow. `core/crypto` is the truth: a keyset write drops
   the keys from memory (for example keeping the recovery key), and the
   next read locks the gate.

The screens of the recovery key are not behind the gate. They show no
records, "Show the words" has its own prompt, and the repair must be
reachable while the app cannot be unlocked.

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
time, the app may still be unlocked. Android 14 and later hold the
screen-off broadcast back while the app waits, `ACTION_SCREEN_OFF`
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
   too.
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
   ignores a tap under another app's window, and on Android 14 and later
   speaks only to accessibility tools. So no other app can steer a tap
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
   back.
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
- Catalog's manifest removes `USE_BIOMETRIC`, `HIDE_OVERLAY_WINDOWS` and
  the six screens. It holds no keys and has no app lock.
- The switch **Protect this page, as in an app** on both pages calls
  `secureWindow`, to try it on a phone. It blocks screenshots and shields
  the page and the dialogs opened from it. It cannot hide other apps'
  windows: Catalog has no permission. It is off by default, so that the
  owner can send screenshots of the page.

## Tests

- `FlowViewModelsTest`: every flow with real cryptography on the
  stand-in for the Keystore, with the prompt answered, closed and gone.
  This includes start over, repair, giving files up and a phone with no
  screen lock.
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
  `HIDE_OVERLAY_WINDOWS`, and its six screens are not exported.
- `WordInputTest`: what a word field accepts and offers, and which
  letters start no word.
- Catalog's `SecurityScreensScreenshotTest`: every state in the eight
  configurations.
- `AppLockWatcherTest`: each timer choice, a turn of the phone, moving
  between the app's own screens, the screen turned off with the app on
  it, a screen-off broadcast in time and late, a watcher that finds no
  keys in memory starting locked, a keyset write that drops the keys,
  the window flags, `hidesNotificationText`, `onTextHidden` and the
  notices. While locked, every screen of the app hides other apps'
  windows, set before the screen starts again. The six screens of the
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
  prompt still reads it, kept through a turn of the phone, and the
  prompt asking again on the way back.
- `AppLockActivitiesTest`: the app lock screen's labels and touch
  targets. `FlowViewModelsTest` also covers the note that a repair or
  the words after a reset turned the app lock off.
- Catalog's `AppLockScreensScreenshotTest`: every state of the app lock
  screens in the eight configurations.
- Catalog's `CatalogScreenTest`: the switch on both pages protects the
  page and takes the protection away again.

What a unit test cannot show: `setRecentsScreenshotEnabled`, the real
prompt, a real keyboard, a real picker, an app that Android stops while
a picker is open, and how a real phone delivers the screen-off
broadcast. Also: that Android really hides other apps' windows and drops
a covered tap, and which accessibility services it lets read a screen.
The owner checks TalkBack with Catalog before the merge of step 1.10. They are checked on the owner's devices with Water ([emulator-tests.md](../development/emulator-tests.md#steps-for-the-three-devices)).

## Open

- The names of the buttons that open these screens in an app, and where
  they are. Set with Water.
- "The recovery key is kept in Water" for an app that is not a keeper.
  It needs the handover between apps (step 3.0).
- A check that every screen of an app puts its content in
  `AppLockGate`. Until then, the gate itself only checks that the
  watcher saw its screen start. Step 2.2 builds the check, before Water's
  first screen in step 2.3: a test that starts every activity of the
  app's merged manifest, except those of `core/security`, with the app
  lock on and locked, and fails unless the lock screen shows and the
  screen's content does not
  ([PROMPTS.md](../development/PROMPTS.md#22-to-25-build-it)).
- How an app shows files that were given up (open question 13 of
  crypto-design.md).
- The check that every app that uses these screens requests
  `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`. Step 2.5 adds it to the APK
  rules check, which is owner-only, with Water's allow list
  ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md),
  point 5). Until then no app uses these screens, and Catalog removes
  both the screens and the permissions.
