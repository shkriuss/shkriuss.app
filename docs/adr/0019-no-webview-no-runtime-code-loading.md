# 0019 No WebView, no runtime code loading

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1 and 16, hard rule 1 in
  [CLAUDE.md](../../CLAUDE.md), and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- The plan rules out WebView (section 1).
- WebView and runtime code loading are both large attack surfaces.
- Every release is checked on GrapheneOS with dynamic code loading via
  memory and via storage restricted, WebView JIT restricted, and native
  code debugging blocked (section 16).

## Decision

1. No app uses a WebView.
2. No app loads code at run time. That means no `DexClassLoader`, no
   downloaded code and no plugins.

## Options rejected

- **A WebView for help pages or rich text.** A WebView is a large attack
  surface.
- **Plugin systems.** They load code at run time, which is a large attack
  surface.

## Consequences

- Without WebView and runtime code loading, and without native code,
  GrapheneOS's strictest per-app settings need nothing from the apps.
- Native code and its one exception, Grammar, are in
  [0011](0011-no-native-code-grammar-exception.md).
- Help pages and rich text are shown without a WebView.
