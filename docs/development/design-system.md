# Design system

The colours, type, shapes and spacing every app uses, the `Shk*`
components built from them, and how both are checked. They live in
`android/core/design`. The tokens were built in Phase 1, step 1. The
decision and its reasons are in
[ADR 0017](../adr/0017-design-system-tokens.md). The components come in
Phase 1, step 2, batch by batch. Five batches are here. Batch 1:
buttons, floating action buttons and chips. Batch 2: the text field,
checkbox, switch, radio button and slider. Batch 3: the card, list item,
divider and section header, and the empty, loading and error states.
Batch 4: the top bar, the navigation bar and rail that switch by window
size, and the list-and-detail scaffold. Batch 5: the dialog, the bottom
sheet, the snackbar, the menu, and the date and time pickers. See
[Components](#components), [Window sizes](#window-sizes) and
[Windows of their own](#windows-of-their-own).

## Rules

1. Draw every screen inside `ShkTheme`.
2. Only `core/design` imports Material 3. Apps and features use the `Shk*`
   components and the tokens below ([CLAUDE.md](../../CLAUDE.md),
   "Architecture rules").
3. Never write a colour, text size, corner radius or spacing value in an
   app or feature. Use a token. If no token fits, ask the owner.
4. No dynamic colour. Every screen has the light theme and the true-black
   dark theme. Both follow the system setting.
5. No shadows. A raised surface is a surface colour plus a 1dp outline,
   in both themes.
6. Text uses `ShkText` and one of the six styles. The system font only.
7. Anything that can be touched is at least 48 by 48 dp.

## What is in `core/design`

| File | What it holds |
|---|---|
| `ShkTheme.kt` | `ShkTheme`, the theme every screen is drawn in, and `ShkTheme.colors`. It also sets up Material 3 from the tokens. |
| `ShkColors.kt` | `ShkColors`, the colour tokens, and their light and dark values. |
| `ShkText.kt` | `ShkText` and `ShkTextStyle`, the six text styles. |
| `ShkShapes.kt` | `ShkShapes`, the four shapes. |
| `ShkSpacing.kt` | `ShkSpacing`, the spacing steps, screen margins and the touch target. |
| `ShkContrast.kt` | `contrastRatio`, the WCAG contrast formula. |
| `ShkScreen.kt` | `ShkScreen`, one screen: its background, its top bar, its content in the screen margins, clear of the system bars, its floating action button and its snackbars. |
| `ShkWindowWidth.kt` | `ShkWindowWidth`, the three window widths the layouts switch at, and `ShkWindowWidth.current`, the width of the app's window. |
| `ShkTopBar.kt` | `ShkTopBar` and `ShkTopBarAction`, the bar at the top of a screen and one action in it. The bar's menu of more options is a `ShkMenu`. |
| `ShkNavigation.kt` | `ShkNavigationScaffold` and `ShkDestination`: the navigation bar or rail, by window width, and one place in it. |
| `ShkListDetailScaffold.kt` | `ShkListDetailScaffold`, a list and the detail of one item, in one pane or two, by window width. |
| `ShkButtons.kt` | `ShkFilledButton`, `ShkTonalButton`, `ShkTextButton` and `ShkIconButton`. |
| `ShkFloatingActionButton.kt` | `ShkFloatingActionButton` and `ShkExtendedFloatingActionButton`. |
| `ShkChips.kt` | `ShkFilterChip` and `ShkAssistChip`. |
| `ShkTextField.kt` | `ShkTextField`, and `TextFieldInStyle`, the same field with typed text in another style, for the time picker. The second is internal to `core/design`. |
| `ShkSelectionControls.kt` | `ShkCheckbox`, `ShkSwitch`, `ShkRadioButton` and `ShkRadioGroup`. |
| `ShkSlider.kt` | `ShkSlider`. |
| `ShkCard.kt` | `ShkCard`, with and without `onClick`. |
| `ShkLists.kt` | `ShkListItem`, `ShkDivider` and `ShkSectionHeader`. |
| `ShkContentStates.kt` | `ShkEmptyState`, `ShkLoadingState`, `ShkErrorState`, and `ShkStateAction`, the button of a state. |
| `ShkDialog.kt` | `ShkDialog` and `ShkDialogAction`, a question in a window and one of its buttons. `DialogPanel` and `DialogButtons`, the panel and the buttons of every dialog, the pickers included, are internal to `core/design`. |
| `ShkBottomSheet.kt` | `ShkBottomSheet`. |
| `ShkSnackbar.kt` | `ShkSnackbarHostState`, `rememberShkSnackbarHostState` and `ShkSnackbarResult`. `ShkScreen` shows the snackbars. |
| `ShkMenu.kt` | `ShkMenu` and `ShkMenuItem`. |
| `ShkDatePicker.kt` | `ShkDatePicker`. |
| `ShkTimePicker.kt` | `ShkTimePicker`, and `TimeFields`, the rules of its fields, internal to `core/design`. |
| `ShkInPlace.kt` | `ShkInPlace`, the opt-in that marks the functions that draw a dialog, a sheet, a snackbar, a menu or a picker in place on a page. Only the Catalog uses them. See [Windows of their own](#windows-of-their-own). |
| `ShkRows.kt` | `shkRow`, the layout of every row that is one touch target: a list item and the row of a checkbox, switch or radio button. Internal to `core/design`. |
| `ShkIconSize.kt` | `iconSizeNextToText`, the size of an icon next to text at the user's font size. Internal to `core/design`. |
| `res/drawable/shk_icon_check.xml` | The check mark on a selected filter chip and on the thumb of a switch that is on. |
| `res/drawable/shk_icon_error.xml` | The circle with an exclamation mark at the top of an error state. |
| `res/drawable/shk_icon_back.xml` | The arrow of the Back button in a top bar. It points the other way in right-to-left languages. |
| `res/drawable/shk_icon_more.xml` | The three dots of the "More options" button in a top bar. |
| `res/values/strings.xml` | The words `core/design` shows or TalkBack reads: "Back", "More options", "Drag handle", the labels, help and errors of the time picker, "Cancel" and "OK" of the pickers, and "No date chosen". |

## Colour

Read colours with `ShkTheme.colors`, for example
`ShkTheme.colors.accent`. The value follows the theme in use.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FFFFFF` | `#000000` | Behind everything on a screen. |
| `surface` | `#F3F4F2` | `#0D0E0E` | Cards and grouped content on the background. |
| `surfaceHigh` | `#E7E9E6` | `#191B1A` | Content on a surface, or that must stand out more: sheets, dialogs, menus. |
| `text` | `#131514` | `#ECEEEC` | Normal text and icons. |
| `textSecondary` | `#4A4F4C` | `#A9AEAA` | Less important text: hints, captions, secondary lines. |
| `outline` | `#7A807C` | `#6F7571` | Borders of raised surfaces, fields and other controls. Never text. |
| `divider` | `#B8BCB9` | `#3B3F3D` | Lines that only separate content, such as a divider between list items. Lighter than the outline. Never text, never the border of a control. |
| `accent` | `#00695C` | `#5FD6C2` | Main actions, selection, links and focus. |
| `textOnAccent` | `#FFFFFF` | `#00201B` | Text and icons on a filled accent area. |
| `error` | `#B3261E` | `#FFB4AB` | Errors and destructive actions. |
| `success` | `#1B6E3C` | `#7FDB9A` | Something worked or is in a good state. |
| `warning` | `#7A5800` | `#F2C24B` | Something needs attention but is not an error. |

The values are from ADR 0017. The "Use" column is the starting guidance;
the component batches in Phase 1, step 2 may refine it.

The owner confirmed the teal accent as it is, with Catalog 0.2.0 on the
Pixel 9 Pro, the Pixel Tablet and the Pixel 6a on 2026-11-12, at the
Phase 1 gate ([ADR 0017](../adr/0017-design-system-tokens.md), point 1).

### Which colours may be text, and on what

- Text colours: `text`, `textSecondary`, `accent`, `error`, `success`,
  `warning`. Each may be used on `background`, `surface` and `surfaceHigh`.
- `textOnAccent` is only for text on `accent`.
- `outline` is never text. It needs 3:1 against the three backgrounds.
- `divider` is never text, and never the border of a control. It is
  decorative, so WCAG asks no contrast of it. It needs at least 1.5:1
  against the three backgrounds, so it stays visible, and less than the
  outline, so it stays quieter (owner decision on pull request 15,
  [ADR 0017](../adr/0017-design-system-tokens.md), point 13).
- Status colours are for text and icons. Where Material 3 fills an area
  with the error colour, its text is the background colour: 6.54:1 in the
  light theme, 12.37:1 in the dark theme.

The lowest text pair is `success` on `surfaceHigh` in the light theme,
5.15:1. The lowest outline pair is `outline` on `surfaceHigh` in the light
theme, 3.30:1. The lowest divider pair is `divider` on `surfaceHigh` in
the light theme, 1.57:1. The Catalog's Colours page shows every pair with
its contrast.

## Type

Six styles, all in the system font. The owner confirmed them as they are,
with Catalog 0.2.0 on the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a
on 2026-11-12, at the Phase 1 gate
([ADR 0017](../adr/0017-design-system-tokens.md), point 6).

Use them through `ShkText`:

```kotlin
ShkText(text = stringResource(R.string.title), style = ShkTextStyle.Headline)
```

| Style | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `Headline` | 24 sp | 32 sp | Regular | The title at the top of a screen. |
| `Title` | 20 sp | 28 sp | Regular | The title of a dialog, a sheet or a large section. |
| `Subtitle` | 16 sp | 24 sp | Medium | The heading of a group, or the main line of a list item. |
| `Body` | 14 sp | 20 sp | Regular | Normal text. The default. |
| `Label` | 14 sp | 20 sp | Medium | Text on buttons, chips and tabs. |
| `Caption` | 12 sp | 16 sp | Regular | Small notes, such as a time or a count. |

- Sizes are in sp, so text grows with the user's font size. Android 14 and
  later grow large text less than small text, so at font scale 2.0 the
  headline grows by about 1.5 times.
- Letter spacing is 0. Extra line height is shared evenly above and below
  the text, as in Material 3.
- `ShkText` uses the current content colour. Pass `color` to pick another
  token, for example `ShkTheme.colors.textSecondary`.

## Shape

| Token | Corners | Use |
|---|---|---|
| `ShkShapes.Pill` | Fully rounded ends | Buttons and chips. |
| `ShkShapes.Field` | 12 dp (`FieldCorner`) | Text fields and other inputs. |
| `ShkShapes.Card` | 16 dp (`CardCorner`) | Cards and other raised surfaces. |
| `ShkShapes.Sheet` | 28 dp (`SheetCorner`) | Bottom sheets and dialogs. |

Buttons and chips are pills at their normal height of one line. When
large text wraps them onto more lines, their corners keep the radius of
one line: 20 dp for buttons, 16 dp for chips. A fully rounded end on a
taller button would cut off the corners of the text. This is what "pill
buttons" means in ADR 0017, point 3 (owner decision on
[pull request 13](https://github.com/shkriuss/shkriuss.app/pull/13)).
See [Large text](#large-text).

The floating action buttons use `ShkShapes.Card`, 16 dp corners, as
Material 3 does (owner decision on pull request 13).

## Spacing

Compact density on a 4dp grid. Spacing does not change with the font
size; text does.

| Token | Size | Use |
|---|---|---|
| `ShkSpacing.ExtraSmall` | 4 dp | Between an icon and its label, or lines that belong together. |
| `ShkSpacing.Small` | 8 dp | Between items in a group. |
| `ShkSpacing.Medium` | 12 dp | Inside small controls, and between related groups. |
| `ShkSpacing.Large` | 16 dp | Inside cards and list items. |
| `ShkSpacing.ExtraLarge` | 24 dp | Between sections of a screen. |
| `ShkSpacing.MinTouchTarget` | 48 dp | The smallest width and height of anything that can be touched. |

Screen margins:

- `ShkSpacing.ScreenMargin`, 16 dp, in a window narrower than 600 dp: a
  phone held upright.
- `ShkSpacing.ScreenMarginWide`, 24 dp, in a window at least 600 dp wide
  (`ShkSpacing.WideWindowWidth`): a tablet, an open foldable, or a phone
  held sideways. 600 dp is where Android's medium window size class
  starts.
- `ShkSpacing.screenMargin(windowWidth)` picks the right one. `ShkScreen`
  uses it.

## Window sizes

Layouts adapt by window size class (CLAUDE.md, "UI and accessibility").
`ShkWindowWidth` holds Android's three classes for width. They are the
window's width, not the screen's: a split screen or a resized window
counts.

| Class | Width | Devices | Navigation | List and detail |
|---|---|---|---|---|
| `Compact` | under 600 dp | A phone held upright. | Bar along the bottom | One pane |
| `Medium` | 600 to 839 dp | A tablet held upright, an open foldable. | Rail along the start edge | One pane |
| `Expanded` | 840 dp and wider | A tablet or a phone held sideways. | Rail along the start edge | Two panes |

- 600 dp is `ShkSpacing.WideWindowWidth`, where the wide screen margin
  starts too. 840 dp is `ShkWindowWidth.ExpandedMinWidth`.
- `ShkWindowWidth.current` is the class of the app's window. It changes
  when the phone turns, a foldable opens or the window is resized.
- The navigation and the list and detail switch at the same widths as
  Material 3's adaptive layouts.
- A screen's margin follows the width the screen is given. In one pane
  of two, the pane is the screen. So a 360 dp list pane has the narrow
  margin, beside a detail pane with the wide one.
- Each part keeps clear of the system bars and the camera cut-out on its
  own side only. The bar keeps clear of the bottom, the rail of the start
  side, a top bar of the top, and each pane of its own side. So nothing
  is padded twice.
- When the window changes class, the content keeps its state: the screen
  inside the navigation, and the list and the open detail. The list also
  keeps its scroll position while the detail covers it in one pane.

The suite builds these layouts itself, from Material 3's own parts and
Compose. It does not use Material 3's adaptive libraries
(`material3-adaptive`, `material3-adaptive-navigation-suite` and
`material3-window-size-class`), because fewer dependencies is a goal of
the project (owner decision on pull request 16). Why, what that leaves
out, such as support for the hinge of a foldable, and when to look again
are in [ADR 0024](../adr/0024-own-adaptive-layouts.md).

## How Material 3 is set up

The `Shk*` components are built on Material 3. `ShkTheme` sets up
Material 3 so that it can only use the suite's tokens. Apps never see
this.

### Colour roles

Every one of Material 3's 48 colour roles is set to a token of the same
theme. Material's constructor has no defaults, so a role added by a
Material 3 update stops the build until it is mapped.

| Material 3 roles | Token |
|---|---|
| `primary`, `primaryContainer`, `secondary`, `tertiary`, and all six `*Fixed` and `*FixedDim` roles | `accent` |
| `onPrimary`, `onPrimaryContainer`, `onSecondary`, `onTertiary`, and all `on*Fixed` and `on*FixedVariant` roles | `textOnAccent` |
| `secondaryContainer`, `tertiaryContainer`, `errorContainer`, `surfaceVariant`, `surfaceContainerHigh`, `surfaceContainerHighest` | `surfaceHigh` |
| `surfaceContainer`, `surfaceContainerLow` | `surface` |
| `background`, `surface`, `surfaceContainerLowest`, `surfaceTint`, `onError`, `inverseOnSurface` | `background` |
| `onBackground`, `onSurface`, `onSecondaryContainer`, `onTertiaryContainer`, `inverseSurface` | `text` |
| `onSurfaceVariant` | `textSecondary` |
| `outline`, `outlineVariant` | `outline` |
| `error`, `onErrorContainer` | `error` |
| `inversePrimary` | The other theme's `accent` |
| `surfaceDim` | Light: `surfaceHigh`. Dark: `background`. |
| `surfaceBright` | Light: `background`. Dark: `surfaceHigh`. |
| `scrim` | Black |

The `divider` token has no Material 3 role. Material 3 draws dividers in
its "outline variant" role, but also the borders of chips, outlined
buttons and outlined icon buttons, which need 3:1. So that role stays
the outline, and only `ShkDivider` uses the divider colour.

`surfaceTint` is the background, so Material 3's tonal elevation changes
no colour. Raised surfaces use a surface token and an outline instead.

### Text styles

| Material 3 styles | Suite style |
|---|---|
| `display*`, `headline*` | `Headline` |
| `titleLarge` | `Title` |
| `titleMedium` | `Subtitle` |
| `titleSmall`, `labelLarge` | `Label` |
| `bodyLarge`, `bodyMedium` | `Body` |
| `bodySmall`, `labelMedium`, `labelSmall` | `Caption` |

So a Material 3 text field uses `Body`, 14 sp, not Material's 16 sp.

### Shapes

| Material 3 size | Suite shape |
|---|---|
| `extraSmall`, `small` | `Field`, 12 dp |
| `medium`, `large` | `Card`, 16 dp |
| `extraLarge` | `Sheet`, 28 dp |

Components set their shape themselves; this mapping is the fallback.
Buttons and chips use the pill described under [Shape](#shape), the
floating action buttons and cards `ShkShapes.Card`. The text field's box
and the pressed state of a checkbox, switch or radio button row, or of a
list item, use `ShkShapes.Field`.

## Components

Batches 1 to 5 of Phase 1, step 2. Each component is one function in
`core/design`, built on Material 3. Apps call these, never Material 3.
`ShkListItem`, `ShkSectionHeader` and the three states are laid out by
`core/design` itself, from Material 3's text, icons, pressed state,
progress circle and tonal button. That way the text of list items and
section headers lines up with the rest of the screen, as the rows of
batch 2 do (see [Rows](#rows)).

The parts of batch 4 are laid out by `core/design` itself too, from
Material 3's text, icons, icon buttons and pressed state. Material 3's
small top app bar is made for one line of title at a fixed height, and a
title that wraps at font scale 2.0 needs the bar to grow. The bar and the
rail are laid out here so that their icons grow with the text, as the
icon rule asks, and the rail grows with its labels.

### Which one to use

| Component | Use it for | Not for |
|---|---|---|
| `ShkFilledButton` | The main action of a screen, such as "Save". At most one on a screen. | Every action. Too many filled buttons and none stands out. |
| `ShkTonalButton` | An action that matters, but less than the main one, such as "Share" next to "Save". | Sheets and dialogs. They are already `surfaceHigh`, so its fill would not show. Use a text button there. |
| `ShkTextButton` | Actions in dialogs and sheets ("Cancel", "Delete"), in cards and lists, and the less common action next to a filled button. | The main action of a screen. |
| `ShkIconButton` | A common action whose icon is clear on its own, such as search in a top bar. | An action whose icon needs explaining. Use a button with text. |
| `ShkFloatingActionButton` | The one positive action a screen is for, such as adding a note. It floats in the bottom end corner. | Delete, or a second action on the same screen. |
| `ShkExtendedFloatingActionButton` | The same, with text, when the icon alone is not clear. It can collapse to its icon while a list scrolls (`expanded = false`). | The same as above. |
| `ShkFilterChip` | Turning a filter on or off, such as "Done" above a list of tasks. Several sit in a group. | Actions. Use an assist chip or a button. |
| `ShkAssistChip` | A small, optional action related to the content near it, such as "Add a reminder" under a task. | The main action. Use a button. |
| `ShkTextField` | Typing text, such as a name, an amount or a short note. | Choosing from a few fixed options. Use radio buttons. |
| `ShkCheckbox` | An option in a form that is saved later, such as "Remind me" in a new task. Several in a group can each be on. | A setting that takes effect at once. Use a switch. |
| `ShkSwitch` | A setting that takes effect as soon as it changes, such as "Daily reminder" on a settings screen. | An option in a form that is saved later. Use a checkbox. |
| `ShkRadioButton` | One choice out of a few that are all shown, such as the unit "Millilitres" or "Ounces". Put them in a `ShkRadioGroup`. | More than about six options, or options that change. Use a list. |
| `ShkSlider` | A value in a range where the exact number matters less than where it sits, such as a daily goal. | A value that must be exact. Use a text field. |
| `ShkCard` | One item set apart from the things around it, such as a note in a list of notes. Give it `onClick` when tapping it opens the item. | Rows of things that look alike. Use list items. |
| `ShkListItem` | One row in a list of things that look alike, such as tasks, settings or files. Give it `onClick` when tapping it opens or changes something, and `selected` when it is the item open beside the list. | A setting that turns on and off. Use a switch. |
| `ShkSectionHeader` | The heading of a group on a screen, such as "Today" above a list of tasks. | The title of a screen. Each screen has one title. |
| `ShkDivider` | A line between groups, where space alone does not show where one ends. | Between every two list items. Most lists need no line. |
| `ShkEmptyState` | What a screen or list shows when it has nothing yet, such as "No notes yet", or no results. | Content that is still loading. |
| `ShkLoadingState` | What a screen or list shows while its content is on its way, when the wait is long enough to notice. | A short wait. Show nothing; a flash of it is worse. |
| `ShkErrorState` | What a screen or list shows when its content could not be shown, such as "Could not open the backup". | A wrong value the user typed. Use the text field's error. |
| `ShkScreen` | Every screen: its background, its top bar, and its content in the margins. | Part of a screen. |
| `ShkTopBar` | The top of every screen: its title, Back when it was opened from another screen, and up to three actions for the whole screen, such as search. Pass it as the `topBar` of `ShkScreen`. | An action that needs words. Use a button in the content. |
| `ShkNavigationScaffold` | Switching between the three to five main places of an app, such as Today, History and Settings. It wraps all of the app's screens. | Going deeper, from a list to one item. Use `ShkListDetailScaffold` and Back. An app with one place needs none. |
| `ShkListDetailScaffold` | A list and one item from it, such as notes and the open note. | A list whose items do not open. Use list items on a `ShkScreen`. |
| `ShkDialog` | A question to answer before going on, such as "Delete this note?" before something that cannot be undone. | News that needs no answer: use a snackbar. More than a few choices or fields: use a sheet or a screen. |
| `ShkBottomSheet` | A few actions or a short form about what is on the screen, such as what to do with a note. Actions that need a second line of text. | A question that needs an answer: use a dialog. A few short actions: a menu is lighter. |
| Snackbar (`ShkSnackbarHostState`) | A short message about something that just happened, with at most one action, such as "Note deleted" with Undo. | Something that went wrong with what a screen shows: use an error state. A question: use a dialog. Anything that must not be missed: it goes away by itself. |
| `ShkMenu` | A short list of actions that opens from a button, such as Rename and Delete behind "More options" in a top bar (`menuItems`). | More than about six actions, or actions that need a second line: use a sheet. The main action of a screen. |
| `ShkDatePicker` | Choosing one day, such as when a task is due. | A range of days. It picks one. |
| `ShkTimePicker` | Choosing a time of day, such as when a reminder rings. | A length of time, such as 20 minutes: use a text field or a slider. |

Material 3 also has input chips (a removable tag) and suggestion chips.
They are built when the first app needs them, not before (owner
decision on pull request 13).

Batch 2 leaves out these parts of Material 3: the checkbox with a third,
mixed state, the range slider and the vertical slider, and text field
icons, prefixes, suffixes and placeholders. They are built when the first
app needs them, not before (owner decision on pull request 14).

Batch 3 leaves out, in the same way: the elevated and the filled card, a
card that can be selected, a list item with a third "overline" line or
with an image, a control or an icon button at the end of a list item, the
vertical divider, and a progress circle that shows how far it has got.
A row with a switch at its end is a `ShkSwitch`.

Batch 4 leaves out: Material 3's medium and large top bars, a top bar
that shrinks or changes colour while the content scrolls, badges on
destinations, a disabled destination, the navigation drawer, moving or
animating between panes, and panes the user can resize. They are built
when the first app needs them. The menu of more actions it left out came
with batch 5, as `menuItems` of `ShkTopBar`. Where the floating action
button goes in these layouts was left to batch 5, together with the
snackbar (owner decision on pull request 16). Batch 5 answers it; see
[Floating action button and snackbar](#floating-action-button-and-snackbar).

Batch 5 leaves out, until an app needs them: Material 3's full-screen
dialog, the date range picker, a sheet with a half-open step or one that
stays on the screen without dimming it, a snackbar that stays until it is
closed or has a close button, and menus with sub-menus, rows that can be
checked, dividers or text at the end of a row.

Batch 5 builds the time picker from the suite's own parts, not from
Material 3's (owner decision while batch 5 was built). Material 3's AM
and PM buttons are 40 dp tall, under the 48 dp of rule 7, and the touch
targets of the numbers on its clock face lie on top of each other, most
of all in the two rings of the 24-hour clock. The suite's time picker has
a field for the hour and one for the minute, with large numbers and the
number keyboard, and AM and PM as radio buttons, only with the 12-hour
clock. It has no clock face. This record is enough; the decision needs no
ADR (owner decision on pull request 17).

Batch 4 adds one state to a component of batch 3: a list item can be
selected (owner decision on pull request 16). See
[How they look](#how-they-look).

### How they look

| Component | Fill | Text and icon | Outline | Shape | Drawn size |
|---|---|---|---|---|---|
| Filled button | `accent` | `textOnAccent` | None | Pill, 20 dp | 40 dp tall |
| Tonal button | `surfaceHigh` | `text` | None | Pill, 20 dp | 40 dp tall |
| Text button | None | `accent` | None | Pill, 20 dp | 40 dp tall |
| Icon button | None | The current content colour | None | Circle | 40 by 40 dp |
| Floating action button | `accent` | `textOnAccent` | None | `Card`, 16 dp | 56 by 56 dp |
| Extended floating action button | `accent` | `textOnAccent` | None | `Card`, 16 dp | 56 dp tall |
| Filter chip, not selected | None | `text` | `outline` | Pill, 16 dp | 32 dp tall |
| Filter chip, selected | `accent` | `textOnAccent`, with a check mark | None | Pill, 16 dp | 32 dp tall |
| Assist chip | None | `text`, icon in `accent` | `outline` | Pill, 16 dp | 32 dp tall |

The inputs of batch 2:

| Component | Off, or not focused | On, selected or focused | Shape | Drawn size |
|---|---|---|---|---|
| Text field | Box outlined in `outline`, 1 dp. Label above and help under in `textSecondary`. Text in `text`. | Box outlined in `accent`, 2 dp, and label in `accent`. In error, the box, the label and the line under the box are `error`. | `Field`, 12 dp | Box 56 dp tall at one line, with the label above it and the help under it |
| Checkbox | Box outlined in `textSecondary` | Box filled with `accent`, check mark in `textOnAccent` | Square, 2 dp corners | 20 dp box, in a row at least 48 dp tall. It grows with the font size. |
| Switch | Track `surfaceHigh`, outlined in `outline`. Thumb `outline`. | Track `accent`. Thumb `textOnAccent`, with a check mark in `accent`. | Fully round | 52 by 32 dp, at the end of a row at least 48 dp tall |
| Radio button | Ring in `textSecondary` | Ring and dot in `accent` | Circle | 20 dp, in a row at least 48 dp tall. It grows with the font size. |
| Slider | Track after the thumb in `outline`, its step marks in `background` | Track before the thumb, and the thumb, in `accent`. Its step marks in `textOnAccent`. | Rounded track | Track 16 dp tall, thumb 4 by 44 dp |

The parts of batch 3:

| Component | Fill | Text and icon | Outline | Shape | Size |
|---|---|---|---|---|---|
| Card | `surface` | `text`, unless the content picks another | `outline`, 1 dp | `Card`, 16 dp | Fills the width. Content 16 dp in from the edges. |
| List item | None. Selected: `surfaceHigh`, with a bar in `accent` at its start edge. | Main line `text` in `Subtitle`. Second line `textSecondary` in `Body`. Text at the end `textSecondary` in `Caption`. Icon `textSecondary`. | None | Pressed and selected: `Field`, 12 dp. The bar: 4 dp wide, rounded ends. | Fills the width, at least 48 dp tall. Content at the edges; touch target, pressed state and selected mark 8 dp past them. See [Rows](#rows). |
| Section header | None | `accent`, in `Subtitle` | None | None | Fills the width. 24 dp above, 8 dp below. Text at the start edge. |
| Divider | `divider` | None | None | None | 1 dp tall, fills the width. |
| Empty state | None | Title `text` in `Title`, centred. Body `textSecondary` in `Body`, centred. Icon `textSecondary`. A tonal button. | None | None | Fills the width, 24 dp above and below. Icon 48 dp. |
| Loading state | None | A turning circle in `accent`, 4 dp wide. Text `textSecondary` in `Body`, centred. | None | Circle | Circle 40 dp. Fills the width, 24 dp above and below. |
| Error state | None | As the empty state, with the suite's error icon in `error`. | None | None | As the empty state. |

The parts of batch 4:

| Component | Fill | Text and icon | Line | Shape | Size |
|---|---|---|---|---|---|
| Top bar | None: it is part of the screen | Title `text` in `Headline`. Icons `text`. | None | None | Fills the width, at least 64 dp tall. Title at the screen margin; the icons of Back and of the last action on the margins. |
| Navigation bar | `surface` | Label `textSecondary` in `Label`, centred under the icon. Icon `textSecondary`. | `divider`, 1 dp, along its top | None | Fills the width. Destinations side by side, each as wide as the others. 80 dp tall at font scale 1.0. |
| Navigation rail | `surface` | As the bar | `divider`, 1 dp, along its end | None | Fills the height. 80 dp wide at font scale 1.0. Destinations from the top, 4 dp apart. |
| Selected destination | Pill in `accent` behind the icon | Label `text`. Icon `textOnAccent`. | None | Pill, 56 by 32 dp at font scale 1.0 | As the others |
| List and detail, two panes | None: each pane is a screen | None | `divider`, 1 dp, between the panes | None | List pane 360 dp wide, the detail the rest. |

The parts of batch 5:

| Component | Fill | Text and icon | Line | Shape | Size |
|---|---|---|---|---|---|
| Dialog | `surfaceHigh` | Title `text` in `Title`. Text `textSecondary` in `Body`. Buttons are text buttons in `accent`, or `error` for one that deletes. | `outline`, 1 dp, all round | `Sheet`, 28 dp | 280 to 560 dp wide, 24 dp padding, at least 16 dp from the edges of the window. |
| Bottom sheet | `surfaceHigh` | Title `text` in `Title`. The handle is a bar in `outline`, 32 by 4 dp. | `outline`, 1 dp, along the top and down the sides | `Sheet`, 28 dp, at the top only | Fills the width, at most 640 dp, in the middle. As tall as its content, at most the window. Content at the screen margin. |
| Snackbar | `text` (Material 3's inverse surface) | Message `background` in `Body`. The action is a text button in the other theme's `accent`. | None | `Field`, 12 dp | Fills the width inside the screen margins, at most 600 dp, in the middle. At least 48 dp tall. |
| Menu | `surfaceHigh` | Rows `text` in `Label`, icons `textSecondary`. A row that deletes is `error`. | `outline`, 1 dp | `Card`, 16 dp | As wide as its widest row, 112 to 280 dp. Rows at least 48 dp tall. |
| Date picker | `surfaceHigh`, as a dialog | Title `textSecondary` in `Label`. The chosen date `text` in `Headline`. Days `text`; the chosen day `textOnAccent` on a circle in `accent`; today ringed in `accent`. | As a dialog, and a line in `divider` under the date | `Sheet`, 28 dp | 360 dp wide, the width Material 3's month needs. |
| Time picker | `surfaceHigh`, as a dialog | Title `text` in `Title`. The hour and the minute `text` in `Headline`, in text fields. AM and PM are radio buttons. | As a dialog | `Sheet`, 28 dp | 280 to 560 dp wide. |

- Every pair in the five tables is one the contrast tests already check,
  except the dot at the end of a slider's track (below). The snackbar's
  pairs are Material 3's inverse roles: "inverseOnSurface on
  inverseSurface" and "inversePrimary on inverseSurface" in
  `ShkThemeMaterialTest`.
- No component has a shadow, in any state. Material 3's elevation is
  turned off, also for a mouse hovering and a chip being dragged
  (ADR 0017, point 5).
- A text field's label sits above its box, never in its border. Material
  3 puts the label in the border once the field has text, and it keeps
  room there for one short line only. A label that wraps at a large font
  size would stick out above the field and cover what is there.
  Material 3 1.4 offers a label above only for its newer field that
  takes a `TextFieldState`. `ShkTextField` takes a `String` and
  `onValueChange` instead, which fits the one immutable state a view
  model exposes (CLAUDE.md, "Architecture rules"). It draws the label
  above the box itself, inset 4 dp, in `Caption`, as Material 3 does
  (owner decision on pull request 14).
- The box of a checkbox and the ring of a radio button that are off are
  `textSecondary`, as in Material 3. That is stronger than the outline
  (8.35:1 against 4.03:1 on the light background), because they are small
  and thin.
- Material 3 draws the check mark on a switch's thumb in its "on primary
  container" colour. This theme maps that role to `textOnAccent`, the
  thumb's own colour, so the mark would not show. `ShkSwitch` draws it in
  `accent`.
- The track after a slider's thumb is `outline` (owner decision on pull
  request 14). Material 3 uses the higher surface colour there, which is
  1.22:1 on the background. WCAG asks for 3:1 for the parts of a control,
  and the outline is at least 3.30:1 on all three backgrounds. The step
  marks on it are the background colour, so they stand out from the
  track by the same pair.
- Material 3 marks the end of a slider's track with a dot in the accent.
  On the outline it is 1.64:1 in the light theme and 2.67:1 in the dark
  one. It repeats what the track already shows, where the range ends.
- A selected filter chip is filled with the accent colour, because the
  accent is the colour of selection (owner decision on pull request 13).
  Material 3's default, the higher surface colour, is hard to tell from
  not selected. It also shows a check mark, so the state does not depend
  on colour alone.
- A card is drawn the way every raised surface is: the surface colour
  and a 1 dp outline, no shadow (rule 5 and ADR 0017, point 5). It is
  Material 3's outlined card, with its shadow turned off in every state,
  also while it is dragged.
- The main line of a list item and a section header both use `Subtitle`,
  as the type table says. The section header is in the accent colour, so
  it does not look like the first list item under it (owner decision on
  pull request 15). Android's own settings draw their group headings in
  the accent colour too.
- A list item's icon takes as much space as a checkbox, with the same gap
  to its text, so their text lines up.
- A divider is the `divider` colour, lighter than the outline of a
  control, because it is decorative (owner decision on pull request 15).
  See [Colour](#colour).
- The text of the states is centred, because it stands alone in the
  middle of a screen. Text everywhere else starts at the start edge.
- The title of a top bar is in `Headline`, because the type table makes
  that the style of a screen's title (owner decision on pull request 16).
  Material 3's small top app bar uses its "title large" style, which
  this theme maps to `Title`.
- A top bar's title starts at the screen margin, where the content under
  it starts. The icons of the Back button and of the last action sit on
  the margins; only their touch targets reach past them, as those of
  rows do ([Rows](#rows)). Beside a button, the title starts where the
  button's touch target ends, 12 dp from its icon, the gap between a list
  item's icon and its text.
- The selected destination's icon sits on a pill in the accent colour,
  because the accent is the colour of selection, as on a selected filter
  chip (owner decisions on pull requests 13 and 16). Material 3's default, the
  higher surface colour, is 1.11:1 on the bar's surface in the light
  theme, and hard to tell from not selected. The accent pill is 5.99:1
  there, and 10.94:1 in the dark theme. The pill is there or not, so the
  choice does not rely on colour alone.
- The bar and the rail are the surface colour, with a line in the
  divider colour on the side of the content (owner decision on pull
  request 16). In the dark theme the surface is close to black, so the
  line is what sets them apart. The line only separates, so it is the
  divider colour, as between two panes.
- The list pane is 360 dp wide, as in Material 3's list and detail (owner
  decision on pull request 16). That is about the width of a phone, so a
  list looks the same in a pane as on a phone.
- The space under a top bar is the screen margin, 16 or 24 dp, as on
  every side of a screen (owner decision on pull request 16). Material 3
  leaves none above a list.
- A selected list item marks the item that is open beside the list, in
  two panes. It must show with more than a change of colour (owner
  decision on pull request 16). So besides the higher surface colour
  over its pressed area, it has a bar in the accent colour along its
  start edge: 4 dp wide, in the 8 dp before the text, so the text does
  not move, and 12 dp short of the top and the bottom, clear of the
  rounded corners. The bar is accent on the higher surface, which the
  contrast tests already check, 4.5:1 or more. The fill alone is 1.22:1
  on the background, too little to show a state by itself.
- Text on buttons, chips and floating action buttons uses the `Label`
  style. The text of a checkbox, switch, radio button or slider uses
  `Body`, and so does the text typed in a field. The label above a text
  field and the line under it use `Caption`, as in Material 3.
- Disabled components use Material 3's disabled colours: text and icons in
  the `text` colour at 38 % opacity, fills in the `text` colour at 10 to
  12 %. The text next to a disabled checkbox, switch, radio button or
  slider dims the same way. WCAG does not ask for contrast on a control
  that is turned off.
- The dialog, the sheet, the menu and the pickers are raised surfaces,
  so they are the higher surface colour with a 1 dp outline and no shadow
  (rule 5). Material 3's shadows on them are turned off. The dialog and
  both pickers share one panel.
- A sheet's bottom sits on the edge of the window, so its outline runs
  along the top and down the sides only. Material 3 draws a sheet's
  modifier where the sheet would be before it slides up, so the suite
  draws the outline and the handle inside the sheet itself.
- The snackbar is the suite's own. Material 3's draws a shadow that
  cannot be turned off. It is drawn in the inverse colours that
  `ShkTheme` already maps for snackbars: the text colour as its fill, so
  it stands out on every surface in both themes without an outline
  (owner decision on pull request 17).
- A menu has the `Card` corners of a raised surface, 16 dp. Material 3
  gives menus its smallest corners, which this theme maps to `Field`,
  12 dp (owner decision on pull request 17).
- A row of a menu uses `Label`, as Material 3 does, because each row is
  an action.
- The date picker is Material 3's, in the suite's panel, with the suite's
  title and headline. Material 3's headline keeps the date to one line,
  which cuts off a long date at font scale 2.0; the suite's wraps. The
  line under the headline only separates, so it is the divider colour.

#### Rows

A list item, a section header, and the row of a checkbox, switch or
radio button follow one rule (owner decision on pull request 15):

1. Their content starts and ends at the edges of the space they are
   given. That is where the page title and all other text start, so the
   text of rows lines up with everything else on the screen.
2. Only the touch target, the pressed state and the selected mark of a
   row, a rounded `Field`, reach 8 dp (`ShkSpacing.Small`) past those
   edges, on both sides. The bar of a selected list item sits in that
   space before the text. TalkBack's focus box covers the same area. So the highlight
   never touches the text.
3. A section header cannot be touched, so nothing of it reaches past
   the edges.

The screen margins (16 and 24 dp) and the padding of a card (16 dp) are
wider than 8 dp, so the highlight stays inside them. Inside anything
that leaves less than 8 dp at its sides and cuts off what reaches past
it, the highlight would be cut. Rows side by side need at least 16 dp
between them, so their touch targets do not overlap. The Catalog's
columns are 16 dp apart.

`shkRow` in `ShkRows.kt` does this, for every row.

### Windows of their own

The dialog, the sheet, the menu and the two pickers open in a window of
their own, over the screen. An app shows a dialog or a picker while its
state says so, and stops showing it in `onDismissRequest`. A menu and a
sheet stay in the screen, and are shown by their state: `expanded` and
`visible`.

1. A tap on an action of a dialog, a picker or a menu calls it, then
   `onDismissRequest`. A tap outside it and Back call only
   `onDismissRequest`. So the app writes one line to close it.
2. A sheet's content is the app's own, so a tap on a row only calls the
   row. The row closes the sheet by setting `visible` to false. The sheet
   then slides down before it goes, as it does for a swipe, a tap above
   it, Back and TalkBack's "Dismiss" (owner decision on pull request 17).
   Set `visible` to true again while it slides, and it slides back up.
3. The dialog and the pickers keep 16 dp from the edges of the window.
   When they are taller than the window, as at font scale 2.0 on a phone
   held sideways, everything above their buttons scrolls, and the buttons
   stay in reach. A sheet's content scrolls in the same way.
4. The date picker's month needs 360 dp. In a narrower window the 16 dp
   beside it shrink first. In a window narrower than 360 dp, as on a
   phone with a large display size, Material 3 would cut off the last
   days of each week, so the picker offers typing the date only.

A window cannot be drawn on a page beside others, so the Catalog could
not show every state of these components at once. Each has a second
function that draws the same panel in place, without the window, the
dimmed screen or any motion: `ShkDialogInPlace`, `ShkBottomSheetInPlace`,
`ShkSnackbarInPlace`, `ShkMenuInPlace`, `ShkDatePickerInPlace` and
`ShkTimePickerInPlace`. They carry the `ShkInPlace` opt-in, at the error
level: a module that calls one without `@OptIn(ShkInPlace::class)` does
not build. Only the Catalog opts in. A panel in place is no pane, so
TalkBack does not announce every sample on a page.

Material 3 marks its date picker, its bottom sheet and parts of them as
experimental. `core/design` opts in where it uses them, and only there.
An update of Material 3 may change them; the tests and screenshots show
it if so. The owner accepted this, and the date picker offering typing
only in a window narrower than 360 dp (owner decision on pull request
17).

### Floating action button and snackbar

`ShkScreen` takes `floatingActionButton` and `snackbarHostState`.

1. The button sits in the bottom end corner of the screen, on the screen
   margins, above the content. It stays there while the content scrolls.
2. A scrolling screen leaves room at the end of its content, as tall as
   the button and the margin, so the last item can scroll clear of it.
3. A snackbar appears at the bottom, inside the margins and 16 dp above
   the button. The button does not move.
4. The button belongs to the screen at every window width. With a
   navigation bar it sits above the bar; beside a rail it sits in the
   screen's corner, not in the rail. In a list and detail it belongs to
   the screen of its pane.

Pull request 16 left the place of the button to this batch, and the
owner accepted this answer (owner decision on pull request 17). Material
3 puts it in the rail on wide windows; keeping it in the screen keeps one
rule for every width and keeps the rail unchanged.

### States

| State | Which components |
|---|---|
| Enabled | All. |
| Disabled (`enabled = false`) | All but the floating action buttons. When the action of a floating action button is not possible, leave the button out. |
| Pressed and focused | All. Material 3 draws a light layer of the component's text colour over it. Touch and hold to see it. A checkbox, switch or radio button shows it on its whole row. A focused text field is the one being typed in: its box and label turn `accent`. |
| Selected (`selected = true`) | Filter chip, radio button, list item. A list item is selected when it is the item open beside the list. |
| On (`checked = true`) | Checkbox, switch. |
| Error (`errorText` given) | Text field. |
| With steps (`steps` more than 0) | Slider. |
| Collapsed (`expanded = false`) | Extended floating action button. |
| Tappable (`onClick` given) | Card, list item. A card that can be tapped has no disabled state: when it cannot be opened, leave out `onClick` (owner decision on pull request 15). |
| With supporting or trailing text, with an icon | List item. |
| Announced (`announce = true`) | Empty state, when it answers something the user just did. Loading and error states are always announced. See [TalkBack](#talkback). |
| With a button (`action` given) | Empty state, error state. `action` is a `ShkStateAction`: the words on the button and what a tap does, together, so a state cannot show a button that does nothing (owner decision on pull request 15). |
| With Back (`onBack` given), with actions (`actions` given) | Top bar. Each action is a `ShkTopBarAction`: its icon, its label and what a tap does. An action can be turned off (`enabled = false`). |
| Selected (`selectedIndex`) | One destination of the navigation. A destination has no disabled state: leave out a place that is not there. |
| Bar or rail (`windowWidth`) | Navigation. It follows the window; the Catalog passes `windowWidth` to show both. |
| One pane or two (`windowWidth`), detail open (`detailOpen = true`) | List and detail. It follows the window; the Catalog passes `windowWidth` to show both. |
| With text, with content | Dialog. The content is the app's, such as a radio group or a text field. |
| Turned off (`enabled = false`) | A dialog's action, a menu row. |
| Deletes (`destructive = true`) | A dialog's action, a menu row: in the error colour. |
| Shown (`visible = true`) | Bottom sheet. It slides up, and slides down when it turns false. |
| With a title | Bottom sheet. |
| With an action (`actionText`) | Snackbar. A long message puts the action under it. |
| With icons | Menu rows. |
| Nothing chosen, a date chosen, earliest and latest dates (`earliestDate`, `latestDate`), typing | Date picker. "OK" is off while nothing is chosen. |
| 12-hour or 24-hour clock, an impossible time | Time picker. It follows the phone's setting. "OK" is off while a field is empty or wrong. |
| With a floating action button, with snackbars | `ShkScreen`. |

The states themselves cannot be turned off. Their button is a
`ShkTonalButton` that is always enabled (owner decision on pull request
15): when its action is not possible, leave the button out.

### Touch targets

Buttons and chips are drawn smaller than 48 dp, in the compact density of
ADR 0017. Material 3 reserves at least 48 by 48 dp of space around each
one, and a touch anywhere in that space counts. So rule 7 holds without
making the components look bigger. Floating action buttons are 56 dp.

A card that can be tapped is one touch target, as large as the card and
at least 48 dp tall. A list item that can be tapped is one touch target,
at least 48 dp tall, text included, as the row of a checkbox is. The
button of an empty or error state is a tonal button. A card without
`onClick`, the section header, the divider and the loading state cannot
be touched.

A checkbox, switch or radio button sits in a row with its text. The
whole row is one touch target, at least 48 dp tall, so a tap on the text
works too. A row's touch target is as wide as the space it is given and
8 dp more on each side ([Rows](#rows)). A text field is at
least 56 dp tall, and a tap anywhere on it, its label included, focuses
it. A slider is drawn 44 dp tall, and Material 3 reserves 48 dp of space
around it.

The Back button and the actions of a top bar are icon buttons: each has
48 by 48 dp of space, side by side without overlap. Each destination in
the bar or the rail is one touch target, the whole destination: as wide
as its share of the bar or as the rail, and at least 64 dp tall. Only
its pill shows that it is pressed, as in Material 3. The list and detail
has no touch targets of its own.

The buttons of a dialog, a snackbar and the pickers are text buttons,
each with 48 by 48 dp of space. In a dialog they sit 8 dp apart, side by
side or one above the other. Each row of a menu is one touch target, as
wide as the menu and at least 48 dp tall. The handle of a sheet is a
strip 48 dp tall across its top. Each day of the date picker, and each
button of its month, is 48 by 48 dp, as Material 3 makes them. The time
picker's fields are at least 56 dp tall, and AM and PM are rows of radio
buttons, at least 48 dp tall. The "More options" button of a top bar is
an icon button.

### Large text

- Text wraps onto more lines. Nothing is cut off or shortened with "…".
- Buttons and chips keep the corner radius of one line when they grow.
  See [Shape](#shape).
- Wrapped text keeps space above and below it, so it never touches the
  edge of a chip or a floating action button.
- An icon next to text grows with the font size, so it keeps its
  proportion to the text (owner decision on pull request 13). See
  [Icons](#icons).
- A text field's label and help wrap above and below its box. A field of
  one line scrolls sideways when the text is wider than the box, as every
  text field does.
- The text of a checkbox, switch or radio button wraps beside the
  control, which stays centred on it. The text of a slider's label wraps
  beside its value.
- The box of a checkbox and the ring of a radio button grow with the font
  size, by the rule for an icon next to text (owner decision on pull
  request 14). See [Icons](#icons).
- The switch and the slider keep their size at every font size (owner
  decisions on pull request 14). The slider's track already fills the
  width.
- The text of a card, a list item, a section header and the states
  wraps. In a list item, the text at the end keeps its place beside the
  main lines, which wrap, and the icon stays centred on them.
- The icon of a list item, and of an empty state, grows with the font
  size, by the rule for an icon next to text. The error icon grows the
  same way. The loading circle keeps its size: it is not next to text in
  a line, and it shows only that something is happening.
- A top bar's title wraps between its buttons, and the bar grows taller.
  The buttons stay centred on the title and keep their size.
- A destination's label wraps under its icon, centred. Its icon grows
  like 24 sp text, to 36 dp at font scale 2.0, and its pill grows with
  it. Destinations in the bar stay side by side and as tall as the
  tallest. Labels of one short word fit best: in a bar of four or five
  on a phone, at font scale 2.0, a long word can be wider than its
  destination and break onto the next line.
- The rail grows wider as 14 sp text grows, from 80 dp to about 149 dp at
  font scale 2.0. So a label keeps the room it has at the default size.
  If its destinations are taller than the window, as on a phone held
  sideways at a large font size, the rail scrolls.
- The text of a dialog wraps. Its buttons go one above the other when
  they do not fit side by side, the confirm button on top, and a long
  label wraps inside its button.
- A dialog, a picker or a sheet taller than its window scrolls; see
  [Windows of their own](#windows-of-their-own).
- A snackbar's action sits beside a message of one line, and under a
  longer message, at the end. The message wraps.
- A menu row's text wraps once the menu is 280 dp wide. Its icon grows
  like 24 sp text, as a list item's does.
- The date picker's chosen date wraps. Material 3's days and their
  numbers grow inside cells of 48 dp.
- The hour and the minute of the time picker are in `Headline`. Their
  help and errors wrap under each field.

### TalkBack

- A button or chip with text is read by its text, then "button". A filter
  chip is also read as selected or not.
- An icon button and a floating action button have no text, so
  `contentDescription` is a required argument. Say what the button does,
  for example "Search" or "New note".
- An extended floating action button is read by its text, also while it
  is collapsed. Material 3 1.4 hides that text from TalkBack, so
  `ShkExtendedFloatingActionButton` sets it as the button's label.
- Icons inside buttons and chips are decorative. TalkBack skips them.
- A text field is read with its label and its help. `label` is a required
  argument. An error is read once, as the field's error. Material 3 1.4
  reads every error as "Invalid input", so `ShkTextField` gives TalkBack
  `errorText` itself, and hides the line under the box from TalkBack so
  the error is not read twice.
- A checkbox, switch or radio button is read as one item with its row:
  its text, its role ("checkbox", "switch" or "radio button"), and whether
  it is checked, on or selected. Radio buttons inside a `ShkRadioGroup`
  are read as one group.
- A slider is read by its label and its value in words, for example
  "Daily goal, 8 glasses". `valueText` is a required argument, so
  TalkBack never reads a bare number or a percentage. The label and the
  value shown above the slider are hidden from TalkBack, so they are not
  read twice.
- A card that can be tapped is read as one item: all the text in it,
  then "button". So it must hold text, and no button or other control of
  its own. Material 3 gives it no role, so `ShkCard` sets "button". A
  card without `onClick` is read one item at a time, and its buttons are
  read as buttons.
- A list item is read as one item: its main line, its second line and
  the text at the end, in that order. With `onClick` it is also read as
  "button". Its icon is decorative. A selected list item is also read as
  "selected". Rows that are not selected say nothing about it, so a list
  where nothing can be open sounds as before.
- A section header is read as a heading, so TalkBack users can jump from
  group to group.
- A divider is not read.
- The title and the body of an empty or an error state are read as one
  item, then the button on its own. The icons are decorative.
- A loading state is read as its text and "in progress", as one item.
  Material 3 makes the circle an item of its own, which TalkBack would
  read as "in progress" without saying what is loading. So
  `ShkLoadingState` hides the circle and says "in progress" with the
  text. `text` is a required argument.
- A loading state and an error state are status messages (WCAG 2.2,
  success criterion 4.1.3). TalkBack announces them when they appear,
  politely: after what it is saying, without moving its focus (owner
  decision on pull request 15). The loading state announces its text, the
  error state its title and body, not its button. They are polite live
  regions, as Material 3's snackbar is.
- An empty state is announced the same way only with `announce = true`.
  Turn it on when the state answers something the user just did, such as
  a search or a filter that found nothing: then it is a status message.
  Leave it off, the default, when the state is simply what a screen shows
  when it opens, such as "No notes yet" (owner decision on pull request
  15).
- A top bar's title is read as a heading, so TalkBack users can jump to
  it. The Back button is read as "Back", then "button". Each action is
  read by its label; `ShkTopBarAction` takes the label with the icon, so
  an action cannot be shown without one.
- Each destination is read as its label, "tab", and whether it is
  selected. The destinations are one group. Their icons are decorative.
- The navigation and the list and detail add nothing else for TalkBack.
  Their content is read as it is.
- A dialog and both pickers are panes. TalkBack announces their title
  when they open, and reads it as a heading. Each button is read by its
  text.
- A sheet's title is a heading. Its handle is read as "Drag handle", and
  offers TalkBack's "Dismiss", which slides the sheet down.
- A snackbar is a polite live region, so TalkBack reads it when it
  appears. Material 3's host gives it "Dismiss", and lets it show longer
  when the phone's accessibility setting "Time to take action" asks for
  more time. Without an action it shows for 4 seconds, with one for 10.
- Each menu row is read by its text, then "button". Material 3 gives
  menu rows no role, so `ShkMenu` sets it. Icons are decorative.
- The date picker reads each day in full, such as "Friday, March 20,
  2026", as Material 3 does. The chosen date is read in full and is a
  polite live region, so TalkBack announces a new choice.
- Each field of the time picker is read with its label, its number and
  the range it takes, such as "Hour, 09, from 1 to 12", or its error
  instead of the range. AM and PM are radio buttons in one group.
- The "More options" button of a top bar is read as "More options".
- A disabled component is read as "disabled".

### Back

- In one pane, the detail of a list and detail is given a Back action.
  Pass it to the detail's top bar. The back gesture does the same: it
  closes the detail and shows the list again.
- In two panes, the detail gets no Back action, so its top bar shows no
  Back button. The list is already beside it. The back gesture leaves the
  screen as usual.
- `ShkListDetailScaffold` uses AndroidX Activity's `BackHandler` for the
  back gesture. `core/design` declares Activity Compose for this. It is
  the version the apps already use; Material 3 brings an older one at run
  time anyway. Activity Compose is already part of the stack, so this
  needs no ADR of its own (owner decision on pull request 16).

### Icons

1. Components take an icon as a Compose `Painter`. In an app, pass
   `painterResource(R.drawable.<icon>)` with a vector drawable.
2. There is no icon library in the build. Material's icon library would be
   a new dependency, which needs an ADR (hard rule 5 in CLAUDE.md).
3. `core/design` needs four icons of its own, drawn for the suite. The
   check mark on a selected filter chip and on the thumb of a switch that
   is on is one stroke (`shk_icon_check.xml`). The error icon of an error
   state is a circle and a line in one stroke, and a dot
   (`shk_icon_error.xml`). The Back arrow of a top bar is one stroke
   (`shk_icon_back.xml`), mirrored in right-to-left languages. The "More
   options" button of a top bar is three dots, one above the other
   (`shk_icon_more.xml`). Material 3's date picker draws its own arrows,
   pencil and calendar. The
   Catalog's sample icons (plus, search, a clock and a note) are drawn the
   same way and live in the Catalog.
4. An icon is a vector drawable on a 24 dp grid, drawn in black. The
   component replaces the colour and sets the size.
5. Size at the default font size, as in Material 3: 18 dp in buttons and
   chips, 24 dp elsewhere, a list item included. The icon at the top of an
   empty or an error state is 48 dp, because it stands for the whole
   screen (owner decision on pull request 15).
6. An icon next to text grows when the user makes text larger. It grows
   the way text of its own size grows: an 18 dp icon like 18 sp text,
   along Android's own font size curve. At font scale 2.0 an 18 dp icon
   is 30 dp, and at 1.3 it is 21.6 dp. It never gets smaller than its
   size at the default font size.
   - This covers icons in buttons, in chips and in the extended floating
     action button. The extended one keeps the grown icon while it is
     collapsed, so the icon does not jump when the button shrinks.
   - An icon with no text next to it, in an icon button or a floating
     action button, keeps its size. So at large font sizes a collapsed
     extended floating action button shows a larger icon than a floating
     action button.
   - The box of a checkbox and the ring of a radio button follow the same
     rule (owner decision on pull request 14). Both are 20 dp at the
     default font size and grow like a 20 dp icon: 34 dp at font scale
     2.0. Material 3 draws them at a fixed size, so `ShkCheckbox` and
     `ShkRadioButton` scale the drawing about its centre and make room
     for it. Their strokes grow with them, as an icon's strokes do.
   - The switch keeps its size, and so does the check mark on its thumb,
     Material 3's 16 dp.
   - The icon of a list item grows like 24 sp text, to 36 dp at font
     scale 2.0. The icon of an empty or an error state grows like 48 sp
     text. Android's curve grows large text less, so it is about 54 dp at
     font scale 2.0.
   - The icon of a destination has its label under it, so it grows like
     the icon of a list item. The icons of a top bar's buttons have no
     text next to them, so they keep their size.
   - The icon of a menu row grows like 24 sp text, as a list item's
     does.
   - `iconSizeNextToText` in `ShkIconSize.kt` does this. Use it for every
     new component that puts an icon next to text.

## Tests

### Contrast

`ShkColorsContrastTest` in `core/design` computes the contrast of every
pair with the WCAG 2.2 formula, in both themes:

1. Every text colour on `background`, `surface` and `surfaceHigh`: at
   least 4.5:1.
2. `textOnAccent` on `accent`: at least 4.5:1.
3. `outline` on `background`, `surface` and `surfaceHigh`: at least 3:1.
4. `divider` on `background`, `surface` and `surfaceHigh`: at least 1.5:1,
   and less than the outline on the same background.

It also checks the formula against known values (black on white is 21:1,
`#767676` on white is 4.54:1), and that every colour token is in one of
its groups. A new token fails the test until it is added to a group.

`ShkThemeMaterialTest` checks the Material 3 set-up:

1. Every Material 3 colour is a token of the same theme.
2. Material 3's text and icon colours keep 4.5:1 on the colours it draws
   them on, and its outlines 3:1.
3. Every Material 3 text style is one of the six, and every corner size
   one of the four shapes.
4. The six styles have the sizes of ADR 0017.

Both run in `./gradlew check`. When one fails, its message lists every
pair under the limit. Never lower a limit or skip a pair (hard rule 9 in
CLAUDE.md). The palette is fixed by ADR 0017, so changing a colour needs
the owner.

### Component tests

`ShkComponentsTest` in `core/design` draws every button, floating action
button, chip, checkbox, switch and radio button, the card and the list
item that can be tapped, and the button of the empty and the error
state, on its own, at font scale 1.0 and 2.0, with and without an icon,
and checks:

1. The space it takes is at least 48 by 48 dp.
2. TalkBack hears its label exactly once, and its role: button, checkbox,
   switch or radio button. A filter chip is a checkbox to TalkBack. A
   filter chip and a radio button also say whether they are selected, a
   checkbox and a switch whether they are on.
3. A tap calls its action. Turned off, it ignores taps and is read as
   disabled.
4. A long label in a space 200 dp wide wraps onto more lines, is not cut
   by its own layout, and all four corners of the text lie inside the
   component's shape.
5. An icon next to text is its Material 3 size at font scale 1.0 and
   larger at 2.0, but never more than twice that size. An icon alone
   keeps its size. The test passes an icon that records the size it is
   drawn at.

It runs with real fonts (Robolectric's native graphics). With fully
rounded ends instead of the capped pill, check 4 fails for every button
and chip at font scale 2.0. With icons that do not grow, check 5 fails
for every component with an icon next to text.

`ShkIconSizeTest` checks the icon size rule itself at font scales 0.85,
1.0, 1.3 and 2.0: the same size up to 1.0, and larger above it.

`ShkTextFieldTest` checks the text field at font scale 1.0 and 2.0:

1. It is at least 48 by 48 dp.
2. TalkBack hears its label and its help exactly once each. An error is
   heard once, as the field's error, and replaces the help.
3. Typing reaches the caller. Turned off, it is read as disabled.
4. A long label and long help in a space 200 dp wide wrap, are not cut,
   lie inside the field, and leave at least 48 dp between them for the
   box. With Material 3's own field, which puts the label in the border,
   this check fails at both font scales: the label sticks out above the
   field. The error check fails too: Material 3 reads "Invalid input".

`ShkSliderTest` checks the slider at font scale 1.0 and 2.0:

1. It takes at least 48 dp under its text.
2. TalkBack hears its label and its value in words, from the slider. The
   same words shown above it are hidden from TalkBack.
3. Moving it reaches the caller, at a step. Turned off, it is read as
   disabled.
4. A long label wraps, is not cut, and leaves room for the value beside
   it.

`ShkSelectionControlSizeTest` checks, at font scale 1.0 and 2.0, how wide
the checkbox, the radio button and the switch are drawn in their rows.
The checkbox and the radio button take Material 3's 24 dp at 1.0 and
grow like a 20 dp icon above it, to 40.8 dp at 2.0. The switch keeps
52 dp. Without the growing, the test fails for both at 2.0.

`ShkRadioGroupTest` checks that a `ShkRadioGroup` tells TalkBack its radio
buttons belong to one group.

`ShkContentComponentsTest` checks the parts of batch 3 at font scale 1.0
and 2.0. It runs on the screen of the screenshot phone, because at font
scale 2.0 the long samples are taller than Robolectric's own small
screen. It checks:

1. A list item is at least 48 dp tall. TalkBack reads it as one item, with
   all its text in order, and as a button when it can be tapped. Turned
   off, it is read as disabled. Its icon is not read. Selected, it is
   read as selected, and still as a button; a row that is not selected
   says nothing about it.
2. A section header is read as a heading. A divider is 1 dp tall, fills
   the width and is not read.
3. A card without `onClick` holds a button that is its own touch target,
   and the card's text is not part of the button.
4. The title and the body of an empty or an error state are read as one
   item, and the button on its own. No icon is read. Without an action
   there is no button.
5. A loading state is read as its text and "in progress", as one item,
   and there is no second "in progress" item. With Material 3's circle
   left as it is, this check fails.
6. The loading state and the error state are polite live regions, on the
   item that holds their words, so TalkBack announces those words when
   they appear. There is one live region for each, so nothing is
   announced twice. An empty state is a polite live region only with
   `announce = true`.
7. Long text in a list item, a section header, a card and the three
   states, in a space 200 dp wide, wraps, is not cut by its own layout and
   stays inside the component. The text at the end of a list item stays
   beside the main lines. The text of the states stays centred, line by
   line, and the button sits under it.

`ShkRowEdgeTest` checks the [Rows](#rows) rule at font scale 1.0 and 2.0,
in a space with a margin around it, as on a screen. The text of a list
item, a section header and a switch row starts at the edge of the space.
The touch target of a list item that can be tapped, and of the row of a
checkbox, switch and radio button, starts 8 dp before the space and ends
8 dp after it. With rows that do not reach past their edges, the second
check fails.

`ShkSelectedMarkTest` draws the mark of a selected list item onto an
image and checks its pixels: the accent bar along the start edge, the
fill after it and under the text, the fill above and below the bar where
the corners round, and the bar on the right in right-to-left languages.
Without the bar, the mark would be a change of colour only, and the test
fails.

`ShkWindowWidthTest` checks that window widths split at 600 and 840 dp,
and that `ShkWindowWidth.current` follows the window: compact on the
screenshot phone, medium on the tablet held upright, expanded on the
tablet held sideways.

`ShkTopBarTest` checks the top bar at font scale 1.0 and 2.0:

1. TalkBack reads the title as a heading, Back as "Back" and each action
   by its label, each once, as buttons. A tap calls each one. An action
   turned off is read as disabled.
2. The bar is at least 64 dp tall. In a space under 600 dp and one from
   600 dp, the title starts at the margin, 16 or 24 dp in. The icons of
   Back and of the last action sit on the margins, and beside Back the
   title starts where Back's touch target ends.
3. A long title in a space 300 dp wide wraps between the buttons, is not
   cut, and makes the bar taller. The buttons stay centred on it.

`ShkNavigationScaffoldTest` checks the navigation at font scale 1.0 and
2.0, in a space the size of the screenshot phone:

1. Compact: the destinations are a bar under the content, side by side,
   each as wide and as tall as the others, from edge to edge.
2. Medium and expanded: a rail before the content, the destinations one
   under the other. It is 80 dp wide at font scale 1.0 and grows as 14 sp
   text does.
3. Each destination is at least 48 by 48 dp, read as its label once, as
   a tab that is selected or not, in one group. Its icon is not read. A
   tap calls `onSelect` with its index.
4. A long label wraps inside its destination, in the bar and in the
   rail, and is not cut.
5. The content keeps its remembered state when the bar becomes a rail
   and back.

`ShkListDetailScaffoldTest` checks the list and detail:

1. Compact and medium: the list, or the detail in its place while it is
   open. The detail gets a Back action, and the Back button in its top
   bar closes it.
2. The back gesture closes the detail in one pane. With the list shown,
   or in two panes, the scaffold leaves the back gesture alone.
3. Expanded: the list, 360 dp wide, then the detail filling the rest,
   both as tall as the space. The detail gets no Back action and shows
   no Back button.
4. The list keeps its saved state while the detail covers it, and when
   the window changes between one pane and two. An open detail keeps its
   state when the window changes, and starts fresh when opened again.
   With the list composed in place, without moving its state, the
   one-pane-to-two-panes check fails.

The tests of batch 5 run at font scale 1.0 and 2.0, on the screen of the
screenshot phone:

- `ShkDialogTest`: the dialog is a pane announced by its title, which is
  a heading. Each button is read once, as a button, and their 48 dp touch
  targets do not overlap, side by side or one above the other. A tap on a
  button calls it, then `onDismissRequest`; one turned off ignores taps.
  Short buttons sit side by side at the end; long ones go one above the
  other, the confirm button on top, and their text stays inside them. A
  dialog taller than the window scrolls and keeps its buttons on the
  screen. Drawn in place, it is no pane.
- `ShkBottomSheetTest`: the title is a heading. The handle is read as
  "Drag handle", is 48 dp tall, and its "Dismiss" closes the sheet. The
  title and a row's text start at the screen margin. Content taller than
  the window scrolls to its last row. When a row sets it not visible, it
  is seen part of the way down before it goes; with a sheet that simply
  leaves, this check fails. Shown again on the way down, it comes back
  up.
- `ShkSnackbarTest`: a snackbar is a polite live region, goes away by
  itself and says it was dismissed. A tap on its action says it was
  performed. The action sits beside a short message and under a long
  one, which wraps and is not cut. On a screen, the floating action
  button sits on the margins in the bottom end corner, a snackbar appears
  above it without moving it, and a scrolling screen lets its last line
  scroll clear of the button.
- `ShkMenuTest`: each row is read once, as a button, without its icon,
  and is 48 dp tall. A tap closes the menu, then calls the row; a row
  turned off ignores taps. Long text wraps inside 280 dp. The top bar's
  "More options" opens its menu.
- `ShkDatePickerTest`: the picker is a pane announced by its title. "OK"
  is off until a date is chosen. A day tapped is the date given, after
  the dialog closes, and the chosen date is a polite live region read in
  full. Days outside the earliest and latest date are off. Every day of
  the month is 48 by 48 dp and no two overlap. In a window 320 dp wide
  there is no month, and a typed date is the date given.
- `ShkTimePickerTest`: the picker is a pane announced by its title. Each
  field is read with its label, its number and its range, and is 48 dp
  tall or more. With the 12-hour clock, AM and PM are radio buttons in
  one group; with the 24-hour clock there are none. An impossible hour
  gives the field an error and turns "OK" off; letters and a third digit
  cannot be typed. "OK" gives the time typed, after the dialog closes.
- `TimeFieldsTest` checks the rules of the time picker's fields without
  drawing anything: the hours of each clock, the minutes, 12 AM and
  12 PM, empty fields, what may be typed, and digits of other scripts,
  such as Arabic-Indic.

`ComponentPagesTest` in the Catalog opens each component page and checks
the components where they sit: each has a label and a role, no two touch
targets overlap, and every component that can be turned off is shown
turned off. On Lists, a section header is read as a heading. On Empty,
loading and error, the loading state is read with "in progress", "No
results" is announced and "No notes yet" is not, and the states under
"Try it" swap and are polite live regions. It also tries
the components under "Try it": the filter
chips select and clear, the checkboxes and switches turn on and off, a
radio button clears the others in its group, the text field takes typing
and shows its error past 20 characters, and the slider moves and says its
new value. On Lists, exactly one list item, the selected sample, is
read as selected. On Navigation, a tap selects a destination and shows
its name as the title. On List and detail, a tap on a note opens it in
place of the list, and the back gesture, then Back in its top bar, closes
it and leaves the page open. On the pages of batch 5, it opens each
component under "Try it" in its window and uses it: the dialog's Delete
and Cancel, a row of the sheet, the snackbar's Undo, a row of the top
bar's menu, a date typed in the date picker (the test window is too
narrow for the month), and an impossible hour, then a time, in the time
picker. Every page is also opened and closed with
the back gesture by `CatalogScreenTest`, so no sample on a page takes
the back gesture for itself.

### Catalog

The Catalog app shows every token and every component, and the screens
that every app shares. Its start screen lists its pages in three groups.

Tokens:

1. **Colours**: every token with its code name and value, then every text
   colour and the outline on each background with its contrast, then text
   on accent.
2. **Type**: each style shown in itself, with its use, size, line height
   and weight.
3. **Shape**: each shape as a raised surface, with its use and radius.
4. **Spacing**: each step as a bar of its width, the screen margins, and
   a 48 dp touch target.

Components:

5. **Buttons**: the filled, tonal and text buttons enabled, with an icon,
   disabled and with a long label, and the icon button enabled and
   disabled.
6. **Floating action buttons**: the floating action button, and the
   extended one expanded, collapsed and with a long label.
7. **Chips**: the filter chip not selected, selected, disabled, selected
   and disabled, and with a long label, then three filter chips to try.
   The assist chip with and without an icon, disabled and with a long
   label.
8. **Text fields**: the text field empty, with text, with help, in
   error, disabled, with several lines, and with a long label and long
   help, then one to try.
9. **Selection controls**: the checkbox, the switch and the radio button,
   each off, on, disabled, on and disabled, and with a long label, then a
   few of each to try.
10. **Sliders**: the slider without steps, with steps, disabled and with
    a long label, then one to try.
11. **Cards**: the card that cannot be tapped, alone and with a button,
    and the card that can be tapped, with short and long text.
12. **Lists**: the list item with one line, with supporting text, with an
    icon, with trailing text, tappable, disabled, selected and with long
    text; the
    section header with one line, with long text and above list items;
    the divider between list items.
13. **Empty, loading and error**: the empty state with an icon and a
    button, answering a search (announced), with a title only and with
    long text; the
    loading state with short and long text; the error state with and
    without a button and with long text; then an error state to try,
    which turns into a loading state (owner decision on pull request 15).
14. **Top bars**: the top bar with a title only, with Back, with actions,
    with Back and an action, with an action turned off, and with a long
    title. Each is in a frame that stands for the top of a screen.
15. **Navigation**: the bar and the rail, each with short labels and with
    a long one, then one to try. Each is in a frame that stands for a
    window. The samples are drawn for a fixed window width, so the bar
    and the rail show on every device. The one to try follows the window.
16. **List and detail**: one pane showing the list, and showing a note
    with Back. In a window at least 840 dp wide, also two panes with
    nothing open and with a note open, which is selected in the list; in
    a narrower one, a line says where to see them. Then one to try, which
    follows the window.

17. **Dialogs**: the dialog with text and two buttons, with one button,
    with a choice, with its confirm button turned off and with long text,
    then one to try.
18. **Bottom sheets**: the sheet with a title, without one and with long
    text, then one to try.
19. **Snackbars**: the snackbar with a message only, with an action and
    with long text, then a screen to try, whose floating action button
    shows a snackbar above itself.
20. **Menus**: the menu with text only, with icons, with a row turned
    off, with a row that deletes and with long text, then a top bar to
    try, with its "More options".
21. **Date pickers**: the picker with nothing chosen, with a date chosen,
    with an earliest and a latest date, typing the date, and with a long
    title, each on March 2026, then one to try.
22. **Time pickers**: the picker with the 12-hour clock, with the 24-hour
    clock, with an impossible time and with a long title, then one to
    try, which follows the phone's clock setting.

Shared screens:

23. **Recovery key screens**: every state of the screens of
    `core/security`, with sample words that are no real key: the
    security screen with no key yet, set up and kept with keys in
    StrongBox, with no screen lock and keys in software, and with a setup
    that stopped, damaged key files and the warning of a preview build;
    creating a key, from the screen before the words to done; entering
    the words, with suggestions, which can be typed into; words that
    could start over; and the words shown again. Each opens full window,
    and Back returns to the list. A switch blocks screenshots as in an
    app; it is off by default
    ([security-screens.md](../architecture/security-screens.md#catalog)).

The samples of pages 17 to 22 are drawn in place
([Windows of their own](#windows-of-their-own)); only the one under "Try
it" opens a window. The date picker samples show a month in the past, so
they do not change with today's date, and no day in them is marked as
today. Material 3 keeps the date picker's state inside it, so its days
respond to taps; its buttons do nothing.

The sample of one pane with a note open draws the note's screen as the
scaffold shows it, without the scaffold. In one pane the scaffold takes
the back gesture while a note is open, so a sample that is always open
would keep the back gesture from leaving the page.

Each component page names a component, says when to use it, then shows
each state under a caption. Only the components under "Try it" respond
to a tap, typing or dragging, so every other sample always shows the
state its caption names. A text field that is not under "Try it" can
still be focused, but it keeps its text.

Open a page by tapping it. Go back with the back gesture. In a window at
least 600 dp wide, the pages lay their items out in two or three columns.

The token pages read their numbers from the tokens, so they cannot drift
from the code. TalkBack reads each sample as one item, and each contrast
as "Text, contrast 18.34 to 1".

### Screenshots

Every Catalog page has screenshot tests in the eight standard
configurations ([build.md](build.md#screenshot-tests)). A page taller than
the window is captured to its end: the first image is
`<Page>_<config>.png`, and each further window is
`<Page>_<config>_part2.png`, `_part3.png` and so on. Each next image
repeats the last 48 dp of the one before, so a line cut at an edge shows
whole in the next. It scrolls the page itself, the outermost part that
scrolls: a rail or a pane in a sample can scroll inside the page.

The frames of the list-and-detail samples grow as body text grows, so at
font scale 2.0 they still show all their notes. The frame to try keeps
its height, and its panes scroll, as on a phone.

Compose tests stop animations that never end, so the screenshots show the
loading circle as it starts: a short arc at its top. On a phone it turns.

`SecurityScreensScreenshotTest` opens each state of the recovery key
screens from its page, the way the owner does, and captures it to its end
in the eight standard configurations: `RecoveryKey<State>_<config>.png`.

`OpenComponentsScreenshotTest` opens each component of batch 5 from "Try
it", the way a user does, and captures the whole screen with its window,
in the eight standard configurations: `DialogOpen`, `BottomSheetOpen`,
`MenuOpen`, `DatePickerOpen` and `TimePickerOpen`, and `SnackbarShown`,
the snackbar above its floating action button. They show where each
window sits and that nothing in it is cut off at font scale 2.0. The
clock stands still while the snackbar shows, so it does not go away
before the capture.

## How to check it on a phone

1. Install the Catalog preview from the pull request
   ([test-a-pull-request.md](test-a-pull-request.md)).
2. Open each page. Check that nothing is cut off or overlaps.
3. Turn dark theme on in the system settings and look again. The
   background must be true black.
4. Set the font size to the largest in the system settings and look
   again.
5. Turn on TalkBack and swipe through a page. Each sample is read as one
   item.
6. On the component pages, touch and hold a button or chip to see it
   pressed. Under "Try it", tap the chips to select and clear them.
7. With TalkBack on, swipe through a component page. Each component is
   read with its label and "button", or for a filter chip whether it is
   selected. Disabled ones are read as "disabled".
8. On Text fields, tap the field under "Try it" and type. Its border and
   label turn the accent colour. Type more than 20 characters to see the
   error, then delete some to clear it.
9. On Selection controls, tap the rows under "Try it", on the text as
   well as on the control. The checkboxes and radio buttons start at the
   left edge of the page title, and the switches end at the right edge of
   the text above them. The pressed highlight reaches a little past both. With TalkBack on, each row is read once, with
   its text, its role and its state. At the largest font size, the boxes
   of the checkboxes and the rings of the radio buttons are larger, and
   the switches keep their size.
10. On Sliders, drag the slider under "Try it". The number of glasses
    changes. With TalkBack on, the slider is read as "Daily goal" and the
    number of glasses, not a percentage.
11. On Cards, touch and hold the tappable cards to see them pressed. With
    TalkBack on, a tappable card is read as one item with all its text,
    then "button". In the card with a button, the card's text and the
    Edit button are read one at a time.
12. On Lists, the text of every list item and section header starts at
    the left edge of the page title. Touch and hold the tappable list
    items: only the highlight reaches past that edge. The dividers are a
    lighter grey than the outlines of the cards. With TalkBack on,
    each list item is read as one item with all its text, the disabled
    one as "disabled", and the selected one as "selected". The selected
    one has a short bar in the accent colour before its text. Set
    TalkBack's reading control to "Headings": moving by heading then
    stops at each section header.
13. On Empty, loading and error, check that the loading circles turn.
    With TalkBack on, a loading state is read as its text and "in
    progress", and the title and body of each empty and error state as
    one item. Under "Try it", tap Try again: TalkBack announces "Loading
    the list". Then turn the switch off: TalkBack stays on the switch and
    announces "Could not load the list" and the line under it.
14. On Colours, each background lists the divider with its contrast,
    between 1.5:1 and the outline's.
15. On Top bars, in each frame, a title without an arrow starts as far
    in from the frame's left edge as the arrows do, and the last icon
    ends as far in from the right edge. With TalkBack on, each title is read
    as a heading, the arrow as "Back, button", and the clock as "Add a
    reminder", and "disabled" where it is grey.
16. On Navigation, the selected destination has a filled pill. Under
    "Try it", tap Notes and Search: the pill moves and the title changes.
    With TalkBack on, each destination is read as its name, "tab", and
    "selected" for the one with the pill.
17. Turn the phone sideways, or open Navigation on the tablet: the one to
    try becomes a rail. At the largest font size the rail is wider and
    the labels wrap; nothing is cut off.
18. On List and detail, under "Try it", tap a note. On a phone held
    upright it opens in place of the list. Use the back gesture: the list
    shows again, and the page stays open. Open a note again and tap the
    arrow: the same. Use the back gesture once more: the start screen
    shows.
19. Turn the phone sideways, or open List and detail on the tablet held
    sideways. The two-pane samples show, and under "Try it" a tapped note
    opens beside the list, with no arrow in its top bar. The open note is
    marked in the list, with a bar before its text, and TalkBack reads it
    as "selected". On the tablet held upright there is still one pane.
20. On Dialogs, under "Try it", tap "Delete the note". The dialog opens
    over the dimmed page, 16 dp from the edges. Tap Delete: the line
    under the button says so. Open it again and tap outside it, then go
    back: each closes it. With TalkBack on, the title is announced when
    it opens. At the largest font size, the buttons of the long sample
    are one above the other, Delete on top.
21. On Bottom sheets, under "Try it", tap "Show the actions". The sheet
    slides up; its title and rows start where the page title does. Tap a
    row: the sheet slides down and the line under the button names the
    row.
    Open it again and swipe it down. With TalkBack on, find "Drag handle"
    and use "Dismiss" from TalkBack's actions.
22. On Snackbars, under "Try it", tap the plus. "Note added" shows above
    it, with Undo, and the plus does not move. Tap Undo: the count goes
    back. Tap the plus and wait: the snackbar goes away by itself. With
    TalkBack on, "Note added" is announced.
23. On Menus, under "Try it", tap the three dots. The menu opens over
    them. Tap "Sort by date": the menu closes and the line under the top
    bar says so. Delete is red in the samples.
24. On Date pickers, under "Try it", tap "Choose a due date". March 2026
    opens, with the 12th chosen. Tap another day and OK. Tap the pencil to
    type a date instead. With TalkBack on, each day is read in full.
25. On Time pickers, under "Try it", tap "Choose a reminder time". Type 13
    as the hour: an error shows under it and OK turns off. Type 7, choose
    PM and tap OK: the line under the button says 7:05 PM or the time you
    typed. Turn on "Use 24-hour format" in the system settings, open it
    again: AM and PM are gone, and the hour takes 0 to 23.
26. Set the display size to the largest in the system settings and open
    the date picker under "Try it". If the window is too narrow for the
    month, it offers typing the date, with no pencil. Nothing is cut off.

## Open

- The "Use" columns above are starting guidance, to be refined by the
  component batches.
- `ScreenshotConfig` and `captureWholeScreen` live in the Catalog's tests.
  They move to `core/testing` when that module is made.
- A shared icon set for the apps. Each icon is drawn for the suite until
  then.
- Focus uses Material 3's light state layer. There is no separate focus
  ring for keyboards.
- When to look again at the suite's own adaptive layouts, for example for
  foldable devices: see [ADR 0024](../adr/0024-own-adaptive-layouts.md).
  Whether the apps use Navigation 3 is decided when the first app is
  built.
- What batch 4 leaves out (see [Components](#components)), until an app
  needs it.
- A month that fits a window narrower than 360 dp would need the
  suite's own date picker. Until then the date picker offers typing
  there (accepted by the owner on pull request 17).
- What batch 5 leaves out (see [Components](#components)), until an app
  needs it.
