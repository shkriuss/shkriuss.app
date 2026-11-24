# Third-party material

What others made and the apps contain: where it comes from, its licence
and its notice.

- Status: complete for Water, Reminders and Tasks: everything that
  ships in the release APK of Water `1.0.2`, of Reminders `1.0.1` and
  of Tasks `1.0.0-alpha.1`, and the screen that shows it in each app.
  [How to check again](#how-to-check-again) says how to keep it right.
- The project's own licences are in
  [ADR 0018](../adr/0018-licences.md).

## At a glance

| Part | Choice |
|---|---|
| What counts | What is in an app's release APK. A library that the build removes is listed here too, as not shipped. |
| In the app | **Settings**, **Licences**: one entry for each part that ships, with its notice and the full text of its licence. Each app keeps its own list and texts (the owner's decision). |
| Licence texts | In the app as files, byte for byte as their source has them. A test checks their SHA-256. |
| How the list is made | From Gradle's list of the release runtime class path, then checked in the APK itself |
| After a dependency change | Make the list again, and change this page, the app's list and its texts together |

## What ships in Water

Seven parts, in the release APK of Water `1.0.2`
([How the list is made](#how-the-list-is-made)).

| Part in the app's list | Version | Licence | What it is in Water |
|---|---|---|---|
| [AndroidX libraries](#androidx-libraries) | See its section | Apache-2.0 | Activity, Lifecycle, Room, SQLite and the other Jetpack libraries |
| [BIP-39 English word list](#bip-39-english-word-list) | Commit `b57a5ad7` | MIT | The words of a recovery key, in `core/crypto` |
| [Jetpack Compose and Material 3](#jetpack-compose-and-material-3) | Compose 1.12.1, Material 3 1.4.0 | Apache-2.0 | Every screen, through `core/design` |
| [Kotlin standard library](#kotlin-standard-library) | 2.4.21 | Apache-2.0 | The language's own library |
| [kotlinx.coroutines](#kotlinxcoroutines) | 1.9.0 | Apache-2.0 | Work off the main thread, and flows |
| [Protocol Buffers, inside Tink](#protocol-buffers-inside-tink) | 4.33.6 | BSD 3-Clause | Tink reads and writes keysets with it |
| [Tink for Java](#tink-for-java) | 1.24.0 | Apache-2.0 | All cryptography, in `core/crypto` |

The app's list is `Licences` in `android/feature/water`. `LicencesTest`
checks that it has these seven, each with a name, a notice and a licence
text.

## What ships in Reminders

The same seven parts, in the same versions, in the release APK of
Reminders `1.0.1`. Its release runtime class path is the same as
Water's, and so is what R8 removes
([How the list is made](#how-the-list-is-made)).

The app's list is `Licences` in `android/feature/reminders`, with its own
notices and licence texts in that module's `res/raw`. The owner decided
that each app keeps its own list, and that no shared module holds it.
`LicencesTest` of Reminders checks the seven, as Water's does.

## What ships in Tasks

The same seven parts, in the same versions, in the release APK of
Tasks `1.0.0-alpha.1`, which is not released. Its release runtime class
path is the same as Water's and Reminders', and so is what R8 removes
([How the list is made](#how-the-list-is-made)).

The app's list is `Licences` in `android/feature/tasks`, with its own
notices and licence texts in that module's `res/raw`, as the owner
decided for every app. `LicencesTest` of Tasks checks the seven, as
Water's does.

## On the class path, not in the APK

Seven libraries are on the release runtime class path of Water, of
Reminders and of Tasks, and R8 removes all of them, because nothing in
these apps uses them. No class of theirs is
named in the APK's dex files. They are not in the app's list.

| Library | Version | Licence | Who brings it |
|---|---|---|---|
| [Gson](#gson) | 2.13.2 | Apache-2.0 | Tink |
| [JSR-305 annotations](#jsr-305-annotations) | 3.0.2 | BSD 3-Clause at its source. Its listing says Apache-2.0. | Tink |
| [Error Prone annotations](#error-prone-annotations) | 2.41.0 | Apache-2.0 | Tink, Gson |
| [Guava ListenableFuture](#guava-listenablefuture) | 1.0 | Apache-2.0 | AndroidX (`concurrent-futures`, `core`, `profileinstaller`) |
| [JetBrains annotations for Java](#jetbrains-annotations-for-java) | 23.0.0 | Apache-2.0 | The Kotlin standard library, kotlinx.coroutines |
| [JSpecify annotations](#jspecify-annotations) | 1.0.0 | Apache-2.0 | AndroidX and Compose |
| [kotlinx.serialization](#kotlinxserialization) | 1.7.3 | Apache-2.0 | AndroidX (`savedstate`, `lifecycle-viewmodel-savedstate`) |

If a later change makes one of them ship, it must get an entry in each
app's list that ships it, in the same pull request. [How to check again](#how-to-check-again)
says how to see it.

In Catalog, Tink and Protocol Buffers are not in the APK either: Catalog
never calls them. The published `catalog-v0.3.0.apk` shows this. From
version 0.3.0, Catalog's sample recovery words come from the word list,
so the word list and its `LICENSE.txt` are in Catalog's APK.
Catalog has no Licences screen. That is [open](#open).

## The licence texts in the app

Three files in `android/feature/water/src/main/res/raw/`, and the same
three in `android/feature/reminders/src/main/res/raw/`, named
`reminders_licence_<part>.txt`, and in
`android/feature/tasks/src/main/res/raw/`, named
`tasks_licence_<part>.txt`. Each is byte for byte the file of its
source. Each app's `LicencesTest` checks the SHA-256.

| File | The source's file | SHA-256 |
|---|---|---|
| `water_licence_apache_2_0.txt` | `https://www.apache.org/licenses/LICENSE-2.0.txt`. The `LICENSE` files of Tink (tag `v1.24.0`) and of Kotlin (tag `v2.4.21`, `license/LICENSE.txt`) are the same bytes. | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `water_licence_protobuf.txt` | `LICENSE` of `protocolbuffers/protobuf`, tag `v33.6` | `6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d` |
| `water_licence_bip39.txt` | `LICENSE` of `trezor/python-mnemonic`, as it is next to the word list in `core/crypto` | `d5e3c7c62a84e80073201e2f6e5130e9e6804fa05f8ac4f8b26a13c7d3969697` |

- The Apache-2.0 text is shown once for each of the five parts under it.
- The notice of each part is a file of its own in the same folder,
  `water_notice_<part>.txt`, `reminders_notice_<part>.txt` and
  `tasks_notice_<part>.txt`. They differ only in the app they name. It says whose the part is, with the copyright
  lines read at the source, and where the source is. The notices are
  written for this project; only the copyright lines and Kotlin's
  `NOTICE` lines are quoted.
- All of these files are in the release APK, with the same SHA-256.
  The build gives them short names there.
- Six small AndroidX libraries also bring their own `LICENSE.txt`, which
  the build keeps under `META-INF/androidx/` in the APK: `annotation`,
  `collection`, `collection-ktx`, `lifecycle-common`,
  `lifecycle-common-java8` and `room3-common`.

## AndroidX libraries

The Jetpack libraries of the Android Open Source Project.

- **Artifacts and versions**, from Google's Maven repository:

  | Group | Version |
  |---|---|
  | `androidx.activity` | 1.13.0 |
  | `androidx.annotation` | 1.9.1, `annotation-experimental` 1.5.0 |
  | `androidx.arch.core` | 2.2.0 |
  | `androidx.autofill` | 1.0.0 |
  | `androidx.collection` | 1.5.0 |
  | `androidx.concurrent` (`concurrent-futures`) | 1.1.0 |
  | `androidx.core` | 1.18.0, `core-viewtree` 1.0.0 |
  | `androidx.customview` (`customview-poolingcontainer`) | 1.0.0 |
  | `androidx.emoji2` | 1.4.0 |
  | `androidx.graphics` (`graphics-path`) | 1.0.1 |
  | `androidx.interpolator` | 1.0.0 |
  | `androidx.lifecycle` | 2.11.0 |
  | `androidx.navigationevent` | 1.0.0 |
  | `androidx.profileinstaller` | 1.4.0 |
  | `androidx.room3` | 3.0.3 |
  | `androidx.savedstate` | 1.4.0 |
  | `androidx.sqlite` | 2.7.1 |
  | `androidx.startup` (`startup-runtime`) | 1.1.1 |
  | `androidx.tracing` | 1.2.0 |
  | `androidx.versionedparcelable` | 1.1.1 |
  | `androidx.window` | 1.5.0 |

- **Source:** <https://github.com/androidx/androidx>, the public copy of
  `https://android.googlesource.com/platform/frameworks/support`. The
  cloud environment can reach both, and both hold the same `LICENSE.txt`.
- **Licence:** Apache-2.0. The repository's `LICENSE.txt` is the Apache
  text without its appendix.
- **Notice:** the repository has no `NOTICE` file. Its files carry lines
  such as "Copyright 2018 The Android Open Source Project".
- **Not all of each library is in the APK.** R8 keeps what each app
  uses. The emoji font loader of `emoji2` is turned off in each app's
  manifest,
  and the native library of `graphics-path` is left out
  ([build.md](build.md#native-code-from-compose)).
- Tink names `androidx.annotation:annotation-jvm` 1.8.2. The build picks
  1.9.1, because Compose asks for it.

## Jetpack Compose and Material 3

Listed apart from the other AndroidX libraries, because it is every
screen of the apps. It comes from the same repository, under the same
licence.

- **Artifacts:** `androidx.compose.animation`, `foundation`, `runtime`
  and `ui` 1.12.1, `androidx.compose.material:material-ripple` 1.12.1,
  and `androidx.compose.material3:material3` 1.4.0, by the Compose BOM
  2026.09.00.
- **Source:** <https://github.com/androidx/androidx>.
- **Licence:** Apache-2.0.
- **Notice:** none in the repository. Its files carry lines such as
  "Copyright 2019 The Android Open Source Project".
- Only `core/design` uses Material 3.

## Kotlin standard library

- **Artifact:** `org.jetbrains.kotlin:kotlin-stdlib`, version 2.4.21,
  from Maven Central.
- **Source:** <https://github.com/JetBrains/kotlin>, tag `v2.4.21`.
- **Licence:** Apache-2.0 (`license/LICENSE.txt`).
- **Notice:** `license/NOTICE.txt`: "Kotlin Compiler" and "Copyright
  2010-2024 JetBrains s.r.o and respective authors and developers". The
  app's notice quotes both lines, as the Apache licence asks for a
  `NOTICE` file.

## kotlinx.coroutines

- **Artifacts:** `org.jetbrains.kotlinx:kotlinx-coroutines-core` and
  `kotlinx-coroutines-android`, version 1.9.0, from Maven Central.
- **Source:** <https://github.com/Kotlin/kotlinx.coroutines>, tag
  `1.9.0`.
- **Licence:** Apache-2.0.
- **Notice:** the source has no `NOTICE` file. Its `LICENSE.txt` ends
  with "Copyright 2000-2020 JetBrains s.r.o. and Kotlin Programming
  Language contributors."

## BIP-39 English word list

The 2048 English words that a recovery key is shown in
([crypto-design.md](../security/crypto-design.md#the-words)). It is data,
not a library.

- **In the repository:**
  `android/core/crypto/src/main/resources/app/shkriuss/core/crypto/words/english.txt`.
- **Source:** the file `src/mnemonic/wordlist/english.txt` of Trezor's
  [python-mnemonic](https://github.com/trezor/python-mnemonic), the
  reference implementation of BIP-39. Taken from commit
  `b57a5ad77a981e743f4167ab2f7927a55c1e82a8`.
- **Unchanged:** the file is byte for byte the source's. Its SHA-256 is
  `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`. A
  unit test, `RecoveryWordsTest`, checks the file in the app against this
  value.
- **Licence:** MIT.
- **Notice:** "Copyright (c) 2013-2016 Pavol Rusnak".
- **Where the notice is:** the MIT licence asks that this notice and the
  licence text go with every copy. Both are in `LICENSE.txt`, in the same
  folder as the list. It is the source's own `LICENSE` file, unchanged.
  Both files are packed into the app together. The Licences screen of
  each app shows a copy of it, `water_licence_bip39.txt`,
  `reminders_licence_bip39.txt` and `tasks_licence_bip39.txt`, byte for
  byte the same.

## Tink for Java

The only cryptography library of the suite
([ADR 0006](../adr/0006-tink-and-key-hierarchy.md)).

- **Artifact:** `com.google.crypto.tink:tink-android`, version 1.24.0,
  from Maven Central.
- **Source:** <https://github.com/tink-crypto/tink-java>, tag `v1.24.0`.
- **Licence:** Apache-2.0.
- **Notice:** the source has no `NOTICE` file. Its files carry lines such
  as "Copyright 2017 Google Inc." and "Copyright 2022 Google LLC".
- **In the jar:** no licence text and no notice. One R8 rule file,
  `META-INF/proguard/protobuf.pro`.
- **In Water's APK:** 375 class names under `com.google.crypto.tink`,
  with the 64 of Protocol Buffers below.

### Protocol Buffers, inside Tink

Tink's jar holds a copy of Google's Protocol Buffers for Java (the lite
runtime), moved to Tink's own package name,
`com.google.crypto.tink.shaded.protobuf`. Tink uses it to read and write
keysets. It is not a separate dependency.

- **Version:** 4.33.6, read from the class `RuntimeVersion` in the jar.
- **Source:** <https://github.com/protocolbuffers/protobuf>. The licence
  was read at tag `v33.6`.
- **Licence:** BSD 3-Clause.
- **Notice:** "Copyright 2008 Google Inc. All rights reserved." It is the
  first line of the licence text.

## The four libraries that Tink brings

`tink-android` 1.24.0 names four libraries in its POM. The owner accepted
them as they come
([crypto-design.md](../security/crypto-design.md#the-library)). None of
the four jars holds a licence text or a notice file. Three of them are
not in the APK of Water, Reminders or Tasks; the fourth, AndroidX
Annotation, is one of the [AndroidX libraries](#androidx-libraries).

### Gson

- **Artifact:** `com.google.code.gson:gson`, version 2.13.2.
- **Source:** <https://github.com/google/gson>, tag `gson-parent-2.13.2`.
- **Licence:** Apache-2.0.
- **Notice:** the source has no `NOTICE` file. Its files carry
  "Copyright (C) 2008 Google Inc." and later years.
- **Use:** only Tink's JSON keyset and JWT code, which the apps never
  call. So R8 removes it.

### JSR-305 annotations

- **Artifact:** `com.google.code.findbugs:jsr305`, version 3.0.2.
- **Source:** its POM names <http://findbugs.sourceforge.net/> and
  `https://code.google.com/p/jsr-305/`. Google Code is closed. The
  source is read in its archive of the project.
- **Licence:** the listing and the source say different things:
  - The POM at Maven Central says "The Apache Software License, Version
    2.0".
  - The source has one licence file, `ri/LICENSE`. It is the BSD licence
    with three clauses, "Copyright (c) 2007-2009, JSR305 expert group".
    Its SHA-256 is
    `fb9bdee1ef51ee85a17d04fda7fbf0ea2af92454b151a252c13cea7a720f3a8b`.
- Both licences allow what the apps do. If the library ever ships, its
  entry shows the licence of the source and says what the listing names.
- **Use:** annotations such as `@Nullable` on Tink's classes.

### Error Prone annotations

- **Artifact:** `com.google.errorprone:error_prone_annotations`, version
  2.41.0.
- **Source:** <https://github.com/google/error-prone>, tag `v2.41.0`.
- **Licence:** Apache-2.0 (`COPYING`).
- **Notice:** the source has no `NOTICE` file. Its files carry lines such
  as "Copyright 2015 The Error Prone Authors."
- **Use:** annotations on Tink's and Gson's classes.

## Other libraries that do not ship

### Guava ListenableFuture

- **Artifact:** `com.google.guava:listenablefuture`, version 1.0: the one
  interface `ListenableFuture` of Guava.
- **Source:** <https://github.com/google/guava>,
  `futures/listenablefuture1`.
- **Licence:** Apache-2.0.
- **Notice:** "Copyright (C) 2007 The Guava Authors" in the file.

### JetBrains annotations for Java

- **Artifact:** `org.jetbrains:annotations`, version 23.0.0.
- **Source:** <https://github.com/JetBrains/java-annotations>, tag
  `23.0.0`.
- **Licence:** Apache-2.0.
- **Notice:** "Copyright 2000-2021 JetBrains s.r.o." in its files.

### JSpecify annotations

- **Artifact:** `org.jspecify:jspecify`, version 1.0.0.
- **Source:** <https://github.com/jspecify/jspecify>, tag `v1.0.0`.
- **Licence:** Apache-2.0.
- **Notice:** "Copyright 2018-2020 The JSpecify Authors." in its files.

### kotlinx.serialization

- **Artifact:** `org.jetbrains.kotlinx:kotlinx-serialization-core`,
  version 1.7.3.
- **Source:** <https://github.com/Kotlin/kotlinx.serialization>, tag
  `v1.7.3`.
- **Licence:** Apache-2.0.
- **Notice:** "Copyright 2017-2020 JetBrains s.r.o." in its files.
- No app code uses it ([spec.md](../apps/water/spec.md#assumptions),
  assumption 15). AndroidX names it.

## How the list is made

In the cloud environment, with dependency verification on:

1. `./gradlew :app:<app>:dependencies --configuration
   releaseRuntimeClasspath`, from `android/`, for `water`, `reminders`
   and `tasks`. Each lists 110 modules, the same for all three. They are
   the 14 projects of the two tables above.
2. `./gradlew :app:<app>:assembleRelease`. Then the APK,
   `app/<app>/build/outputs/apk/release/`, is read as a zip file:
   - the class names in its dex files, by package. The seven libraries of
     [On the class path, not in the APK](#on-the-class-path-not-in-the-apk)
     have none;
   - the files `META-INF/*.version`, one for each AndroidX library that
     is in it;
   - the licence texts and notices, by their SHA-256.
3. Each licence and each copyright line is read at the source named in
   its section, and not copied from memory.
4. Nothing in the apps is taken from an icon set or a font. Every icon is
   drawn for the suite, and the text is in the phone's own font.

## How to check again

After a dependency change, and before a release. Before a release,
prompt R6 does it for the app, and writes the new version where this
page names the version that was checked
([PROMPTS.md](PROMPTS.md#r6-prepare-a-release)).

1. Run step 1 above. Compare the list with this page.
2. Run step 2. Look for a package in the dex files that no row of
   [What ships in Water](#what-ships-in-water) covers.
3. Change this page, `Licences` in `android/feature/water`, in
   `android/feature/reminders` and in `android/feature/tasks`, and the
   files in their `res/raw`, together. Each `LicencesTest` then needs the new count.

### What the APK of Water 1.0.2 holds

What steps 1 and 2 give for version `1.0.2`, to compare with:

- The class path has the 110 modules.
- The APK has one dex file. It holds classes of the seven parts, with
  Protocol Buffers under `com.google.crypto.tink.shaded.protobuf`. It
  holds no class of the seven libraries of
  [On the class path, not in the APK](#on-the-class-path-not-in-the-apk),
  none of Google Play services and no `WebView`. It has no native
  library.
- Its 54 files `META-INF/*.version` name the versions of
  [AndroidX libraries](#androidx-libraries), Compose 1.12.1, Material 3
  1.4.0 and kotlinx.coroutines 1.9.0.
- The three licence texts are in it, by their SHA-256.

### What the APK of Reminders 1.0.1 holds

The same as Water's: the 110 modules on the class path, one dex file
with classes of the seven parts and of none of the seven libraries that
R8 removes, no Google Play services, no `WebView`, no native library, 54
files `META-INF/*.version`, and the three licence texts by their
SHA-256.

### What the APK of Tasks 1.0.0-alpha.1 holds

The same as Water's: the 110 modules on the class path, one dex file
with classes of the seven parts and of none of the seven libraries that
R8 removes, no Google Play services, no `WebView`, no native library, 54
files `META-INF/*.version`, and the three licence texts by their
SHA-256.

## Open

- **No build check fails when a library ships without a notice.** Today
  the list is checked by hand, as above. A check would read the APK as
  the APK rules check does. That file is owner-only, so it is the owner's
  decision.
- **Catalog has no Licences screen.** It ships the AndroidX libraries,
  Compose, the Kotlin standard library, kotlinx.coroutines and the word
  list. Whether the design gallery gets the screen is for the owner.
- **Each later app** lists what ships in it, in the same way.

## How to add an entry

1. Add a row to the table and a section like the ones above: artifact or
   file, version, source, licence, notice.
2. Read the licence and the notice at the source. Do not copy them from
   memory.
3. If the licence asks that its text goes with every copy, say where the
   text is.
4. If the part ships in an app, add it to that app's list of licences,
   with its notice and its licence text.
5. A new dependency also needs a decision record, a version catalog entry
   and verification metadata (hard rule 5 in
   [CLAUDE.md](../../CLAUDE.md)).
