# Install with Obtainium

The apps are not in Google Play. They are released on GitHub. Obtainium is
an app that installs apps from their releases on GitHub and tells you when
an update is out.

Not every app has a release yet. The [apps page](apps.md) shows which ones
do.

These steps were checked with the first release, Catalog 0.1.0, on
2026-11-11. The names of buttons and settings can differ a little between
versions of Obtainium.

## What you need

- A phone with Android 13 or newer. GrapheneOS is the first target.
- Obtainium. Get it from its releases on GitHub:
  <https://github.com/ImranR98/Obtainium/releases>.

## Add an app

All apps of the suite are released from one repository. Each release is
named after its app and version, for example `catalog-v0.1.0`. A filter
makes Obtainium look only at the releases of one app.

1. Open Obtainium and tap **Add app**.
2. In **App source URL**, type
   `https://github.com/shkriuss/shkriuss.app`.
3. Find the setting **Filter release titles by regular expression**. Type
   `^catalog-v`. For another app, use its name in lower case in place of
   `catalog`, for example `^water-v`.
4. Tap **Add**.
5. Obtainium shows the newest release of that app. Tap **Install**.
6. The first time, Android asks whether Obtainium may install apps. Allow
   it, then go back and tap **Install** again.
7. Before you use the app, check that it is genuine:
   [Verify with AppVerifier](verify.md).

## Pre-releases

A version with a hyphen, such as `1.0.0-rc.1`, is a pre-release for
testing. Obtainium skips pre-releases unless you turn on **Include
prereleases** for that app.

## Updates

Obtainium checks for new releases and tells you when one is out. Tap the
app in Obtainium, then **Update**.

These two steps were checked with the first update, Catalog 0.1.0 to
0.2.0, on 2026-11-12. It worked on all three test devices: a Pixel 9 Pro,
a Pixel Tablet and a Pixel 6a.

Android installs an update only if it is signed with the same key as the
app on your phone, or with a new key that the old key approved. The
second happens only when the project changes its signing key, which is
announced ([When the signing key changes](#when-the-signing-key-changes)).
So once you have checked an app with AppVerifier, an update from anyone
who does not hold the key cannot replace it.

Update the apps only in Obtainium. If Android asks "Update this app using
Package installer?", tap **Cancel**. It means something other than
Obtainium is trying to update the app.

## When the signing key changes

Every app of the suite is signed with one key. The project may move to a
new key, as a plan or after a theft. The release notes and the website
then announce it, and Obtainium warns once for each app.

1. In Obtainium, tap the app, then **Update**.
2. Obtainium shows "Signing certificate mismatch". It says that
   installing it "will most likely fail". After a real key change, it
   works.
3. Compare the hashes in that dialog. Every pair of characters must be
   the same.
   - The first line under "Downloaded certificate hash" must be the same
     as "Expected certificate hash". That is the key of the app on your
     phone now.
   - The last line under "Downloaded certificate hash" must be the new
     fingerprint on <https://shkriuss.app/verify/>.
4. If both match, tap **Install anyway**. If Android asks whether to
   update the app, allow it. The app keeps its data.
5. If either does not match, tap **Don't install**. Report it privately,
   as the [security policy](../../SECURITY.md) explains.
6. Check the app with AppVerifier, as
   [After a new signing key](verify.md#after-a-new-signing-key) says.
7. If you typed fingerprints into the app's settings in Obtainium, add
   the new one.

Why the last line matters: until you update, the app on your phone still
has the old key. Anyone who holds the old key, for example a thief, could
make a file that your phone would also accept. Obtainium would warn about
it in the same way. Only the last downloaded hash shows whose new key it
is. Once your app has our new key, Android refuses the old key alone, and
a new key that a thief made from it.

These steps were checked on 2026-11-14 in a rehearsal with throwaway
keys, on a Pixel 9 Pro with Obtainium 1.7.4. A thief's file over an app
that still has the old key was not tried. The warning above follows from
how Android checks a new key.

## If Obtainium says "Too many requests"

Obtainium may stop with "Error 403" for an address that starts with
`https://api.github.com/`, and "Too many requests (rate limited) - try
again in" some minutes. GitHub has refused too many requests from your
phone's internet address. Nothing is wrong with the app.

1. Wait a few minutes, then try again.
2. Or switch between mobile data and Wi-Fi, then try again.

This happened on mobile data on 2026-11-14. It worked a few minutes
later.
