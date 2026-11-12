# 0017 Design system tokens

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 11), 4, 9 and 11,
  the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4), and
  Phase 1, step 1 in [PROMPTS.md](../development/PROMPTS.md), which
  completed points 8 to 12, and the owner's decision on
  [pull request 13](https://github.com/shkriuss/shkriuss.app/pull/13),
  which completed point 3, and on
  [pull request 15](https://github.com/shkriuss/shkriuss.app/pull/15),
  which added the divider colour (point 13), and the owner's check of
  Catalog 0.2.0 at the Phase 1 gate on 2026-11-12, which confirmed the
  teal accent (point 1) and the text styles (point 6)

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
   | Divider | `#B8BCB9` | `#3B3F3D` |
   | Accent | `#00695C` | `#5FD6C2` |
   | Text on accent | `#FFFFFF` | `#00201B` |
   | Error | `#B3261E` | `#FFB4AB` |
   | Success | `#1B6E3C` | `#7FDB9A` |
   | Warning | `#7A5800` | `#F2C24B` |

   The owner confirmed the teal accent as it is: `#00695C` in the light
   theme and `#5FD6C2` in the dark theme. They checked it with Catalog
   0.2.0 on the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a on
   2026-11-12, at the Phase 1 gate.

2. Checked contrast: every text pair is at least 5.1:1. Outlines are at
   least 3.3:1. Dividers are at least 1.57:1. Light text on accent,
   `#FFFFFF` on `#00695C`, is 6.61:1.
3. Shape: pill buttons, 12dp fields, 16dp cards, 28dp sheets and dialogs.
   - A pill has fully rounded ends at the height of one line of text.
     For buttons that is a 20dp corner radius, and for chips 16dp.
   - When large text wraps a button or a chip onto more lines, its
     corners keep that radius. They do not grow with the height. Fully
     rounded ends on a taller button would cut off the corners of the
     text, which breaks "no clipped text at font scale 2.0".
4. Density: compact, on a 4dp grid.
   - Margins: 16dp on phones, 24dp on tablets.
   - Body text: 14sp.
   - Touch targets stay at least 48dp.
5. Raised surfaces use a surface colour plus an outline, not shadows. This
   is the same in both themes. In the true-black theme, the surface is a
   lighter grey.
6. Type: the system font, six text styles, no bundled fonts. The Catalog
   has shown them since Phase 1, step 1. The owner confirmed them as they are,
   with Catalog 0.2.0 on the Pixel 9 Pro, the Pixel Tablet and the Pixel
   6a on 2026-11-12, at the Phase 1 gate:

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
   | Colour (`ShkTheme.colors`) | `background`, `surface`, `surfaceHigh`, `text`, `textSecondary`, `outline`, `divider`, `accent`, `textOnAccent`, `error`, `success`, `warning`, in the order of the table in point 1 |
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
    - the divider on every background: at least 1.5:1, and less than the
      outline (point 13),
    - every Material 3 colour is a token, and Material 3's own text and
      outline pairs keep the same limits.
13. Divider (owner decision on pull request 15). Lines that only separate
    content, such as a line between list items, use their own colour,
    `divider`, lighter than the outline.
    - A divider is decorative. The space and the content around it already
      show where one thing ends, so the line carries no meaning of its
      own. WCAG 2.2 asks 3:1 only of the parts of controls and graphics
      that are needed to understand them (success criterion 1.4.11), so it
      asks nothing of a divider. With the outline's 3:1, every divider
      would be as strong as the border of a control.
    - It must still stay visible on the background and on both surfaces.
      So the contrast test gives it its own floor, 1.5:1. Material 3's own
      baseline divider colour goes down to 1.31:1 on its highest surface.
      The suite's values are at least 1.57:1, `#B8BCB9` on `#E7E9E6` in
      the light theme. In the dark theme the lowest is 1.62:1.
    - It must stay quieter than the outline. The test also fails if the
      divider reaches the outline's contrast on any background.
    - Material 3's "outline variant" role stays the outline. Material 3
      draws the borders of chips, outlined buttons and outlined icon
      buttons in that role, and those need 3:1. Only `ShkDivider` uses the
      divider colour.

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
- A unit test checks contrast. It fails a text pair under 4.5:1, an
  outline pair under 3:1 (step 1.1 in
  [PROMPTS.md](../development/PROMPTS.md)), and a divider pair under
  1.5:1 or as strong as the outline. A new colour token fails it
  until the token is put in a group, so no colour can skip the check.
- A Material 3 update that adds a colour role stops the build until the
  role is mapped to a token.
- The Catalog app shows the colour, type, shape and spacing tokens, one
  page each, with screenshots in the eight standard configurations.
- How to use the tokens is in
  [design-system.md](../development/design-system.md).
- Changing a colour value changes this decision, so it needs the owner and
  a new record (point 7 of [0001](0001-record-architecture-decisions.md)).
- Settled at the Phase 1 gate: on 2026-11-12 the owner checked Catalog
  0.2.0 on the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a. The teal
  accent (point 1) and the six text styles (point 6) stay as they are.
