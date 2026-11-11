# Install with Obtainium

The apps are not in Google Play. They are released on GitHub. Obtainium is
an app that installs apps from their releases on GitHub and tells you when
an update is out.

Not every app has a release yet. The [apps page](apps.md) shows which ones
do.

These steps have not been tried with a real release yet. They will be
checked, and corrected if needed, with the first release, Catalog 0.1.0.
The names of buttons and settings can differ a little between versions of
Obtainium.

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

Android installs an update only if it is signed with the same key as the
app on your phone. So once you have checked an app with AppVerifier, an
update from anyone else cannot replace it.
