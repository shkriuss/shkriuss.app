# Third-party material

What others made and the apps contain: where it comes from, its licence
and its notice.

- Status: started on 2026-11-12 in Phase 1, step 4, session B
  ([PROMPTS.md](PROMPTS.md)), with what `core/crypto` brings.
- It is not complete yet. Everything else that ships in an app, such as
  Kotlin, Compose and Room, is listed in Phase 2, before Water's first
  release. The screen that shows these notices inside the apps is built
  then too.
- The project's own licences are in
  [ADR 0018](../adr/0018-licences.md).

## What is listed

| Name | Version | Licence | Used by |
|---|---|---|---|
| [BIP-39 English word list](#bip-39-english-word-list) | Commit `b57a5ad7` | MIT | `core/crypto` |
| [Tink for Java](#tink-for-java) | 1.24.0 | Apache-2.0 | `core/crypto` |
| [Protocol Buffers, inside Tink](#protocol-buffers-inside-tink) | 4.33.6 | BSD 3-Clause | Tink |
| [Gson](#gson) | 2.13.2 | Apache-2.0 | Tink |
| [JSR-305 annotations](#jsr-305-annotations) | 3.0.2 | Apache-2.0 | Tink |
| [Error Prone annotations](#error-prone-annotations) | 2.41.0 | Apache-2.0 | Tink, Gson |
| [AndroidX Annotation](#androidx-annotation) | 1.8.2 | Apache-2.0 | Tink |

What of this is in an app:

- From version 0.3.0, Catalog uses `core/crypto` through `core/security`.
  Its sample recovery words come from the word list. So the word list
  and its `LICENSE.txt` are in Catalog's APK. Checked in the published
  `catalog-v0.3.0.apk`, the first release APK that uses `core/crypto`:
  `english.txt` has the SHA-256 recorded below, and `LICENSE.txt` is
  byte for byte the one in the repository
  ([its checklist](../apps/catalog/release-checklist-0.3.0.md#result)).
- Tink, Protocol Buffers, Gson, JSR-305 and Error Prone are not.
  Catalog never calls them, and R8 removes them from the release APK.
  Checked in Catalog's release build on 2026-11-13, and in the published
  `catalog-v0.3.0.apk`: no class of theirs is in it. AndroidX Annotation
  is in it through Compose, which uses it too.
- All of it will be in every app that stores keys, from Water on.

## BIP-39 English word list

The 2048 English words that a recovery key is shown in
([crypto-design.md](../security/crypto-design.md#the-words)). It is data,
not a library.

- **In the repository:**
  `android/core/crypto/src/main/resources/app/shkriuss/core/crypto/words/english.txt`.
- **Source:** the file `src/mnemonic/wordlist/english.txt` of Trezor's
  [python-mnemonic](https://github.com/trezor/python-mnemonic), the
  reference implementation of BIP-39. Taken on 2026-11-12 from commit
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
  Both files are packed into the app together.

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

### Protocol Buffers, inside Tink

Tink's jar holds a copy of Google's Protocol Buffers for Java (the lite
runtime), moved to Tink's own package name,
`com.google.crypto.tink.shaded.protobuf`. Tink uses it to read and write
keysets. It is not a separate dependency.

- **Version:** 4.33.6, read from the class `RuntimeVersion` in the jar.
- **Source:** <https://github.com/protocolbuffers/protobuf>.
- **Licence:** BSD 3-Clause.
- **Notice:** "Copyright 2008 Google Inc. All rights reserved."

## The four libraries that Tink brings

`tink-android` 1.24.0 names four libraries in its POM. The owner accepted
them as they come
([crypto-design.md](../security/crypto-design.md#the-library)). None of
the four jars holds a licence text or a notice file.

### Gson

- **Artifact:** `com.google.code.gson:gson`, version 2.13.2.
- **Source:** <https://github.com/google/gson>, tag `gson-parent-2.13.2`.
- **Licence:** Apache-2.0.
- **Notice:** the source has no `NOTICE` file. Its files carry
  "Copyright (C) 2008 Google Inc." and later years.
- **Use:** only Tink's JSON keyset and JWT code, which the apps never
  call.

### JSR-305 annotations

- **Artifact:** `com.google.code.findbugs:jsr305`, version 3.0.2.
- **Source:** its POM names <http://findbugs.sourceforge.net/> and
  `https://code.google.com/p/jsr-305/`.
- **Licence:** Apache-2.0, as its POM says.
- **Notice:** none in the jar.
- **Use:** annotations such as `@Nullable` on Tink's classes.

### Error Prone annotations

- **Artifact:** `com.google.errorprone:error_prone_annotations`, version
  2.41.0.
- **Source:** <https://github.com/google/error-prone>, tag `v2.41.0`.
- **Licence:** Apache-2.0.
- **Notice:** the source has no `NOTICE` file. Its files carry lines such
  as "Copyright 2015 The Error Prone Authors."
- **Use:** annotations on Tink's and Gson's classes.

### AndroidX Annotation

- **Artifact:** `androidx.annotation:annotation-jvm`, version 1.8.2, from
  Google's Maven repository.
- **Source:**
  <https://android.googlesource.com/platform/frameworks/support>, the
  AndroidX repository.
- **Licence:** Apache-2.0.
- **Notice:** none in the jar. AndroidX files carry "Copyright (C) The
  Android Open Source Project".
- **Use:** annotations such as `@RequiresApi` on Tink's classes. The
  build may pick a newer version than 1.8.2, because Compose asks for one.

## Open

For Phase 2, before Water's first release:

- List everything else that ships in an app.
- Add the text of the Apache-2.0 and BSD 3-Clause licences to what the
  apps show. No jar above brings its licence text with it.
- Confirm the licence of the JSR-305 annotations at their source. This
  page records only what the artifact's POM says.

## How to add an entry

1. Add a row to the table and a section like the ones above: artifact or
   file, version, source, licence, notice.
2. Read the licence and the notice at the source. Do not copy them from
   memory.
3. If the licence asks that its text goes with every copy, say where the
   text is.
4. A new dependency also needs a decision record, a version catalog entry
   and verification metadata (hard rule 5 in
   [CLAUDE.md](../../CLAUDE.md)).
