# 0031 The permission USE_BIOMETRIC for Android's system prompt

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 1, step 7, session A
  ([PROMPTS.md](../development/PROMPTS.md)). The owner decided the points
  below in that session, before any code. Claude wrote them down in the
  pull request that adds the recovery key screens. The record is Accepted
  when the owner accepts that pull request.

## Context

- Two keys of every app need the system prompt for every use: the Lock
  key of the app lock and the Recovery guard of the kept recovery key
  ([crypto-design.md](../security/crypto-design.md#the-system-prompt)).
- [0006](0006-tink-and-key-hierarchy.md) and crypto-design.md chose
  Android's own `BiometricPrompt` (`android.hardware.biometrics`) for the
  prompt, not the AndroidX Biometric library. The minimum is Android 13
  ([0002](0002-grapheneos-first-minimum-android-13.md)), where Android's
  own prompt takes a cipher and accepts a fingerprint or the device
  credential. The AndroidX library adds support for older Android, which
  is not needed, and needs a `FragmentActivity`, which the apps do not
  have.
- [0003](0003-kotlin-compose-material-3-navigation-3.md), point 4, still
  named AndroidX Biometric for the app lock.
- Showing the prompt needs the permission
  `android.permission.USE_BIOMETRIC`. Android grants it at install. The
  user is not asked. It gives access to no data. It lets an app show the
  system prompt and learn whether the user answered it.
- The APK rules check (`CheckApkRulesTask.kt`, owner-only) fails any app
  whose final manifest has any permission at all. No app is allowed one
  yet.
- Step 1.7, session A builds the recovery key screens as one module that
  every app uses, `core/security`. It is the first code that shows the
  prompt in an app. Catalog shows the screens with sample data and holds
  no keys ([AppName](../../android/core/crypto/src/main/kotlin/app/shkriuss/core/crypto/AppName.kt):
  no keys are derived for it).
- A new permission needs a decision record
  ([0001](0001-record-architecture-decisions.md), point 4).

## Decision

1. The system prompt is Android's own `BiometricPrompt`, with the
   authenticators `BIOMETRIC_STRONG` and `DEVICE_CREDENTIAL`. Only
   `core/security` shows it, and only for a step that `core/crypto` hands
   out.
2. `core/security` declares `USE_BIOMETRIC` in its own manifest. Every app
   that uses the module gets it, as every app that uses `core/notify` gets
   its three permissions ([0030](0030-how-core-notify-keeps-alarms.md),
   point 6).
3. Catalog removes it in its own manifest, together with the four screens
   of the module. Catalog draws the content of those screens on a page of
   its own and never shows the prompt.
4. No owner-only file changes now. The APK rules check gets a per-app
   allow list when Water, the first app that holds keys, is built:
   - step 2.4 builds the list, with the three permissions of
     `core/notify` for Water;
   - step 2.5 adds `USE_BIOMETRIC` for Water.

   The owner's sentences for both are in PROMPTS.md.
5. AndroidX Biometric is used nowhere. The app lock (step 1.7, session B)
   uses Android's own prompt too. Point 4 of 0003 is corrected to say so.
6. `USE_FINGERPRINT`, the older permission, is not declared. Android 13
   and later do not need it.

## Options rejected

- **AndroidX Biometric.** It supports older Android, which the apps do
  not run on, and needs a `FragmentActivity`. The apps are Compose apps
  with plain activities. It would also be a new dependency.
- **Each app declares the permission in its own manifest.** An app could
  forget it, and the prompt would then fail only on the phone. The module
  that shows the prompt declares what it needs, as `core/notify` does.
- **The allow list in the APK rules check now.** No app that holds keys
  exists yet. The owner chose to add the list with Water, in steps 2.4
  and 2.5.

## Consequences

- An app that uses `core/security` declares `USE_BIOMETRIC` through the
  module. The APK rules check fails that app until the owner allows the
  permission for it (step 2.5 for Water).
- [permissions.md](../security/permissions.md) lists the permission and
  the four screens under "Apps that use core/security".
- The test APK of `core/crypto` keeps its own `USE_BIOMETRIC` for the
  emulator tests of the prompt. It is never part of an app.
- No library is added for the prompt.
