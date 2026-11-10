# Test a pull request on a phone

Every pull request that changes an app gets a preview APK of that app, and a
zip file with the screenshots it adds or changes. This page says how to get
them onto a phone with only a browser.

The [PR preview workflow](../../.github/workflows/pr-preview.yml) makes
them. How it works is in [ci.md](ci.md#pr-preview).

## What a preview is

- The `preview` build type: the same as `release`, shrunk and optimised by
  R8, with the app ID suffix `.preview`
  ([build.md](build.md#build-types)).
- It installs next to the real app. Its name ends in "preview", for
  example "Catalog preview".
- It is signed with a throwaway key. The workflow makes the key, signs once
  and deletes it. The release key never signs a preview.
- So a preview can never replace or update the real app.
- Each run makes a new key, so a new preview cannot update an older one
  either. Uninstall the older preview first.
- It has the same permissions as the real app. The APK rules check runs on
  every preview ([build.md](build.md#apk-rules-check)).

## Before the first time

1. Open github.com in your phone's browser and sign in. GitHub hands out
   files from a workflow run only to people who are signed in.

## Install a preview

1. Open the pull request in your phone's browser.
2. Wait until its checks are done. The preview takes a few minutes.
3. Scroll to the checks at the bottom of the **Conversation** tab. If they
   are folded, tap to show them.
4. Tap **Preview (catalog)**, or the line with the app you want to test.
   The job's page opens.
5. Tap **Summary** at the top of that page. The summary has one section per
   app, and one for the screenshots.
6. In the app's section, tap the link that ends in `.apk`. The browser
   downloads the file.
7. Tap **Open** in the browser's download message. If you missed it, open
   the **Files** app, tap **Downloads**, and tap the file.
8. The first time, Android says the browser may not install apps. Tap
   **Settings**, turn on **Allow from this source**, and go back.
9. Tap **Install**.
10. Open the app from the app drawer. Its name ends in "preview".

If a pull request changes no app, for example only docs, the summary says
so and there is no APK.

## Look at the screenshots

1. Open the summary page, as in steps 1 to 5 above.
2. Under **Screenshots**, tap the link that ends in `.zip`.
3. Open the **Files** app, tap **Downloads**, and tap the zip. It opens
   like a folder.
4. Open the folders. They are named after the module, for example
   `app/catalog`.
5. Tap an image.

Each image name says the screen, the device, the theme and the font scale,
for example `CatalogScreen_phone_dark_font2.0.png`.

The zip holds only the images that the pull request adds or changes. If the
summary says no screenshot is new or changed, no screen looks different. CI
checks that every committed image matches the code
([ci.md](ci.md#ci)).

The same images are also in the pull request's **Files changed** tab.

## Install a newer preview

1. Long-press the preview's icon, tap **App info**, then **Uninstall**.
2. Follow [Install a preview](#install-a-preview) again.

Uninstalling deletes the preview's data. The real app is not touched.

## When something goes wrong

| What you see | What to do |
|---|---|
| No **Preview** line in the checks | The pull request changes no app. Nothing to install. |
| **Preview** failed | The APK could not be built. Ask Claude with prompt R1 in [PROMPTS.md](PROMPTS.md). |
| The link opens a sign-in page or "Not Found" | Sign in to GitHub in this browser. A link also stops working when the files expire (see below). |
| Android says "App not installed" | An older preview is still installed. Uninstall it first. |
| Android says the package is invalid | The download stopped early. Download it again. |

Files from a workflow run are kept for the number of days set in the
repository's Actions settings, 90 unless changed. To get new ones, open the
pull request's **Checks** tab, open **PR preview**, and tap **Re-run all
jobs**.

## Safety

1. Install previews only from pull requests that you or Claude's machine
   account opened. The workflow builds the code of the pull request, so a
   pull request from anyone else could put anything into the APK.
2. A preview never gets the release key or any secret. The workflow has a
   read-only token.

## Why this way

Phase 0, step 4 asked for the simplest way to get a preview APK from a pull
request onto a phone with only a browser. Options:

1. **A workflow file that is not zipped (chosen).** GitHub's
   upload-artifact action can upload one file as it is. The link downloads
   the APK itself, and the phone installs it from the download. No other
   app, account or permission is needed.
2. **A zipped workflow file.** The usual way. The phone must unzip it in
   the Files app before it can install, which adds steps.
3. **A release per pull request.** A release needs a tag, and only the
   owner creates tags (section 15 of the [plan](../plan/PLAN.md)).
4. **A comment on the pull request with the link.** It would save steps 3
   to 5, but the workflow would need permission to write to pull requests.
   Open: the owner decides whether that is worth it.
