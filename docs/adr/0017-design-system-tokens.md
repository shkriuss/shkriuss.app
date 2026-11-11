# 0017 Design system tokens

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 11), 4, 9 and 11,
  the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4), and
  Phase 1, step 1 in [PROMPTS.md](../development/PROMPTS.md), which
  completed points 8 to 12

## Context

- Decision 11 sets the visual style: a fixed palette, compact, rounded, a
  true-black dark theme and a teal accent.
- The accessibility target is WCAG 2.2 level AA as applied to mobile. That
  means 48dp touch targets, contrast of 4.5:1 for small text and 3:1 for
  large text, TalkBack labels, and font scale 2.0 (section 11).
- Only `core/design` touches Material 3 directly. Apps use the `Shk*`
  components (section 4).

## Decision

1. Colour: a fixed palette. No dynamic colour.

   | Role | Light | Dark |
   |---|---|---|
   | Background | `#FFFFFF` | `#000000` |
   | Surfaces | `#F3F4F2`, `#E7E9E6` | `#0D0E0E`, `#191B1A` |
   | Text | `#131514` | `#ECEEEC` |
   | Secondary text | `#4A4F4C` | `#A9AEAA` |
   | Outline | `#7A807C` | `#6F7571` |
   | Accent | `#00695C` | `#5FD6C2` |
   | Text on accent | `#FFFFFF` | `#00201B` |
   | Error | `#B3261E` | `#FFB4AB` |
   | Success | `#1B6E3C` | `#7FDB9A` |
   | Warning | `#7A5800` | `#F2C24B` |

2. Checked contrast: every text pair is at least 5.1:1. Outlines are at
   least 3.3:1. Light text on accent, `#FFFFFF` on `#00695C`, is 6.61:1.
3. Shape: pill buttons, 12dp fields, 16dp cards, 28dp sheets and dialogs.
4. Density: compact, on a 4dp grid.
   - Margins: 16dp on phones, 24dp on tablets.
   - Body text: 14sp.
   - Touch targets stay at least 48dp.
5. Raised surfaces use a surface colour plus an outline, not shadows. This
   is the same in both themes. In the true-black theme, the surface is a
   lighter grey.
6. Type: the system font, six text styles, no bundled fonts. Starting
   values, shown in the Catalog since Phase 1, step 1. The owner confirms
   them on the three devices at the Phase 1 gate:

   | Style | Size (sp) | Line height (sp) |
   |---|---|---|
   | Headline | 24 | 32 |
   | Title | 20 | 28 |
   | Subtitle | 16 | 24 |
   | Body | 14 | 20 |
   | Label | 14 | 20 |
   | Caption | 12 | 16 |

   Subtitle and Label use medium weight.

7. App icons: adaptive, with a monochrome layer.
8. Token names in code, in `core/design`:

   | Kind | Names |
   |---|---|
   | Colour (`ShkTheme.colors`) | `background`, `surface`, `surfaceHigh`, `text`, `textSecondary`, `outline`, `accent`, `textOnAccent`, `error`, `success`, `warning`, in the order of the table in point 1 |
   | Type (`ShkTextStyle`) | `Headline`, `Title`, `Subtitle`, `Body`, `Label`, `Caption` |
   | Shape (`ShkShapes`) | `Pill`, `Field` (12dp), `Card` (16dp), `Sheet` (28dp, sheets and dialogs) |
   | Spacing (`ShkSpacing`) | `ExtraSmall` 4dp, `Small` 8dp, `Medium` 12dp, `Large` 16dp, `ExtraLarge` 24dp |
   | Screen (`ShkSpacing`) | `ScreenMargin` 16dp, `ScreenMarginWide` 24dp, `WideWindowWidth` 600dp, `MinTouchTarget` 48dp |

9. "Tablet" in point 4 means a window at least 600dp wide, where Android's
   medium window size class starts. That includes an open foldable and a
   phone held sideways.
10. Only colours change with the theme. Text styles, shapes and spacing
    are the same in both themes, so they are plain constants, not theme
    values.
11. Material 3, which only `core/design` uses, gets every colour role, text
    style and shape from these tokens. No colour of Material's own
    palette is used. Its tonal elevation is turned off by setting the
    surface tint to the background (point 5). The full mapping is in
    [design-system.md](../development/design-system.md).
12. Two unit tests in `core/design` check the tokens in both themes, with
    the WCAG 2.2 formula:
    - every text colour on every background, and text on accent: at
      least 4.5:1,
    - the outline on every background: at least 3:1,
    - every Material 3 colour is a token, and Material 3's own text and
      outline pairs keep the same limits.

## Options rejected

- **Dynamic colour.** The owner chose a fixed palette. Contrast can then be
  checked once for every pair, and screenshots look the same on every
  device.
- **Shadows on raised surfaces.** They vanish on a true-black background.
- **Bundled fonts.** The system font follows the user's settings and
  covers Georgian. There are no font files to license, ship and verify.

## Consequences

- Every screen has a light theme and a true-black dark theme
  ([CLAUDE.md](../../CLAUDE.md)).
- A unit test checks contrast. It fails a text pair under 4.5:1 and an
  outline pair under 3:1 (step 1.1 in
  [PROMPTS.md](../development/PROMPTS.md)). A new colour token fails it
  until the token is put in a group, so no colour can skip the check.
- A Material 3 update that adds a colour role stops the build until the
  role is mapped to a token.
- The Catalog app shows the colour, type, shape and spacing tokens, one
  page each, with screenshots in the eight standard configurations.
- How to use the tokens is in
  [design-system.md](../development/design-system.md).
- Changing a colour value changes this decision, so it needs the owner and
  a new record (point 7 of [0001](0001-record-architecture-decisions.md)).
- Open: the owner confirms the text styles at the Phase 1 gate (point 6).
