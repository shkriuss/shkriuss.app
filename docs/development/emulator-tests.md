# Emulator tests

Status: planned for Phase 1. Nothing here runs yet.

Phase 0, step 4 asked for an emulator job on API 33 and the newest image,
but only if an instrumented test exists. None does: no module has a
`src/androidTest/` folder. So there is no emulator job yet. This page is the
plan for adding it.

Emulator tests run only in GitHub Actions. The cloud environment has no KVM,
so it cannot run an emulator ([cloud-environment.md](cloud-environment.md)).

## When to add it

With the first instrumented test. Phase 1 will likely bring the first ones:

- `core/notify`: alarms that fire, and alarms registered again after a
  reboot or a time change (the Phase 1 gate in the [plan](../plan/PLAN.md),
  section 16).
- Compose accessibility checks, which section 11 of the plan puts in
  emulator tests.

Until then, the JVM tests with Robolectric cover what they can.

## The plan

1. **Where.** A third job, "Emulator", in `.github/workflows/ci.yml`. It
   runs on pull requests and on pushes to `main`, after "Gradle wrapper",
   like "Check".
2. **Which Android versions.** Two jobs side by side: API 33, the minimum
   SDK, and API 37, the target SDK and the newest image.
3. **No Google services.** AOSP system images only, never the Google APIs or
   Google Play images (hard rule 3).
4. **How the emulator starts.** Through the Android Gradle Plugin's Gradle
   Managed Devices. The devices are declared in a new convention plugin in
   `build-logic`. Gradle downloads the system image, starts the emulator,
   runs the tests and stops it. This needs no action at all. The usual
   third-party action, `reactivecircus/android-emulator-runner`, is not
   allowed (only GitHub's own actions).
5. **If Managed Devices does not work** on GitHub's runners: short shell
   steps with `sdkmanager`, `avdmanager`, `emulator` and `adb` instead.
6. **KVM.** GitHub's Linux runners have it, but the runner user needs
   access. One step adds a udev rule:

   ```bash
   echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
   sudo udevadm control --reload-rules
   sudo udevadm trigger --name-match=kvm
   ```

7. **Same rules as every job.** Read-only token, a timeout (about 45
   minutes), a concurrency group, the download cache restored but not
   saved.
8. **On failure.** Upload the test reports and the emulator's log, as
   "Check" does with screenshot differences.

## What it needs first

1. Test libraries: at least `androidx.test:runner` and
   `androidx.test.ext:junit`, and, for the accessibility checks, the
   Accessibility Test Framework that Compose's `enableAccessibilityChecks()`
   uses. Each new dependency needs an ADR, a version catalog entry and new
   verification metadata in the same pull request (hard rule 5).
2. A convention plugin, for example `shkriuss.android.instrumented-test`,
   that sets the test runner and the managed devices.
3. The first instrumented test.

## Open

- Which AOSP images exist for API 33 and API 37 on x86_64, and whether the
  smaller "ATD" test images exist for them. If API 37 has only Google APIs
  images, stop and ask the owner.
- Whether Gradle Managed Devices runs reliably on GitHub's standard
  runners at these API levels.
- Whether emulator tests run on every pull request or only when `android/`
  changes, and whether they become a required check.
