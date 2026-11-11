# Verify with AppVerifier

Every app of the suite is signed with one key. AppVerifier shows the
fingerprint of the key that signed an app on your phone. If it is the
fingerprint below, the app comes from this project and was not changed.

These steps were checked with the first release, Catalog 0.1.0, on
2026-11-11.

## What you need

- The app, installed. See [Install with Obtainium](install.md).
- AppVerifier. Get it from its releases on GitHub:
  <https://github.com/soupslurpr/AppVerifier/releases>.

## The fingerprint

The fingerprint of the signing certificate is kept in
[fingerprints.md](../security/fingerprints.md) in the repository.

<!-- site: fingerprints -->

## Check an app

1. Open AppVerifier.
2. Tap the app in the list. AppVerifier shows its package name and the
   SHA-256 fingerprint of its signing certificate.
3. Check that the package name is the one above.
4. Check that the fingerprint is the one above. Every pair of characters
   must be the same.

AppVerifier can also compare them for you. Copy the two lines for the app
from the box above, and paste them into AppVerifier.

## If it does not match

1. Do not use the app. Uninstall it.
2. Report it privately, as the [security policy](../../SECURITY.md)
   explains.

## Check in more than one place

The same fingerprint is in three places:

- on the project's website, which shows this page too,
- in [fingerprints.md](../security/fingerprints.md) on GitHub,
- in the notes of every release on GitHub.

The website runs on Cloudflare, not on GitHub. Someone who takes over one
of them cannot change the other. If the places do not agree, do not use
the app, and report it.

After the first check, Android protects you: it installs an update only if
it is signed with the same key as the app on your phone.
