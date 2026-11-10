# 0011 No native code, Grammar exception

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 7), 3 and 16

## Context

- The database driver was chosen with no bundled native code (section 3,
  and [0004](0004-room-on-system-sqlite-no-sqlcipher.md)).
- Every release is checked on GrapheneOS with the hardened memory
  allocator and memory tagging on, and native code debugging blocked
  (section 16).

## Decision

1. No native libraries and no JNI in any app or module.
2. The one exception is Grammar, `android/app/grammar`. It uses the Harper
   engine, written in Rust. It runs on the device, with no language model.
3. Grammar is the only app with native code. It is built last, in Phase 9.

## Options rejected

- **A language model for Grammar.** Reason not recorded.

## Consequences

- Every other app and module ships no native code.
- Before any Grammar code, its Rust build, its supply chain and its memory
  tagging tests need their own design doc and the owner's approval
  ([PROMPTS.md](../development/PROMPTS.md)).
- Grammar passes the same GrapheneOS checklist as every other app. See
  [0002](0002-grapheneos-first-minimum-android-13.md).
