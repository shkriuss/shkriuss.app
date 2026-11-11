# Signing certificate fingerprints

Every app in the suite is signed with one key, the suite key
([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md)). Below is the
SHA-256 fingerprint of its certificate. Use it to check that an app on your
phone really comes from this project.

Only the owner provides and changes the values on this page. The file is
owner-only in [CODEOWNERS](../../.github/CODEOWNERS).

## Current certificate

Current certificate SHA-256: `07:46:29:25:CB:F0:B2:17:77:61:53:AD:EC:F3:83:1E:8F:66:C1:E9:E8:40:94:B7:B4:8E:72:3A:83:9E:99:16`

- Key: RSA 4096, `CN=shkriuss.app`.
- Provided by the owner on 2026-11-11.

The release workflow reads the line above. It refuses to release an APK
whose certificate is different
([release.md](../development/release.md)). Keep that line in exactly this
form:

1. One line that starts with `Current certificate SHA-256: `.
2. The fingerprint inside backticks.
3. 32 pairs of upper-case hex digits, separated by colons.

## Apps signed with this key

| App | Package name |
|---|---|
| Catalog | `app.shkriuss.catalog` |

Preview APKs from pull requests have a package name that ends in
`.preview`. Each one is signed with its own throwaway key, never with this
one ([ci.md](../development/ci.md#pr-preview)).

## How to check an installed app

1. Open AppVerifier and pick the app.
2. Compare the SHA-256 it shows with the current certificate above. Every
   pair must be the same.
3. If it is different, do not use the app. Report it as described in
   [SECURITY.md](../../SECURITY.md).

Every release's notes on GitHub also show the certificate's SHA-256.

## Previous certificates

None. If the key is ever rotated (APK signature scheme v3.1), the old
certificate moves here, with the dates it was used.
