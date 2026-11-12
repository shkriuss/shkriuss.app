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

- `core/crypto`: the four kinds of hardware key
  ([What the hardware key tests must cover](#what-the-hardware-key-tests-must-cover)).
  This is step 1.4, session C in [PROMPTS.md](PROMPTS.md).
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

## What the hardware key tests must cover

Step 1.4, session B built `core/crypto` with unit tests on the JVM. No
Android Keystore exists there, so the tests use a software stand-in for
the hardware keys. The class that talks to the real Keystore,
`AndroidHardwareKeys`, has never run. Session C tests it on an emulator,
on Android 13, 14, 15 and the newest image. This is item 9 of "What the
tests must cover" in
[crypto-design.md](../security/crypto-design.md#what-the-tests-must-cover).

What session B could not test, and session C must:

1. **Making each kind of key** with the settings of the page's table, and
   using it. For the Lock key and the Recovery guard: through the system
   prompt, if a test on an emulator can answer it.
2. **The order of calls for a key that needs the prompt.** The cipher is
   started before the prompt, the associated data is given only after
   it, and after encrypting the IV is read from the cipher.
3. **"Does this key exist".** `KeyStore.getKey` answers "no" only for
   "not found", and throws for every other failure, on every Android
   version. Tink's `hasKey` is not used for this.
4. **The list of keys.** `KeyStore.aliases` shows the app's keys. When
   the Keystore fails, the list comes back empty or short, as read in
   Android 14's source. The code never takes that as proof that a key is
   gone, makes no key without asking for the exact alias first, and
   deletes only keys the list shows. The unit tests cover these three
   rules with the stand-in (`HardwareKeyRulesTest`). The emulator tests
   confirm what the real Keystore answers.
5. **Which failure is which.** A refused tag arrives as
   `BadPaddingException` and counts as "damaged or changed". A key that
   is permanently invalidated arrives as
   `KeyPermanentlyInvalidatedException` from the cipher and counts as
   "gone". A key that fails to load counts as "not usable now". Every
   other failure counts as "not usable now" too.
6. **The table "When things change".** After the screen lock is set,
   changed, removed and set again, each key is there or gone as the table
   says.
7. **The Unlocked key** on Android 15 and later: usable while the phone
   is unlocked, refused while it is locked. That no Unlocked key is made
   on Android 13 and 14.
8. **A key's security level** from `KeyInfo`. An emulator has a
   software-only Keystore.
9. **Replacing a keyset file.** Flushing the file, renaming it and
   flushing the folder work on a real file system of each Android
   version. The folder is flushed through a `FileChannel` that is opened
   on the folder.
10. **The vectors on a device.** A JVM test never runs Tink's Android
    code path: Tink asks Java for its vendor to tell Android from a
    desktop. So the vectors of crypto-design.md should run on the
    emulator too, where Tink uses the `AndroidOpenSSL` provider.
11. **The word list in an app.** `english.txt` loads from the app's Java
    resources on a device.

What an emulator cannot check, such as StrongBox and a real fingerprint,
becomes numbered steps for the owner's three devices.

## Open

- Which AOSP images exist for API 33 and API 37 on x86_64, and whether the
  smaller "ATD" test images exist for them. If API 37 has only Google APIs
  images, stop and ask the owner.
- Whether Gradle Managed Devices runs reliably on GitHub's standard
  runners at these API levels.
- Whether emulator tests run on every pull request or only when `android/`
  changes, and whether they become a required check.
