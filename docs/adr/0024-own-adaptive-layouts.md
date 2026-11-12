# 0024 Own adaptive layouts, no Material 3 adaptive libraries

- Status: Accepted
- Date: 2026-11-12
- Source: the owner's decisions on
  [pull request 16](https://github.com/shkriuss/shkriuss.app/pull/16),
  Phase 1, step 2, batch 4 in [PROMPTS.md](../development/PROMPTS.md).
  It replaces part of point 2 of
  [0003](0003-kotlin-compose-material-3-navigation-3.md).

## Context

- Layouts adapt by window size class
  ([CLAUDE.md](../../CLAUDE.md), "UI and accessibility").
- Batch 4 of the design system needed a top bar, a navigation bar and
  rail that switch by window size, and a list-and-detail layout.
- Point 2 of [0003](0003-kotlin-compose-material-3-navigation-3.md)
  names "Material 3 and its adaptive libraries". Those libraries
  (`material3-adaptive`, `material3-adaptive-navigation-suite` and
  `material3-window-size-class`) were never added to the build.
- Adding them would change the version catalog and the dependency
  verification metadata, which only the owner changes
  ([0020](0020-dependency-verification.md)).
- Fewer dependencies is a goal of the project (the owner, on pull
  request 16).
- Material 3, Compose and AndroidX Activity, already in the build, have
  what the layouts need: the size of the window, layouts, the system bar
  insets, saved state and the back gesture.

## Decision

1. `core/design` builds its own adaptive layouts. It does not use
   Material 3's adaptive libraries.
2. `ShkWindowWidth` holds Android's three window size classes for width:
   compact under 600dp, medium from 600dp, expanded from 840dp. It reads
   the width of the app's window.
3. `ShkNavigationScaffold` shows a navigation bar along the bottom in a
   compact window, and a navigation rail along the start edge in a medium
   or expanded one.
4. `ShkListDetailScaffold` shows one pane under 840dp: the list, or the
   open item in its place. From 840dp it shows the list, 360dp wide,
   beside the item.
5. They switch at the same widths as Material 3's adaptive layouts, so
   the apps adapt as the rest of the system does.
6. The back gesture in one pane uses AndroidX Activity's `BackHandler`.
   `core/design` declares Activity Compose for it. It is already part of
   the stack, so it needs no record of its own (owner decision on pull
   request 16).
7. Not decided here: whether the apps use Navigation 3. That is decided
   when the first app is built.

## Options rejected

- **Material 3's adaptive libraries.** More dependencies to add, verify
  and update, for layouts the suite can build from parts it already has.
  Fewer dependencies is a goal of the project.

## Consequences

- The layouts and their tests are code the project maintains, in
  `core/design`.
- Apps use only the `Shk*` layouts. If the project adds the adaptive
  libraries later, `core/design` can use them inside without changing
  the apps.
- The suite's layouts do without what the adaptive libraries add, such
  as:
  - panes that keep clear of the hinge of a foldable, and layouts for a
    foldable half open,
  - a third, supporting pane,
  - panes the user can resize,
  - animation between panes, also while the back gesture is in progress.
- Look at this decision again when one of these is needed. For example:
  - when the suite is to support foldable devices properly,
  - when an app needs a supporting pane or resizable panes,
  - when Navigation 3 is chosen and its list-and-detail layouts would
    replace these.
- Point 2 of [0003](0003-kotlin-compose-material-3-navigation-3.md) now
  points here for the adaptive libraries. The rest of 0003 stands.
- How the layouts look and behave is in
  [design-system.md](../development/design-system.md).
