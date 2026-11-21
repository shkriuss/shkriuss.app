# Catalog changelog

Catalog (`app.shkriuss.catalog`) is the design gallery used during
development.

## Unreleased

- **Recovery key screens** show the handover between apps, with the
  sample names Water and Reminders: a keeper's screen when another app
  asks for its keys or to check four words, the four words, a keeper
  that does not keep the key, the screen that gets the keys when it is
  done and when the keys are of another recovery key, the security
  screen with keepers on the phone and kept in another app, and "Keep it
  here too?". **The recovery key when first needed** shows the dialog
  with a keeper, before a backup and before a restore. **App lock
  screens** show turning the app lock on with another app that checks
  the words. Catalog holds no keys and takes no part in a handover: its
  manifest removes the handover screens, the status provider and the
  handover permission.
- Catalog turns off Compose's smart selection before it draws anything,
  as the apps do: a long press in a text field, such as a sample of a
  recovery-word field, no longer hands its text to Android's text
  classifier.
- **Text fields**: the field to try counts characters as you see them.
  An emoji is one, so 20 emoji show no error. What you type there stays
  in memory only: it goes when the phone turns or Catalog closes.
- **Time pickers**: the time chosen under the picker to try shows with
  the phone's 12 or 24-hour setting, as the picker itself does.
- Catalog needs Android 15 or newer
  ([ADR 0040](../../../docs/adr/0040-minimum-android-15.md)).
- **Recovery key when first needed** and **Recovery key screens**: the
  forms that offer **Create a recovery key** say how to use a recovery
  key that another app of the suite already has, as every app does.
- New page **Recovery key when first needed**, in the group of shared
  screens: the dialog an app shows when a backup, a restore or the app
  lock first needs the recovery key, in its four forms
  ([ADR 0035](../../../docs/adr/0035-recovery-key-when-first-needed.md)).
  Water is the first app that shows it. Catalog holds no keys, so the
  buttons do nothing.
