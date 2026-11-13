# Catalog changelog

Catalog (`app.shkriuss.catalog`) is the design gallery used during
development.

## Unreleased

- A third group on the start screen, **Shared screens**, with the page
  **Recovery key screens**: every state of the recovery key screens and
  the security screen of `core/security`, with sample words that are no
  real key. Tap a state to see it full window. Back returns to the list.
  A switch blocks screenshots on the page, as the screens do in an app.
- A second page under **Shared screens**, **App lock screens**: the lock
  screen, the app lock screen with its dialogs and notices, and turning
  the app lock on, with sample data. Catalog has no app lock: nothing on
  the page locks, unlocks or shows the system prompt.
- **Recovery key screens**: the security screen shows the app lock, and
  a new state shows the end of entering the words after the app lock
  was turned off.
- Permissions: still none. Catalog removes `USE_BIOMETRIC`, which
  `core/security` asks for, and the six screens of that module. Catalog
  holds no keys and never shows the system prompt.

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
