# Catalog changelog

Catalog (`app.shkriuss.catalog`) is the design gallery used during
development.

## Unreleased

- The start screen lists four pages: Colours, Type, Shape and Spacing.
  Tap one to open it. Back returns to the start screen.
- Colours shows every colour token with its value, and the contrast of
  every text colour and the outline on each background.
- Type shows the six text styles with their sizes and uses.
- Shape shows the four corner shapes. Spacing shows the spacing steps,
  the screen margins and the 48 dp touch target.
- In a window at least 600 dp wide, pages use two or three columns.
- Colours, text and margins now come from the design tokens in
  `core/design`.
- The start screen lists its pages in two groups: Tokens and Components.
- New page Buttons: filled, tonal, text and icon buttons, enabled, with
  an icon, disabled and with a long label.
- New page Floating action buttons: the floating action button, and the
  extended one expanded, collapsed and with a long label.
- New page Chips: filter chips and assist chips in every state, and three
  filter chips to try.
- At larger font sizes, icons next to text in buttons, chips and the
  extended floating action button grow with the text.
- New page Text fields: the text field empty, with text, with help, in
  error, disabled, with several lines and with a long label, and one to
  try that shows its error past 20 characters.
- New page Selection controls: checkboxes, switches and radio buttons,
  off, on, disabled and with a long label, and a few of each to try.
- New page Sliders: the slider without steps, with steps, disabled and
  with a long label, and one to try. TalkBack reads its value in words,
  such as "8 glasses".
- At larger font sizes, checkboxes and radio buttons grow with the text.
  Switches keep their size.
- New page Cards: the card that cannot be tapped, alone and with a
  button, and the card that can be tapped, with short and long text.
- New page Lists: list items with one or two lines, an icon, text at the
  end, tappable, disabled and with long text; section headers, alone and
  above list items; and dividers between list items.
- New page Empty, loading and error: the empty state with and without an
  icon and a button, the loading state, and the error state with and
  without a button, each also with long text. TalkBack reads a loading
  state as its text and "in progress".
- On Empty, loading and error, an error state to try turns into a
  loading state and back. TalkBack announces each loading and error state
  as it appears, and the empty state "No results", which answers a
  search.
- The text of list items, section headers, checkboxes, switches and
  radio buttons now starts at the same edge as the page title. Only the
  pressed highlight reaches a little past it.
- Dividers are a lighter grey, the new divider colour. Colours lists it,
  with its contrast on each background.
- New page Top bars: the top bar with a title only, with Back, with
  actions, with an action turned off, and with a long title.
- New page Navigation: the navigation bar and rail, with short and long
  labels, and one to try that is a bar on a phone held upright and a rail
  on a tablet or a phone held sideways.
- New page List and detail: one pane with the list or a note, two panes
  in a window at least 840 dp wide, and one to try. On a phone, Back and
  the back gesture return from a note to the list. In two panes, the open
  note is selected in the list.
- Lists shows a selected list item: a short bar in the accent colour
  before its text, on a light fill. TalkBack reads it as selected.
- New page Dialogs: the dialog with text and two buttons, with one
  button, with a choice, with its confirm button turned off and with long
  text, and one to try that opens over the page.
- New page Bottom sheets: the sheet with and without a title and with
  long text, and one to try that slides up from the bottom, and slides
  down again when a row is tapped.
- New page Snackbars: the snackbar with a message only, with an action
  and with long text, and a screen to try whose floating action button
  shows "Note added" with Undo above itself.
- New page Menus: the menu with text only, with icons, with a row turned
  off, with a row that deletes and with long text, and a top bar to try
  with a "More options" button that opens its menu.
- New page Date pickers: the date picker with nothing chosen, with a
  date chosen, with an earliest and a latest date, typing the date, and
  with a long title, and one to try. In a window too narrow for the month
  it offers typing the date.
- New page Time pickers: the time picker with the 12-hour and the
  24-hour clock, with an impossible time it refuses, and with a long
  title, and one to try that follows the phone's clock setting.

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