- **Dialogs** has two more samples at its end: a dialog with a third
  button, between the way out and the answer, and a progress dialog,
  which only says what the app is doing and has no button
  ([design-system.md](../../../docs/development/design-system.md#optional-parts-for-backup-and-the-recovery-key)).
- **Recovery key screens** and **App lock screens**: the switch is now
  **Protect this page, as in an app**, under the heading **Protection**.
  It does what the screens of `core/security` do in an app
  ([security-screens.md](../../../docs/architecture/security-screens.md#overlays-and-accessibility-services)):
  - Android refuses a screenshot, and the recent apps show Catalog
    blank, as before.
  - A tap where another app's window covers the page does nothing.
  - Only accessibility tools, such as TalkBack, can read the page or act
    on it. A dialog opened from a sample, such as **Give up these
    files**, is protected in the same way.
  - A line under the switch says so. In an app, these screens also hide
    other apps' windows. Catalog cannot: that needs a permission it does
    not have.
- Turning the switch off now takes the protection away at once. Before,
  the page stayed protected until it was closed.
- Permissions: still none. Catalog also removes `HIDE_OVERLAY_WINDOWS`,
  which `core/security` now asks for
  ([ADR 0033](../../../docs/adr/0033-hide-overlay-windows-for-the-security-screens.md)).
- A new page, **Progress bars**, after Sliders: `ShkProgressBar` empty,
  part of the way, full, and past its end, then one to try with **Add
  10%** and **Reset**. TalkBack reads its value in words, such as "62
  percent". The start screen lists 25 pages. Water's summary uses the
  bar (step 2.3).
- Four optional additions to existing components, for Water's screens.
  Each one's default leaves every existing use as it was: with the four
  changes alone, every Catalog screenshot stayed the same. Each has a new
  sample at the end of its component's page:
  - **Dialogs**: a button that checks a value first and keeps the dialog
    open, so the error shows under the field (`closesDialog`). The new
    sample shows such a dialog with its error.
  - **Time pickers**: a time can be refused with a reason (`refuse`).
    The picker stays open, keeps the time typed and shows the reason in
    red, and TalkBack announces it. The new sample shows a refused time.
  - **Text fields**: a unit after the typed text, such as "ml"
    (`suffix`). TalkBack reads the unit in words, such as "millilitres".
  - **Lists**: an icon at the end of a row, after its trailing text
    (`trailingIcon`), such as a check next to "Done". It is decorative.

## 0.3.0 (2026-11-13)

Released as `catalog-v0.3.0`.

The recovery key screens and the app lock screens that every app shares,
drawn with sample data, in a new group on the start screen. From pull
requests [28](https://github.com/shkriuss/shkriuss.app/pull/28) and
[29](https://github.com/shkriuss/shkriuss.app/pull/29). The pages for
the tokens and the components are as in 0.2.0.

Start screen:

- The start screen lists 24 pages in three groups: Tokens, Components
  and Shared screens. Shared screens holds the two pages below.

Shared screens:

- Recovery key screens: every state of the recovery key screens and the
  security screen of `core/security`, 13 in all, with sample words that
  are no real key. Tap a state to see it full window. Back returns to
  the list.
  - The security screen with no recovery key yet; set up and kept, with
    the app lock on and the keys in StrongBox; with no screen lock and
    the keys in software; and with a stopped setup and damaged key
    files, in a preview build.
  - Creating a key: before the words, the 24 words, four words to
    confirm, keeping it on this phone after the prompt was closed, and
    done.
  - Entering a key: the words with suggestions, words that could start
    over, and done after the app lock was turned off.
  - Showing the words again.
  - Two states take typed letters, to try: "Create: four words to
    confirm" and "Enter: the words, with suggestions". Nothing can be
    pasted into them. The third field to confirm starts with "abj", and
    the message under it says that no word starts with these letters.
- App lock screens: every state of the app lock screens, 19 in all,
  with sample data: the lock screen, the app lock screen with its
  dialogs and notices, and turning the app lock on. Catalog has no app
  lock: nothing on the page locks, unlocks or shows the system prompt.
- Both pages have the switch **Block screenshots, as in an app**. It is
  off when the page opens. When it is on, Android refuses a screenshot
  and the recent apps show Catalog blank, as on these screens in an app.

Permissions and version:

- Still no permissions. Catalog removes `USE_BIOMETRIC`, which
  `core/security` asks for, and the six screens of that module. Catalog
  holds no keys and never shows the system prompt. Android backup and
  device-to-device transfer are still off.
- Version code 300900, from the version code rule in
  [ADR 0021](../../../docs/adr/0021-version-names-and-version-codes.md).
  It installs as an update over 0.2.0, which has 200900.

Inside the APK:

- The sample words come from the English word list of the recovery key,
  in `core/crypto`. The list and its MIT licence file are now in the APK
  ([third-party.md](../../../docs/development/third-party.md)). Tink is
  not: Catalog never calls it, and R8 removes it.

## 0.2.0 (2026-11-12)

Released as `catalog-v0.2.0`.

The design tokens and the first components of the design system, each on
a page of its own. From pull requests
[12](https://github.com/shkriuss/shkriuss.app/pull/12) to
[17](https://github.com/shkriuss/shkriuss.app/pull/17).

Start screen:

- The start screen lists 22 pages in two groups: Tokens and Components.
  Tap one to open it. Back returns to the start screen.
- In a window at least 600 dp wide, the start screen and the pages use
  two or three columns.

Tokens:

- Colours shows every colour token with its value, and the contrast of
  every text colour, the outline and the divider on each background. The
  divider has its own colour, a lighter grey than the outline.
- Type shows the six text styles with their sizes and uses.
- Shape shows the four corner shapes. Spacing shows the spacing steps,
  the screen margins and the 48 dp touch target.

Components:

- Buttons: filled, tonal, text and icon buttons, enabled, with an icon,
  disabled and with a long label.
- Floating action buttons: the floating action button, and the extended
  one expanded, collapsed and with a long label.
- Chips: filter chips and assist chips in every state, and three filter
  chips to try.
- Text fields: the text field empty, with text, with help, in error,
  disabled, with several lines and with a long label, and one to try that
  shows its error past 20 characters.
- Selection controls: checkboxes, switches and radio buttons, off, on,
  disabled and with a long label, and a few of each to try.
- Sliders: the slider without steps, with steps, disabled and with a long
  label, and one to try. TalkBack reads its value in words, such as
  "8 glasses".
- Cards: the card that cannot be tapped, alone and with a button, and the
  card that can be tapped, with short and long text.
- Lists: list items with one or two lines, an icon, text at the end,
  tappable, selected, disabled and with long text; section headers, alone
  and above list items; and dividers between list items. A selected list
  item has a short bar in the accent colour before its text, on a light
  fill. TalkBack reads it as selected.
- Empty, loading and error: the empty state with and without an icon and
  a button, the loading state, and the error state with and without a
  button, each also with long text, and an error state to try that turns
  into a loading state and back. TalkBack reads a loading state as its
  text and "in progress". It announces each loading and error state as it
  appears, and the empty state "No results", which answers a search.
- Top bars: the top bar with a title only, with Back, with actions, with
  an action turned off, and with a long title.
- Navigation: the navigation bar and rail, with short and long labels,
  and one to try that is a bar on a phone held upright and a rail on a
  tablet or a phone held sideways.
- List and detail: one pane with the list or a note, two panes in a
  window at least 840 dp wide, and one to try. On a phone, Back and the
  back gesture return from a note to the list. In two panes, the open
  note is selected in the list.
- Dialogs: the dialog with text and two buttons, with one button, with a
  choice, with its confirm button turned off and with long text, and one
  to try that opens over the page.
- Bottom sheets: the sheet with and without a title and with long text,
  and one to try that slides up from the bottom, and slides down again
  when a row is tapped.
- Snackbars: the snackbar with a message only, with an action and with
  long text, and a screen to try whose floating action button shows
  "Note added" with Undo above itself.
- Menus: the menu with text only, with icons, with a row turned off, with
  a row that deletes and with long text, and a top bar to try with a
  "More options" button that opens its menu.
- Date pickers: the date picker with nothing chosen, with a date chosen,
  with an earliest and a latest date, typing the date, and with a long
  title, and one to try. In a window too narrow for the month it offers
  typing the date.
- Time pickers: the time picker with the 12-hour and the 24-hour clock,
  with an impossible time it refuses, and with a long title, and one to
  try that follows the phone's clock setting.

On every page:

- Colours, text and margins come from the design tokens in
  `core/design`.
- At larger font sizes, icons next to text in buttons, chips and the
  extended floating action button grow with the text. So do checkboxes
  and radio buttons. Switches keep their size.
- The text of list items, section headers, checkboxes, switches and radio
  buttons starts at the same edge as the page title. Only the pressed
  highlight reaches a little past it.

Permissions and version:

- Still no permissions. Android backup and device-to-device transfer are
  still off.
- Version code 200900, from the version code rule in
  [ADR 0021](../../../docs/adr/0021-version-names-and-version-codes.md).
  It installs as an update over 0.1.0, which has 100900.

## 0.1.0 (2026-11-11)

Released as `catalog-v0.1.0`.

- First build: one screen that says "Catalog", in a light theme and a
  true-black dark theme that follow the system setting.
- No permissions. Android backup and device-to-device transfer are off.
- A preview build, "Catalog preview" (`app.shkriuss.catalog.preview`),
  installs next to the real app.
- Version code 100900, from the version code rule in
  [ADR 0021](../../../docs/adr/0021-version-names-and-version-codes.md).
  It was 1. No build was released with it.
