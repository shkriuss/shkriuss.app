# 0002 GrapheneOS first, minimum Android 13

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 8), 13, 16
  and 17

## Context

- The suite is a set of native Android apps.
- The owner's test devices are:
  - Pixel 9 Pro: the main device, with memory tagging.
  - Pixel Tablet: the large screen.
  - Pixel 6a: the small screen, the oldest hardware, and the second sync
    device.

## Decision

1. GrapheneOS is the first target. Other Android systems come second.
2. The minimum version is Android 13 (API 33).
3. The target SDK and the compile SDK are 37.
4. Every release passes this GrapheneOS checklist, on the Pixel 9 Pro
   unless noted:
   - Hardened memory allocator on, memory tagging on.
   - Dynamic code loading via memory and via storage restricted.
   - Native code debugging blocked. WebView JIT restricted.
   - Network permission revoked (data apps declare none anyway).
   - Sensors permission revoked.
   - Works in a secondary user profile and in Private Space.
   - Layout check on Pixel Tablet and Pixel 6a.
   - Reminders fire on time with the screen off, after reboot and unlock.

## Options rejected

None recorded.

## Consequences

- Devices on Android 12 or older cannot install the apps.
- Every supported device has APK signature scheme v3.1, which key rotation
  uses (section 13, and
  [0013](0013-signing-key-custody-and-rotation.md)).
- Every app must work in a secondary user profile and in Private Space. See
  [0010](0010-exact-alarms-and-reminder-storage.md) for what that means for
  reminders.
- Stock Android users install without Google developer registration. See
  [0016](0016-no-google-developer-registration-for-now.md).
- Open: the exact compile SDK, 37.0 or a later minor, that the Android
  Gradle Plugin and Robolectric support. In a test build, `compileSdk = 37`
  with `platforms;android-37.0` and `build-tools;36.0.0` worked
  (section 17).
