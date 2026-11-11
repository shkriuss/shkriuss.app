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
