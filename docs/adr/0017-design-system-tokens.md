# 0017 Design system tokens

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 11), 4, 9 and 11

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
   | Text on accent | Not given | `#00201B` |
   | Error | `#B3261E` | `#FFB4AB` |
   | Success | `#1B6E3C` | `#7FDB9A` |
   | Warning | `#7A5800` | `#F2C24B` |

2. Checked contrast: every text pair is at least 5.1:1. Outlines are at
   least 3.3:1.
3. Shape: pill buttons, 12dp fields, 16dp cards, 28dp sheets and dialogs.
4. Density: compact, on a 4dp grid.
   - Margins: 16dp on phones, 24dp on tablets.
   - Body text: 14sp.
   - Touch targets stay at least 48dp.
5. True black: raised surfaces use a lighter grey plus an outline, not
   shadows.
6. Type: the system font, six text styles, no bundled fonts.
7. App icons: adaptive, with a monochrome layer.

## Options rejected

- **Dynamic colour.** Reason not recorded.
- **Shadows on raised surfaces.** Reason not recorded. Note: the plan
  states this under "True black".
- **Bundled fonts.** Reason not recorded.

## Consequences

- Every screen has a light theme and a true-black dark theme
  ([CLAUDE.md](../../CLAUDE.md)).
- A unit test checks contrast. It fails a text pair under 4.5:1 and an
  outline pair under 3:1 (step 1.1 in
  [PROMPTS.md](../development/PROMPTS.md)).
- The Catalog app shows the colour, type, shape and spacing tokens.
- Open: the text-on-accent colour for the light theme. The plan gives it
  only for the dark theme.
- Open: whether "no shadows" applies to the light theme too.
- Open: the names and sizes of the six text styles, other than 14sp body
  text.
- Open: token names, and the rest of the details. They come in
  `docs/development/design-system.md` in Phase 1, step 1, which completes
  this record ([PROMPTS.md](../development/PROMPTS.md)).
