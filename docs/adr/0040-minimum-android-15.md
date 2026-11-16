# 0040 Minimum Android 15

- Status: Accepted
- Date: 2026-11-16
- Source: the owner's decision of 2026-11-16, and the owner's answers on
  the pull request that made the change. It supersedes point 2 of
  [0002](0002-grapheneos-first-minimum-android-13.md), the sentence of
  point 3 of [0006](0006-tink-and-key-hierarchy.md) on Android 13 and 14,
  and the required emulator checks named in the consequences of
  [0028](0028-instrumented-tests-own-runner-and-shell-steps.md).

## Context

- The owner uses the apps only on GrapheneOS, which runs the newest
  Android. GrapheneOS ships no version older than Android 15.
- Point 2 of 0002 set the minimum at Android 13 (API 33).
- Android 12 to 14 delete keys made with `setUnlockedDeviceRequired(true)`
  when the screen lock is removed, and cannot make them without one.
  Android 15 fixed this. So 0006 gave Android 13 and 14 a second key
  layout: no Unlocked key, and the Background key wrapped `backup` and
  `file-key` in its place. A phone updated to Android 15 moved them under
  a new Unlocked key at the app's next start.
- Android 13 has no way to keep a window from accessibility services that
  are not accessibility tools. The security screens could do that only on
  Android 14 and later.
- The emulator tests ran on Android 13, 14, 15 and 17. The jobs for 13,
  14 and 15 were required checks (0028).
- Water 1.0.0 was released with the minimum Android 13.

## Decision

1. The minimum version is Android 15 (API 35). Target and compile SDK
   stay 37 (point 3 of 0002).
2. One key layout. The Unlocked key always exists when it is first
   needed. It wraps `backup`, `file-key-old`, and `file-key` while the app
   lock is off. The Background key wraps `record` only.
3. No keyset moves from the Background key to the Unlocked key at start.
   A reader refuses `backup`, `file-key` and `file-key-old` under the
   Background key, as it refuses every other pair that is not allowed
   ([crypto-design.md](../security/crypto-design.md#keysets)).
4. The security screens always mark their windows so that only
   accessibility tools may read them.
5. The emulator tests run on Android 15 and Android 17 only.
   "Emulator (Android 15)" is a required check. "Emulator (Android 17)"
   stays not required ([ci.md](../development/ci.md#the-emulator-jobs)).

## Options rejected

- **Keep the minimum at Android 13.** The owner's devices run the newest
  Android, GrapheneOS ships no older one, and one key layout is simpler
  than two.
- **Keep reading the old layout.** A reader would go on accepting
  `backup`, `file-key` and `file-key-old` under the Background key, for a
  phone where an app ran on Android 13 or 14 and was not started again
  before its update. The owner chose to refuse them.

## Consequences

- Phones on Android 14 or older cannot install the apps or their
  updates. A phone that has Water 1.0.0 keeps it.
- A phone where Water 1.0.0 ran on Android 13 or 14, and that got
  Android 15, moved Water's keysets at Water's next start with the phone
  unlocked. If Water was updated before such a start, its `backup`
  keyset is read as damaged. The security screen then offers to repair
  it with the recovery words, and nothing is lost. An app with files
  would also lose the files that only `file-key-old` opened. Water has
  none.
- Signing does not change. apksigner still signs with scheme v3 only,
  and a key rotation needs no v3.1 block
  ([0037](0037-signing-key-rotation.md)).
- The deviation "no accessibility marking on Android 13" leaves the
  [threat model](../security/threat-model.md).
- The tests of the Android 13 and 14 layout and of the move are removed.
  They tested behaviour that no longer exists.
- The owner takes "Emulator (Android 13)" and "Emulator (Android 14)" out
  of the required checks
  ([ci.md](../development/ci.md#the-emulator-jobs)).
- The [plan](../plan/PLAN.md) still names Android 13. It is kept as
  history ([0001](0001-record-architecture-decisions.md), point 6).
