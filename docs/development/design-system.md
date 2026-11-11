# Design system

The colours, type, shapes and spacing every app uses, and how they are
checked. They live in `android/core/design`. Built in Phase 1, step 1. The
decision and its reasons are in
[ADR 0017](../adr/0017-design-system-tokens.md). The `Shk*` components come
in Phase 1, step 2, and are added here batch by batch.

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

Material 3 buttons are already pills. Components set their shape from
`ShkShapes` themselves; this mapping is the fallback.

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

### Catalog

The Catalog app shows every token. Its start screen lists four pages:

1. **Colours**: every token with its code name and value, then every text
   colour and the outline on each background with its contrast, then text
   on accent.
2. **Type**: each style shown in itself, with its use, size, line height
   and weight.
3. **Shape**: each shape as a raised surface, with its use and radius.
4. **Spacing**: each step as a bar of its width, the screen margins, and
   a 48 dp touch target.

Open a page by tapping it. Go back with the back gesture. In a window at
least 600 dp wide, the pages lay their items out in two or three columns.

The pages read their numbers from the tokens, so they cannot drift from
the code. TalkBack reads each sample as one item, and each contrast as
"Text, contrast 18.34 to 1".

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

## Open

- The six text styles are the starting values of ADR 0017. The owner
  confirms them on the three devices at the Phase 1 gate.
- The "Use" columns above are starting guidance, to be refined by the
  component batches.
- `ScreenshotConfig` and `captureWholeScreen` live in the Catalog's tests.
  They move to `core/testing` when that module is made.
