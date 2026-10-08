# Hub

- **Status:** accepted, 2026-10-06 (Phase 1.4)
- **Address:** `https://shkriuss.app`, and `https://shkriuss.dev` for staging.
- **Builds on:** [architecture §4](../architecture.md#4-system-overview) and [§13](../architecture.md#13-privacy), [ADR 0003](../decisions/0003-local-only-at-launch.md) (local only) and [ADR 0013](../decisions/0013-routes-in-code.md) (routes in code).
- **Implemented by:** `apps/hub`, the `catalog()` plugin of `@shkriuss/shell/vite`, and `@shkriuss/edge` for `security.txt` (Phase 1.4)

The hub is the front door: it lists the apps, explains how to install them, and says plainly what happens to the user's data. It is a static site. It holds no user data and has no service worker: every app works offline, but the hub is read online.

## 1. Pages

| Page     | Address     | What it shows                                                                                                                                                     |
| -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apps     | `/`         | What the apps are, in two sentences, then the catalog (section 2).                                                                                                |
| Install  | `/install`  | How to install an app on an iPhone or iPad (Safari, Add to Home Screen), on Android (Chrome), and on a computer (Chrome and Edge; Safari's Add to Dock on a Mac). |
| Privacy  | `/privacy`  | The privacy policy, in plain language (section 3).                                                                                                                |
| Security | `/security` | How the apps are protected, how anyone can check what a site serves (`/sha256sums.txt`, build provenance), and how to report a problem privately.                 |

- **The frame:** the hub's name, which leads to `/`, and links to the other pages; the source code and `/licenses.txt` at the bottom. It looks like the apps, from `@shkriuss/ui`, in light and dark.
- **Install guides** say what differs on each platform: an app installed on an iPhone keeps its own data, apart from Safari's, so moving data in means a backup; each app installs on its own.
- **Unknown addresses** show that the page does not exist, with a link to `/`.

## 2. The catalog

One card per app in `apps/`, the hub excepted, sorted by name: its icon, name and description, its privacy label, and a link that opens it.

- **From `app.config.ts`, at build time.** The hub's build reads every app's `app.config.ts`, through a `catalog()` Vite plugin of `@shkriuss/shell/vite`, and puts the names, descriptions, icons and features in the hub's bundle. No app code goes into the hub: only these values. The plugin is the one place that reads other apps' configuration; the `imports` check keeps refusing imports of an app anywhere else.
- **The privacy label** is not declared, so it cannot be wrong; it follows from what the platform enforces:
  - "Data collected: none." Every app is local-only ([ADR 0003](../decisions/0003-local-only-at-launch.md)).
  - "Leaves this device: only the backups that you save", or "nothing" for an app without data (`keepsData: false`), whose build has none of the code of the backups.
  - "Browser permissions:" none, or those that the app's `allowedFeatures` allow, in words, such as "camera". The app's Permissions-Policy denies every other one.
- **Links** go to `https://<id>.` followed by the hub's own host, so the same build links to `checklists.shkriuss.dev` on staging and to `checklists.shkriuss.app` in production, as the byte-for-byte check between them requires.
- **The icon** is the app's glyph on its accent color, drawn as SVG, as its home-screen icon is.

## 3. Privacy policy

In plain language, what [architecture §13](../architecture.md#13-privacy) commits to:

- The apps keep the user's data on the device. There are no accounts, cookies, analytics, telemetry or third-party requests.
- **What Cloudflare sees:** the IP address, the user agent, the address requested and the time, as with any website. Cloudflare's own privacy policy applies to it. The sites turn on no logging or analytics of their own.
- **Backups** are files that the user saves, where the user chooses. They are encrypted by default, with a passphrase that never leaves the device.
- **Changes** to the policy are in the repository's history, with the date of the last change on the page.

## 4. `security.txt`

Every origin serves `/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)), the hub's and each app's, because a researcher looks at the site in front of them, as `text/plain; charset=utf-8`, which RFC 9116 asks for. `@shkriuss/edge` writes it into every build:

```text
Contact: https://github.com/shkriuss/shkriuss.app/security/advisories/new
Policy: https://github.com/shkriuss/shkriuss.app/security/policy
Preferred-Languages: en
Expires: <the commit's date plus 180 days>
```

- **Contact** is GitHub's private vulnerability report, as `SECURITY.md` says; no email address is published.
- **Expires** comes from the date of the commit that is built, not from the time of the build. A second build of the commit must match the deployed files byte for byte, and it may come days later. A site that is not deployed for 180 days shows that its contact may be out of date, as RFC 9116 intends.

## 5. Tests

- **End to end,** in every browser: each page, with its title and heading; the catalog's cards, links and labels; the frame's links; unknown addresses; no accessibility violation in either theme; the security headers, as the hub's tests check them now.
- **The catalog plugin,** with unit tests: it reads every app but the hub, sorted by name; it refuses a configuration without a valid id, name or description; it puts only the catalog's values into the bundle.
- **`security.txt`,** with unit tests in `@shkriuss/edge`: its fields, and an `Expires` that depends only on the commit.

## 6. Not in version 1

One-click install through the Web Install API (desktop Chromium), search in the catalog, screenshots, and pages in other languages.
