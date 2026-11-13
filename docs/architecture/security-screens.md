# Recovery key screens

The screens of the recovery key and the security screen, in
`android/core/security`. Every app that holds keys uses them. They build
on `core/crypto` and follow
[crypto-design.md](../security/crypto-design.md), "The recovery key".

Built in Phase 1, step 7, session A. The app lock screens come in
session B.

## What an app does

1. Its app class implements `SecurityHost`: it hands out the app's one
   `ShkCrypto`, built and started when the app starts. Android creates
   the screens itself, so they reach `ShkCrypto` through the app class,
   as `core/notify` reaches `Notify`
   ([ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md)).
2. It opens a screen with an intent from `SecurityScreens`:
   - `securityIntent`: the security screen, from the app's settings.
   - `createIntent`: create a recovery key, for example at the first
     start.
   - `enterIntent`: enter the words of a recovery key the user has.
3. It gets the permission `USE_BIOMETRIC` and the four screens through
   the module's manifest
   ([permissions.md](../security/permissions.md#apps-that-use-coresecurity),
   [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).

## The screens

Each flow is an activity of its own. None is exported.

| Screen | What it shows |
|---|---|
| `SecurityActivity` | Where the recovery key stands: none, a setup that stopped, or set up with its key ID. Whether this phone keeps it. The screen lock. Each hardware key and where it lives: StrongBox, TEE, secure hardware of an unnamed kind, or software only. A repair notice, and "Give up these files" when a keyset no words can bring back is damaged. |
| `CreateRecoveryKeyActivity` | Before the words; the 24 words; four of them to confirm at positions picked at random; storing; keeping the key with the system prompt; done. With the start-over extra, the new key starts a stopped setup over. |
| `EnterRecoveryKeyActivity` | The 24 words, typed one at a time; the check; storing, which also repairs a damaged keyset; keeping; done. Other words in a stopped setup offer to start over. |
| `ShowRecoveryKeyActivity` | Before the prompt; the words, once per prompt. |

Why activities and not screens inside the app's own window:

- The window gets `FLAG_SECURE` in `onCreate`, before anything is drawn.
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
6. Dialogs inherit `FLAG_SECURE` from the screen.
7. The words leave the show screen when it stops: the phone's screen
   turns off or another app comes to the front. A new prompt shows them
   again. The create and enter flows keep the key while stopped, because
   nothing is stored yet and a screen times out while the user writes.
8. A preview build shows a warning on every screen: never type your real
   recovery words into it.

## The system prompt

1. Only `core/security` shows it: Android's own `BiometricPrompt`, a
   strong fingerprint or the phone's PIN, pattern or password.
2. `core/crypto` hands out a `PromptStep`. The screen gives its
   `cryptoObject` to the prompt and never sees the cipher.
3. Success: the step finishes on a background thread. A cancel or an
   error: the step is thrown away, and the screen shows its button again.
4. When the screen goes away, for example when the phone is turned, the
   prompt is cancelled. It never comes back by itself.

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
- Catalog's manifest removes `USE_BIOMETRIC` and the four screens. It
  holds no keys.
- A switch on the page turns the screenshot block on, to try it on a
  phone. It is off by default, so that the owner can send screenshots of
  the page.

## Tests

- `FlowViewModelsTest`: every flow with real cryptography on the
  stand-in for the Keystore, with the prompt answered, closed and gone.
  This includes start over, repair, giving files up and a phone with no
  screen lock.
- `SecurityActivitiesTest`: every screen blocks screenshots and keeps
  autofill and content capture away. A word is typed and picked. Letters
  that start no word are named under the field at once, and the next key
  takes nothing. The list shows only the words entered and the current
  one. A paste never lands. The keyboard gets a password field with no
  suggestions and no learning. Every button has a label and a 48 dp
  target.
- `ConfirmWordsTest`: the four fields that confirm a new key name letters
  that start no word, each under its own field.
- `WordInputTest`: what a word field accepts and offers, and which
  letters start no word.
- Catalog's `SecurityScreensScreenshotTest`: every state in the eight
  configurations.

What a unit test cannot show: `setRecentsScreenshotEnabled`, the real
prompt and a real keyboard. They are checked on the owner's devices with
Water ([emulator-tests.md](../development/emulator-tests.md#steps-for-the-three-devices)).

## Open

- The names of the buttons that open these screens in an app, and where
  they are. Set with Water.
- "The recovery key is kept in Water" for an app that is not a keeper.
  It needs the handover between apps (step 3.0).
- The app lock screens, and the message that a repair turned the app
  lock off (step 1.7, session B).
- How an app shows files that were given up (open question 13 of
  crypto-design.md).
