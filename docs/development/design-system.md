# Design system

The colours, type, shapes and spacing every app uses, the `Shk*`
components built from them, and how both are checked. They live in
`android/core/design`. The tokens were built in Phase 1, step 1. The
decision and its reasons are in
[ADR 0017](../adr/0017-design-system-tokens.md). The components come in
Phase 1, step 2, batch by batch. Batch 1 is here: buttons, floating action
buttons and chips. See [Components](#components).

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
| `ShkScreen.kt` | `ShkScreen`, the background and margins of a screen. A stub until the adaptive scaffold in Phase 1, step 2. |
| `ShkButtons.kt` | `ShkFilledButton`, `ShkTonalButton`, `ShkTextButton` and `ShkIconButton`. |
| `ShkFloatingActionButton.kt` | `ShkFloatingActionButton` and `ShkExtendedFloatingActionButton`. |
| `ShkChips.kt` | `ShkFilterChip` and `ShkAssistChip`. |
| `ShkIconSize.kt` | `iconSizeNextToText`, the size of an icon next to text at the user's font size. Internal to `core/design`. |
| `res/drawable/shk_icon_check.xml` | The check mark on a selected filter chip. |

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
| `accent` | `#00695C` | `#5FD6C2` | Main actions, selection, links and focus. |
| `textOnAccent` | `#FFFFFF` | `#00201B` | Text and icons on a filled accent area. |
| `error` | `#B3261E` | `#FFB4AB` | Errors and destructive actions. |
| `success` | `#1B6E3C` | `#7FDB9A` | Something worked or is in a good state. |
| `warning` | `#7A5800` | `#F2C24B` | Something needs attention but is not an error. |

The values are from ADR 0017. The "Use" column is the starting guidance;
the component batches in Phase 1, step 2 may refine it.

### Which colours may be text, and on what

- Text colours: `text`, `textSecondary`, `accent`, `error`, `success`,
  `warning`. Each may be used on `background`, `surface` and `surfaceHigh`.
- `textOnAccent` is only for text on `accent`.
- `outline` is never text. It needs 3:1 against the three backgrounds.
- Status colours are for text and icons. Where Material 3 fills an area
  with the error colour, its text is the background colour: 6.54:1 in the
  light theme, 12.37:1 in the dark theme.

The lowest text pair is `success` on `surfaceHigh` in the light theme,
5.15:1. The lowest outline pair is `outline` on `surfaceHigh` in the light
theme, 3.30:1. The Catalog's Colours page shows every pair with its
contrast.

## Type

Six styles, all in the system font. Use them through `ShkText`:

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
floating action buttons `ShkShapes.Card`.

## Components

Batch 1 of Phase 1, step 2. Each component is one function in
`core/design`, built on Material 3. Apps call these, never Material 3.

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

Material 3 also has input chips (a removable tag) and suggestion chips.
They are built when the first app needs them, not before (owner
decision on pull request 13).

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

- Every pair in the table is one the contrast test already checks.
- No component has a shadow, in any state. Material 3's elevation is
  turned off, also for a mouse hovering and a chip being dragged
  (ADR 0017, point 5).
- A selected filter chip is filled with the accent colour, because the
  accent is the colour of selection (owner decision on pull request 13).
  Material 3's default, the higher surface colour, is hard to tell from
  not selected. It also shows a check mark, so the state does not depend
  on colour alone.
- Text uses the `Label` style.
- Disabled components use Material 3's disabled colours: text and icons in
  the `text` colour at 38 % opacity, fills in the `text` colour at 10 to
  12 %. WCAG does not ask for contrast on a control that is turned off.

### States

| State | Which components |
|---|---|
| Enabled | All. |
| Disabled (`enabled = false`) | All but the floating action buttons. When the action of a floating action button is not possible, leave the button out. |
| Pressed and focused | All. Material 3 draws a light layer of the component's text colour over it. Touch and hold to see it. |
| Selected (`selected = true`) | Filter chip. |
| Collapsed (`expanded = false`) | Extended floating action button. |

### Touch targets

Buttons and chips are drawn smaller than 48 dp, in the compact density of
ADR 0017. Material 3 reserves at least 48 by 48 dp of space around each
one, and a touch anywhere in that space counts. So rule 7 holds without
making the components look bigger. Floating action buttons are 56 dp.

### Large text

- Text wraps onto more lines. Nothing is cut off or shortened with "…".
- Buttons and chips keep the corner radius of one line when they grow.
  See [Shape](#shape).
- Wrapped text keeps space above and below it, so it never touches the
  edge of a chip or a floating action button.
- An icon next to text grows with the font size, so it keeps its
  proportion to the text (owner decision on pull request 13). See
  [Icons](#icons).

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
- A disabled component is read as "disabled".

### Icons

1. Components take an icon as a Compose `Painter`. In an app, pass
   `painterResource(R.drawable.<icon>)` with a vector drawable.
2. There is no icon library in the build. Material's icon library would be
   a new dependency, which needs an ADR (hard rule 5 in CLAUDE.md).
3. The only icon `core/design` needs, the check mark on a selected filter
   chip, is drawn for the suite as one stroke
   (`shk_icon_check.xml`). The Catalog's sample icons (plus, search and a
   clock) are drawn the same way and live in the Catalog.
4. An icon is a vector drawable on a 24 dp grid, drawn in black. The
   component replaces the colour and sets the size.
5. Size at the default font size, as in Material 3: 18 dp in buttons and
   chips, 24 dp elsewhere.
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

`ShkComponentsTest` in `core/design` draws every component on its own,
at font scale 1.0 and 2.0, with and without an icon, and checks:

1. The space it takes is at least 48 by 48 dp.
2. TalkBack hears its label exactly once, and its role: button, or
   checkbox for a filter chip. A filter chip also says whether it is
   selected.
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

`ComponentPagesTest` in the Catalog opens each component page and checks
the components where they sit: each has a label and a role, no two touch
targets overlap, every component that can be turned off is shown turned
off, and the filter chips under "Try it" select and clear.

### Catalog

The Catalog app shows every token and every component. Its start screen
lists its pages in two groups.

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

Each component page names a component, says when to use it, then shows
each state under a caption. Only the chips under "Try it" respond to a
tap, so every other sample always shows the state its caption names.

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
whole in the next.

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

## Open

- The six text styles are the starting values of ADR 0017. The owner
  confirms them on the three devices at the Phase 1 gate.
- The "Use" columns above are starting guidance, to be refined by the
  component batches.
- `ScreenshotConfig` and `captureWholeScreen` live in the Catalog's tests.
  They move to `core/testing` when that module is made.
- A shared icon set for the apps. Each icon is drawn for the suite until
  then.
- Focus uses Material 3's light state layer. There is no separate focus
  ring for keyboards.
