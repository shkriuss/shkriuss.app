# @shkriuss/pwa

The service worker of every app: it makes the app work offline after its first load, and lets the user decide when a new version takes over. It implements the [service worker spec](../../docs/specs/service-worker.md) ([architecture §9](../../docs/architecture.md#9-offline-install-and-updates)). It also gives the app its web app manifest and icons, which browsers need to install it, says how the app installs and shows the browser's install prompt when the user asks, and tells the app whether the browser keeps its data, and asks the browser to keep it.

## Use

Every app gets `pwa()` from its build, `app()` of `@shkriuss/shell/vite`. There, as anywhere, `pwa()` comes before `edge()`, which writes `/sw.js` once every other file of the build is final:

```ts
import { edge } from "@shkriuss/edge";
import { pwa } from "@shkriuss/pwa/vite";

export default defineConfig({ plugins: [react(), pwa(), edge({ appId: "notes" })] });
```

In the page, the app starts the service worker once and shows its state, as `@shkriuss/shell` does for every app:

```ts
import { startServiceWorker } from "@shkriuss/pwa";

const updates = startServiceWorker();
updates.subscribe(() => {
  if (updates.getState() === "update-available") showUpdateBanner();
});
// When the user agrees:
updates.applyUpdate();
```

| State              | Meaning                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `unavailable`      | No service worker: a development build, a browser without service workers, or a private window that refuses them  |
| `installing`       | The first version is installing; the app works offline once it is ready                                           |
| `ready`            | A version is active, and the app works offline                                                                    |
| `update-available` | A new version has installed and waits; `applyUpdate()` makes it active and reloads the page into it               |
| `updating`         | The user agreed; the page reloads once the new version is active                                                  |
| `outdated`         | Another tab or window made a new version active; this page still runs the old one, and `applyUpdate()` reloads it |

React's `useSyncExternalStore(updates.subscribe, updates.getState)` takes the store's functions as they are. The page asks the browser to look for a new version whenever it becomes visible, at most once an hour; `checkForUpdate()` asks at once.

## Manifest and icons

`webAppManifest()` writes the app's web app manifest and every icon, from the app's glyph and accent color ([architecture §9](../../docs/architecture.md#9-offline-install-and-updates)), and links them from the page:

```ts
import { webAppManifest } from "@shkriuss/pwa/vite";

webAppManifest({
  name: "Notes",
  description: "Notes that stay on this device.",
  accent: "#1d4ed8",
  // Filled SVG paths in a square of 24 units, as in viewBox="0 0 24 24".
  icon: { size: 24, paths: [{ d: "M5 3h14v18H5Z M8 7h8v2H8Z", fillRule: "evenodd" }] },
});
```

| File                                               | What it is                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/manifest.webmanifest`                            | The manifest: `id` and `start_url` `/`, standalone, the platform's theme colors, and the PNG icons |
| `/icon-192.png`, `/icon-512.png`                   | The glyph on a rounded square of the accent color, in its middle 60%, as desktops show apps        |
| `/icon-maskable-192.png`, `/icon-maskable-512.png` | The accent to every edge, with the glyph in the middle 50%, inside the safe zone of every mask     |
| `/icon-monochrome-512.png`                         | The glyph alone, in white, which Android tints for themed icons                                    |
| `/apple-touch-icon.png`                            | 180 pixels, the accent to every edge, which iOS rounds itself, for the home screen                 |
| `/favicon.svg`                                     | The glyph on a rounded square, as the 512-pixel icon                                               |

- **The glyph** is SVG path data, filled by the non-zero or the even-odd rule: an outline becomes a filled path with "outline stroke" in any SVG editor. The build refuses path data that does not follow SVG's grammar, and paths that leave the glyph's square.
- **The page** gets `<link rel="manifest">`, the favicon, the touch icon, and a `theme-color` for each theme: the surface of the frame's header, so that an installed app's title bar and its header look like one.
- **Names:** `shortName`, which a home screen shows under the icon, has at most 12 characters; it is `name` if left out.
- **No dependencies:** the icons are drawn by this package, with exact area coverage for smooth edges, and written as PNG with Node's zlib, so the same glyph always gives the same bytes.

## Installing

`appInstall()` says whether and how the app can be installed on this device ([architecture §9](../../docs/architecture.md#9-offline-install-and-updates)), and shows the browser's install prompt when the user asks. `InstallSection` and `InstallBanner` of `@shkriuss/shell` show it.

```ts
import { appInstall } from "@shkriuss/pwa";

// When the app starts, before the browser offers to install it once the page has loaded:
const install = appInstall();
// When the user asks for it, as with a button in Settings:
const installed = await install.install();
```

| State                | Meaning                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `installed`          | The app runs installed, or the user has just installed it                                           |
| `promptable`         | The browser offers to install it (Chromium's `beforeinstallprompt`), which `install()` shows        |
| `add-to-home-screen` | A browser on iPhone or iPad: the user installs the app from the share menu, with Add to Home Screen |
| `unavailable`        | The browser offers the page nothing; its menu may still install the app                             |

- **The prompt** shows only for the user's press, and once: a second press while it shows waits for the same answer, and a dismissed prompt is spent until the browser offers another. The browser's own banner never shows, so that the app offers installing where it fits.
- **iPhone and iPad:** `navigator.standalone`, which only browsers there have, tells a page on the Home Screen from one in the browser.

## Storage

`appStorage()` says whether the browser keeps the app's data until the user deletes it, and how much the app stores ([architecture §7](../../docs/architecture.md#7-data-layer)). `StorageSection` of `@shkriuss/shell` shows it in the app's settings.

```ts
import { appStorage } from "@shkriuss/pwa";

const storage = appStorage();
const { persistence, usage, quota } = storage.getStatus();
// When the user asks for it, as with a button in Settings:
const kept = await storage.requestPersistence();
```

| `persistence` | Meaning                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `persisted`   | The browser keeps the app's data until the user deletes it                  |
| `best-effort` | The browser may delete the app's data, as when the device runs low on space |
| `unknown`     | The browser has no Storage API, or did not answer                           |

`usage` and `quota` are the browser's estimates in bytes, or `undefined` while unknown. The status is read once at the start; `refresh()` reads it again, as after the app stored data.

`requestPersistence()` asks the browser to keep the data, and resolves to whether it does. Firefox asks the user, so an app calls it only for something the user does. Chromium and Safari ask nothing: they decide from how much the user uses the app and whether it is installed. React's `useSyncExternalStore(storage.subscribe, storage.getStatus)` takes the store's functions as they are.

## What it builds

`pwa()` bundles `worker/sw.ts` into `/sw.js`: one classic script that contains the build's version id, its precache list and the versions it replaces (spec §2). Every file that `sha256sums.txt` lists is in the precache list, with its SHA-256, so the service worker keeps a file only if it matches the hash that the build published. The version id is the start of the SHA-256 of `/sw.js` itself, so every change gives a new one.

| Module               | What it does                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/protocol.ts`    | What the build, the service worker and the page share: the data in `/sw.js`, the cache names, the activate message           |
| `src/script.ts`      | The precache list and the URL of each file (§2.1), the version id (§2.2) and `/sw.js` (§2.3)                                 |
| `src/vite.ts`        | `pwa()` and `webAppManifest()`, the Vite plugins                                                                             |
| `src/manifest.ts`    | The web app manifest                                                                                                         |
| `src/icons/`         | The icons: SVG path data (`path.ts`), filling with anti-aliasing (`raster.ts`), PNG files (`png.ts`), each icon (`icons.ts`) |
| `worker/worker.ts`   | The service worker: install (§4), activate (§5), fetch (§6), messages (§10), and the one that removes itself (§9)            |
| `worker/sw.ts`       | Starts the service worker with the build's data                                                                              |
| `worker/remove.ts`   | Starts the service worker that removes itself                                                                                |
| `browser/updates.ts` | The page's side: registration (§3) and updates (§7)                                                                          |
| `browser/storage.ts` | The app's storage: whether the browser keeps the data, and how much there is                                                 |
| `browser/install.ts` | How the app installs: the browser's prompt, the display mode, the Home Screen of iOS                                         |
| `browser/index.ts`   | `startServiceWorker()`, `appStorage()` and `appInstall()`, with the browser's globals                                        |

The service worker and the page's side take what they use of the browser as a parameter, so that the unit tests run them against fakes. `tooling/pwa-e2e` tests the service worker in Chromium, Firefox and WebKit, and `tooling/platform-e2e` the storage and the manifest. The icons' unit tests are property-based: a shape covers exactly its area, whichever way it goes round, and an arc stays on its ellipse.

## Replacing a broken version

If a version is broken in a way that keeps it from updating itself, for example if it fails before it can show that an update is available, its fix replaces it without waiting for the user (spec §8):

1. Find the broken version's id in its `/sw.js`, from the production site:

   ```sh
   curl -s https://notes.shkriuss.app/sw.js | grep -o '"version":"[0-9a-f]*"'
   ```

2. Fix the code. In the app's `vite.config.ts`, list the broken version's id: `app(config, { serviceWorker: { replaces: ["0123456789abcdef"] } })`, which passes it to `pwa()`. Never deploy an older build instead: it could not open a database that the broken version upgraded.
3. Merge and deploy as usual. Every device whose active version is the broken one takes the fix as soon as it has installed it, and reloads every window of the app, even in the middle of a task. Every other device gets a normal update.
4. Remove the id again in a later release.

## Removing the service worker

The last resort, if the service worker itself is broken in a way that a new version cannot fix (spec §9). In the app's `vite.config.ts`, use `app(config, { serviceWorker: { remove: true } })`, which passes it to `pwa()`, then merge and deploy as usual.

The next time a device opens the app, its browser fetches the new `/sw.js`, which deletes every cache of the app, unregisters itself and reloads every window of the app from the network. It never touches IndexedDB, so the user's data stays. Pages of this build register no service worker; they unregister any they find, and delete its caches. The app works online until a build with `pwa()` is deployed again.
