# Verify with AppVerifier

Every app of the suite is signed with one key. AppVerifier shows the
fingerprint of the key that signed an app on your phone. If it is the
fingerprint below, the app comes from this project and was not changed.

These steps were checked with the first release, Catalog 0.1.0, on
2026-11-11. The steps after a new signing key were checked on
2026-11-14, in a rehearsal with throwaway keys.

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

AppVerifier can also compare them for you:

1. Copy the two lines for the app from the box above: the package name,
   then the fingerprint.
2. Open AppVerifier and tap the app.
3. Tap **Verify from clipboard**.
4. It must show "Verification Status: SUCCESS".

Before that, AppVerifier may show "Internal Database Status: NOT FOUND"
and "Verification Status: UNKNOWN". That only means that it does not know
the app by itself.

## If it does not match

1. Do not use the app. Uninstall it.
2. Report it privately, as the [security policy](../../SECURITY.md)
   explains.

## Check in more than one place

The same fingerprint is in three places:

- on the project's website, which shows this page too,
- in [fingerprints.md](../security/fingerprints.md) on GitHub,
- in the notes of every release on GitHub.

The website runs on Cloudflare. Someone who takes over the website,
through Cloudflare or the domain, cannot change GitHub. Then the places
do not agree. If they do not agree, do not use the app, and report it.

Someone who takes over the project's GitHub account can change all three
places. Comparing them does not help then. What this check does not
cover is in the
[threat model](../security/threat-model.md#takeover-of-github-cloudflare-or-the-domain).

After the first check, Android protects you: it installs an update only if
it is signed with the same key as the app on your phone, or with a new
key that the old key approved. The second happens only after a new
signing key, below.

## After a new signing key

The project may move to a new signing key, as a plan or after a theft.
Then the release notes and the website announce it. How to update is in
[When the signing key changes](install.md#when-the-signing-key-changes).
After the update:

1. Open AppVerifier and tap the app. It shows two SHA-256 fingerprints:
   the old one first, and the new one last.
2. Check that the last one is the new fingerprint above. Every pair of
   characters must be the same.
3. Copy the two lines for the app from the box above, with the new
   fingerprint. In AppVerifier, tap **Verify from clipboard**.
4. It must show "Verification Status: SUCCESS".

Before the update, in Obtainium, the last downloaded hash must be the new
fingerprint. Until you update, someone who holds the old key could also
make a file that your phone accepts, and Obtainium would warn in the same
way. Only the last hash shows whose new key it is.

In the rehearsal of 2026-11-14, AppVerifier showed both fingerprints, the
old one first, and the new fingerprint gave "Verification Status:
SUCCESS".
