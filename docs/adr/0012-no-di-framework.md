# 0012 No DI framework

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 16), 3 and 4, and
  the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- Each app is built from shared core and feature modules (section 4).
- Nothing is used at runtime without a decision record (section 3).

## Decision

1. No dependency-injection framework.
2. Dependencies are passed through constructors. No service locators. No
   global mutable state ([CLAUDE.md](../../CLAUDE.md)).

## Options rejected

- **Hilt.** Annotation processing and generated code that a project this
  size does not need.
- **Koin.** A service locator. Mistakes show at run time, not at compile
  time. CLAUDE.md forbids service locators.

## Consequences

- Objects are created and connected by plain Kotlin code.
- Tests pass in fakes through constructors, for example a clock and an ID
  source that the test controls (step 1.3 in
  [PROMPTS.md](../development/PROMPTS.md)).
