# 0039 No manual checklist for a release

- Status: Accepted
- Date: 2026-11-15
- Source: the owner's decisions on
  [pull request 46](https://github.com/shkriuss/shkriuss.app/pull/46).
  It supersedes point 4 of
  [0002](0002-grapheneos-first-minimum-android-13.md), the decision of
  [0025](0025-secure-app-spawning-in-grapheneos-checklist.md), and the
  sentence of [0011](0011-no-native-code-grammar-exception.md) that
  Grammar passes the same GrapheneOS checklist.

## Context

- Point 4 of 0002 asked every release to pass a GrapheneOS checklist on
  the owner's devices: the exploit protections, the network and sensors
  permissions, a secondary user profile and Private Space, the layout on
  the Pixel Tablet and the Pixel 6a, and reminders after a restart. 0025
  added secure app spawning. 0011 says that Grammar passes the same
  checklist.
- The owner is the only user of the apps for now. The owner wants to
  build the apps fast, with the automatic checks as the safety net.
- These run by themselves: unit tests, lint, screenshot checks and the
  emulator tests in CI ([ci.md](../development/ci.md)), the APK rules
  check ([build.md](../development/build.md#apk-rules-check)),
  dependency verification
  ([0020](0020-dependency-verification.md)), and the release workflow
  ([release.md](../development/release.md)).
- An emulator cannot check GrapheneOS, its exploit protections, a second
  profile, Private Space or StrongBox
  ([emulator-tests.md](../development/emulator-tests.md#what-an-emulator-cannot-check)).
- GrapheneOS shows these protections on an app's **App info**, under
  **Exploit protection**. Its exploit protection compatibility mode
  turns some of them off for that app.

## Decision

1. No release waits for a manual checklist, and no page records what was
   checked on which device. The automatic checks and the audit before a
   release stand in ("How an app is built" in
   [CLAUDE.md](../../CLAUDE.md#how-an-app-is-built), and
   [Before and after a release](../development/release.md#before-and-after-a-release)).
2. The owner runs every release on GrapheneOS with its exploit
   protection left on, and never turns on the exploit protection
   compatibility mode for an app of the suite.
3. A fault that shows only with the hardening on is a bug. It is fixed
   before the next release.
4. This is decided again when someone other than the owner uses the
   apps, and before the first release of Grammar, because of its native
   code ([0011](0011-no-native-code-grammar-exception.md)).

## Options rejected

- **Keep the checklist for every release.** The owner is the only user
  for now, and wants to build fast with the automatic checks as the
  safety net. A checklist for each version, and a record of what was
  checked where, is manual ceremony that holds each release back.

## Consequences

- What only a device shows is no longer checked before each release: the
  exploit protections, a secondary user profile, Private Space,
  reminders after a restart, StrongBox, and the layout on the tablet and
  the small phone. For the exploit protections, the owner's own use of
  every release, with the hardening on, is what remains.
- A fault that the hardening shows is fixed in the code. Turning a
  protection off is never the fix.
- Point 4 of 0002, the decision of 0025 and the sentence of 0011 are
  marked as superseded by this record. The rest of 0002 stays: GrapheneOS
  first, a minimum of Android 13, and every app works in a secondary
  user profile and in Private Space.
- [threat-model.md](../security/threat-model.md) and
  [crypto-design.md](../security/crypto-design.md) say what this leaves
  unchecked.
