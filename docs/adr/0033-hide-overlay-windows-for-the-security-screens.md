# 0033 The permission HIDE_OVERLAY_WINDOWS for the security screens

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 1, step 1.10
  ([PROMPTS.md](../development/PROMPTS.md#110-overlays-and-accessibility-data-on-the-security-screens)).
  The owner decided the points below in that session, before any code.
  Claude wrote them down in the pull request of step 1.10.

## Context

- Point 7 under "Found while writing this page" in the
  [threat model](../security/threat-model.md#found-while-writing-this-page):
  - no screen was protected against another app that draws over it
    (MASWE-0039);
  - no screen told accessibility services that its content is sensitive
    (MASWE-0040).
- The screens are the six screens of `core/security`, their dialogs, and
  the lock screen of the app lock
  ([security-screens.md](../architecture/security-screens.md)).
- What Android 13 to 17 offers. Checked on 2026-11-13 against Android's
  reference pages, its page on tapjacking, and the AOSP source:
  1. **Android 12 and later, for every app**: a tap that passes through
     another app's window is blocked if that window is more than 80%
     opaque. A window that is 80% opaque or less lets the tap through.
     Nothing stops a window on top from showing something false.
  2. **`Window.setHideOverlayWindows(true)`**, Android 12 and later:
     - While the window shows, Android hides the windows that other apps
       draw over other apps.
     - It needs the permission `HIDE_OVERLAY_WINDOWS`.
     - In AOSP's core manifest, that permission's protection level is
       `normal`. Android grants it at install, the user is not asked, and
       it gives access to no data.
     - Without it, `Window` throws a `SecurityException`.
  3. **`filterTouchesWhenObscured`**, every version: a tap is dropped
     where another app's visible window covers the view.
  4. **`View.setAccessibilityDataSensitive`**, Android 14 and later:
     - Only accessibility services that declare `isAccessibilityTool`
       may read the view or act on it.
     - From Android 16, the other services' gestures are blocked too.
     - On Android 14 and later, `filterTouchesWhenObscured` turns it on
       by itself.
  5. **Who counts as a tool**:
     - AOSP reads `isAccessibilityTool` only from the service's own XML.
       Any app can declare it.
     - The public TalkBack source, last pushed in March 2026, does not
       declare it.
     - So whether TalkBack keeps these screens can only be shown on a
       phone.
  6. **Android 16 and 17** add nothing against overlays.
- The APK rules check (`CheckApkRulesTask.kt`, owner-only) fails every
  app whose final manifest has any permission. Water gets an allow list
  in step 2.4. Step 2.5 adds `USE_BIOMETRIC` to it
  ([0031](0031-use-biometric-for-the-system-prompt.md)).
- A new permission needs a decision record
  ([0001](0001-record-architecture-decisions.md), point 4).

## Decision

1. **The six screens of `core/security`** (the security screen, create,
   enter, show, the app lock screen and turning the app lock on):
   1. They hide other apps' windows while they show.
   2. They ignore a tap where another app's window covers them.
   3. On Android 14 and later, only accessibility tools may read them or
      act on them.
2. **Their four dialogs** (give up the files, start over, when the app
   locks, turn off the app lock) take the protection of the screen they
   open over. The screen behind them hides other apps' windows.
3. **The lock screen of the app lock** hides other apps' windows while
   the app is locked. It does nothing else.
4. **The permission**: `core/security` declares `HIDE_OVERLAY_WINDOWS` in
   its manifest, as it declares `USE_BIOMETRIC`. Every app that uses the
   module gets it. Catalog removes it in its own manifest.
5. **Without the permission, no screen crashes.** It does not hide other
   apps' windows, and keeps the rest. The missing permission is still
   caught:
   - Now: the unit test `ManifestTest` in `core/security` fails unless
     the module asks for exactly `USE_BIOMETRIC` and
     `HIDE_OVERLAY_WINDOWS`.
   - From step 2.5: a rule of the APK rules check. An app whose merged
     manifest declares a screen of `core/security` must request both
     permissions, or its build fails. The owner's sentence for it is in
     [PROMPTS.md](../development/PROMPTS.md#22-to-25-build-it), step 2.5.
6. **An ignored tap shows nothing.** The user guide explains it.
7. **The accessibility marking needs the owner's check.** It stays only
   if TalkBack reads these screens on the owner's phone, with the Catalog
   preview of the pull request. If TalkBack cannot read them, the screens
   are marked "not sensitive" instead, and this record and the threat
   model say so.
8. What is not done is written as accepted deviations in the
   [threat model](../security/threat-model.md#platform), under PLATFORM-3.

## Options rejected

- **No permission.** A fake screen drawn over the words or the system
  prompt would stay possible.
- **Hiding other apps' windows on every screen of an app.** A dimmer or
  a floating button would vanish whenever the app is open. The other
  screens show records, not keys.
- **Refusing a tap when the window is only partly covered**
  (`FLAG_WINDOW_IS_PARTIALLY_OBSCURED`). It refuses taps whenever any
  other window overlaps the screen anywhere, for example a video in
  picture-in-picture.
- **A notice on the screen when a tap is ignored.** With other apps'
  windows hidden, it almost never happens. It would add text and
  screenshot tests to six screens.
- **Each app declares the permission itself.** An app could forget it,
  as in [0031](0031-use-biometric-for-the-system-prompt.md).

## Consequences

- While a screen of `core/security` shows, and while an app is locked,
  other apps' floating windows disappear: screen dimmers, chat heads,
  the buttons of other apps' screen recorders. They come back after.
  Android's own windows stay: the status bar, the keyboard, TalkBack,
  notifications and the system prompt.
- On Android 14 and later, an assistive app that does not declare itself
  an accessibility tool cannot read these screens. A harmful service can
  falsely claim to be a tool.
- Step 2.5 adds `HIDE_OVERLAY_WINDOWS` for Water to the allow list of the
  APK rules check, next to `USE_BIOMETRIC`, and the rule of point 5.
- Docs:
  - [permissions.md](../security/permissions.md) lists the permission
    under "Apps that use core/security", and Catalog's removal;
  - [security-screens.md](../architecture/security-screens.md#overlays-and-accessibility-services)
    says how it is built;
  - the user guide says what the user sees.
- No library is added.
