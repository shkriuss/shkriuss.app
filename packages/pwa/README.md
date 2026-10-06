# @shkriuss/pwa

The service worker of every app: it makes the app work offline after its first load, and lets the user decide when a new version takes over. It implements the [service worker spec](../../docs/specs/service-worker.md) ([architecture §9](../../docs/architecture.md#9-offline-install-and-updates)). The web app manifest, install prompts and persistent storage come later.

## Use

In the app's `vite.config.ts`, `pwa()` comes before `edge()`, which writes `/sw.js` once every other file of the build is final:

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

## What it builds

`pwa()` bundles `worker/sw.ts` into `/sw.js`: one classic script that contains the build's version id, its precache list and the versions it replaces (spec §2). Every file that `sha256sums.txt` lists is in the precache list, with its SHA-256, so the service worker keeps a file only if it matches the hash that the build published. The version id is the start of the SHA-256 of `/sw.js` itself, so every change gives a new one.

| Module               | What it does                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/protocol.ts`    | What the build, the service worker and the page share: the data in `/sw.js`, the cache names, the activate message |
| `src/script.ts`      | The precache list and the URL of each file (§2.1), the version id (§2.2) and `/sw.js` (§2.3)                       |
| `src/vite.ts`        | `pwa()`, the Vite plugin                                                                                           |
| `worker/worker.ts`   | The service worker: install (§4), activate (§5), fetch (§6), messages (§10), and the one that removes itself (§9)  |
| `worker/sw.ts`       | Starts the service worker with the build's data                                                                    |
| `worker/remove.ts`   | Starts the service worker that removes itself                                                                      |
| `browser/updates.ts` | The page's side: registration (§3) and updates (§7)                                                                |
| `browser/index.ts`   | `startServiceWorker()`, with the browser's globals                                                                 |

The service worker and the page's side take what they use of the browser as a parameter, so that the unit tests run them against fakes. `tooling/pwa-e2e` tests them in Chromium, Firefox and WebKit.

## Replacing a broken version

If a version is broken in a way that keeps it from updating itself, for example if it fails before it can show that an update is available, its fix replaces it without waiting for the user (spec §8):

1. Find the broken version's id in its `/sw.js`, from the production site:

   ```sh
   curl -s https://notes.shkriuss.app/sw.js | grep -o '"version":"[0-9a-f]*"'
   ```

2. Fix the code. In the app's `vite.config.ts`, list the broken version's id: `pwa({ replaces: ["0123456789abcdef"] })`. Never deploy an older build instead: it could not open a database that the broken version upgraded.
3. Merge and deploy as usual. Every device whose active version is the broken one takes the fix as soon as it has installed it, and reloads every window of the app, even in the middle of a task. Every other device gets a normal update.
4. Remove the id again in a later release.

## Removing the service worker

The last resort, if the service worker itself is broken in a way that a new version cannot fix (spec §9). In the app's `vite.config.ts`, use `pwa({ remove: true })`, then merge and deploy as usual.

The next time a device opens the app, its browser fetches the new `/sw.js`, which deletes every cache of the app, unregisters itself and reloads every window of the app from the network. It never touches IndexedDB, so the user's data stays. Pages of this build register no service worker; they unregister any they find, and delete its caches. The app works online until a build with `pwa()` is deployed again.
