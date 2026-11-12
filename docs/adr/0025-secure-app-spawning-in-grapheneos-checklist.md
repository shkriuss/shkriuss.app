# 0025 Secure app spawning in the GrapheneOS checklist

- Status: Accepted
- Date: 2026-11-12
- Source: the owner's decision on
  [pull request 19](https://github.com/shkriuss/shkriuss.app/pull/19),
  after Catalog 0.2.0, the first release with the
  [release checklist](../development/release-checklist.md). It extends
  point 4 of [0002](0002-grapheneos-first-minimum-android-13.md).

## Context

- Point 4 of [0002](0002-grapheneos-first-minimum-android-13.md) lists
  the GrapheneOS checklist that every release passes. Of the exploit
  protections, it names the hardened memory allocator, memory tagging,
  dynamic code loading, native code debugging and WebView JIT.
- GrapheneOS lists these on an app's **App info**, under **Exploit
  protection**. That section has one more setting, **Secure app
  spawning**. On the owner's Pixel 9 Pro, Catalog 0.2.0 showed it as
  "Default (Enabled)".
- 0002 does not name it, so the release checklist did not check it.
- Secure app spawning is one of GrapheneOS's default protections, so
  users run apps with it on. A test phone can have it turned off for an
  app and forgotten.

## Decision

1. Every release also checks, on the Pixel 9 Pro, that **Secure app
   spawning** is on for the app. On **App info**, under **Exploit
   protection**, it says Enabled. "Default (Enabled)" counts.
2. The rest of 0002 stays as it is.

## Options rejected

- **Keep the checklist as 0002 lists it.** A release could then be tested
  in a state that users do not run: with secure app spawning off on the
  test phone.

## Consequences

- The [release checklist](../development/release-checklist.md) checks it
  in part 1, step 2, with the hardened memory allocator and memory
  tagging. The step numbers stay the same.
- 0002 says that this record extends its point 4.
- A release whose app works only with secure app spawning turned off
  does not pass the checklist.
- Catalog 0.2.0 was released before this record. The owner's screenshot
  after the release shows it on for Catalog
  ([release checklist 0.2.0](../apps/catalog/release-checklist-0.2.0.md)).
