# Service worker

- **Status:** accepted, 2026-10-06 (Phase 1.2)
- **Implements:** [architecture §9](../architecture.md#9-offline-install-and-updates), [ADR 0005](../decisions/0005-frontend-stack.md) (our own service worker) and [ADR 0011](../decisions/0011-worker-trusted-types-policy.md) (starting it under Trusted Types)
- **Implemented by:** `@shkriuss/pwa` (Phase 1.2)

Every app has a service worker at `/sw.js`. It makes the app work offline after its first load: it keeps a checked copy of every file of one version of the app and answers the app's requests from it. It also decides when a new version takes over: it installs in the background and waits until the user agrees, so an update never interrupts a task, unless it replaces a broken version (section 8).

It never stores user data, which lives in IndexedDB ([data-model.md](data-model.md)), and it never answers requests for other origins. **Must**, **must not**, **should** and **may** are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Terms

- **Version:** one build of an app, as deployed. Its **version id** is 16 lowercase hexadecimal digits (section 2.2).
- **Precache list:** the files of a version that the service worker keeps, each with its SHA-256 (section 2.1).
- **App shell:** the version's `/index.html`, which answers every navigation that is not to a file.
- **Client:** a tab or window of the app. The **active** service worker controls the clients; a **waiting** one has installed a newer version and waits to take over.

## 2. What a build publishes

### 2.1 The precache list

Every file that the build's `sha256sums.txt` lists ([ADR 0007](../decisions/0007-security-baseline.md)), except `/sw.js` and `/.well-known/security.txt`, with the SHA-256 it gives. `sha256sums.txt` lists every file the app serves but itself.

`security.txt` expires a fixed time after the commit that the build is made from, so it changes with every commit. In the list, it would make every commit a new version, which every installed app would download and announce though nothing in it changed. It need not work offline.

Each file is requested at the URL the host serves it from without a redirect: `/index.html` at `/`, `/<path>/index.html` at `/<path>/`, `/<name>.html` at `/<name>`, and every other file at its own path. The build fails if two files would be served at one URL, or if it has no `/index.html`.

### 2.2 The version id

The first 16 hexadecimal digits of the SHA-256 of `/sw.js` as it would be with sixteen zeros as its version id.

- Any change to a file of the precache list, to the service worker's code or to the versions it replaces gives a new version id, and the same build always gives the same one.
- The browser installs a new service worker exactly when `/sw.js` changes, so every service worker it installs has a version id, and a cache (section 4), of its own.

### 2.3 `/sw.js`

- One classic script, built from `@shkriuss/pwa`, with no `importScripts()` ([ADR 0011](../decisions/0011-worker-trusted-types-policy.md)). It contains its version id, its precache list and the versions it replaces (section 8).
- It changes whenever the version does, so the browser finds a new version by comparing it byte for byte.
- It is served with the same security headers as every other file of the app, so the Content-Security-Policy applies inside it.
- It is listed in `sha256sums.txt`, but browsers cannot check its integrity ([threat model](../threat-model.md#5-residual-risks-accepted) R6).

## 3. Registration

- The page registers `/sw.js` with scope `/` and `updateViaCache: "none"`, through `@shkriuss/edge/workers` ([ADR 0011](../decisions/0011-worker-trusted-types-policy.md)), once the page has loaded. Development builds register none, and neither do builds that turn service workers off (section 9).
- Where the browser has no service workers, or refuses one, as some private windows do, the app works online only.

## 4. Install

When the browser has fetched a new `/sw.js`, the new service worker installs its version:

1. It opens the cache `pwa-<version id>`.
2. It requests every file of the precache list with `cache: "no-cache"`, `redirect: "error"` and the file's SHA-256 as the request's `integrity`, so the browser checks every byte. It keeps each response in the cache under its URL, headers included.
3. Any failure fails the install: a network error, a status other than 200, a redirect, a hash that does not match, or storage that is full. The service worker stops its other requests, deletes its cache, and the active version stays active. The browser tries again on a later update check (section 7.1).

So a version is installed complete and checked, or not at all. A deployment during an install changes some of its files, which then fail their hashes; a later update check installs the newer version.

The cache of a failed install is kept only if it belongs to the active or the previous version, as `pwa-state` records them (section 5). That happens only when the browser installs the active version's `/sw.js` again, for example when the host serves it again after a newer version that is still waiting.

## 5. Activate

A version becomes active:

- at once, when no version was active, as on the first load;
- when the user agrees to an update (section 7.2), or once no client uses the old version any more;
- at once, when it replaces a broken version (section 8).

Then the service worker:

1. records, in the cache `pwa-state`, its version id as the active one, and the version it took over from as the previous one;
2. deletes every cache whose name starts with `pwa-`, except its own, the previous version's and `pwa-state`: those of older versions, and of versions that never became active;
3. takes control of every client with `clients.claim()`, so the app works offline right after its first load. A page that gets its first controller this way does not treat it as an update (section 7.3).

## 6. Fetch

### 6.1 Which requests

The service worker answers only `GET` requests for URLs of the app's own origin. Every other request goes to the network as if there were no service worker. It stores no response but those it precaches (sections 4 and 6.4).

### 6.2 Navigations

A navigation is matched by the path of its URL; its query does not matter, as for the host.

- A navigation to the URL of a file of the precache list, `/` included, is answered with that file from the active version's cache.
- A navigation to `/sw.js`, `/sha256sums.txt` or `/.well-known/security.txt` goes to the network.
- Any other navigation is answered with the app shell, whatever its path and query, as the host's single-page fallback does. The app's router then shows the page, or its own "not found" page.

### 6.3 Other requests

Any other request is answered with the response kept under its exact URL in the active version's cache, or else in the previous version's, or else from the network. So a client that still runs the previous version keeps loading its own files (section 7.3), and the page's integrity checks still apply to every script.

### 6.4 Repair

If a file of the active version is missing from its cache, because the browser or the user cleared Cache Storage, the request goes to the network. The service worker then requests the files that its cache lacks again, in the background, with the checks of section 4. A repair that fails, for example offline, is tried again at the next miss.

## 7. Updates

### 7.1 Checking

The browser checks for a new `/sw.js` on navigations to the app. Installed apps often stay open for days, so the page also asks the browser to check (`registration.update()`) whenever it becomes visible, at most once an hour. A check that fails, for example offline, is not retried until the next one.

### 7.2 Asking the user

1. When a new version has installed and waits, the app shows that an update is available. It does not interrupt: no dialog and no reload.
2. When the user agrees, the page sends the waiting service worker `{ "type": "activate" }` (section 10). The new version becomes active, and the page reloads into it once the new version controls it.
3. Otherwise the new version becomes active once no client uses the old one, for example after all the app's tabs and windows have been closed.

### 7.3 Other clients

- A client that still runs the old version after another one updated keeps running it, served from the previous version's cache. It shows that the app was updated, and reloads when the user agrees.
- A version that raised the schema version closes the database in clients that run older versions, which must reload before they can read or write again ([data-model.md §7](data-model.md#7-storage)).
- A client two or more versions behind may need files that are gone. It then asks the user to reload (section 11).

## 8. Replacing a broken version

A broken version may be unable to update itself, for example if it fails before it can show that an update is available. Its fix then replaces it without waiting for the user:

1. The fixed version lists the broken version's id among the versions it replaces (section 2.3). It is a build of the current code, never an older build, which could not open a database that the broken version upgraded ([data-model.md §7](data-model.md#7-storage)). The broken version's id is the one in its `/sw.js`.
2. On a device whose active version, as `pwa-state` records it, is one it replaces, it becomes active as soon as it has installed (`skipWaiting()`). Then it reloads every client (`WindowClient.navigate()`), even one in the middle of a task. It does not wait for the reloads, which wait until it is active.
3. On every other device, it is a normal update (section 7).

## 9. Removing the service worker

The last resort, if the service worker itself is broken in a way that a new version cannot fix. A build with service workers turned off publishes, in place of the usual one, a `/sw.js` that:

1. becomes active as soon as it has installed;
2. deletes every cache of the app;
3. unregisters itself;
4. reloads every client, which then loads the app from the network.

It never touches IndexedDB or any other storage. The app keeps working online, and works offline again once a build with a service worker is deployed.

Pages of a build without service workers register none. They unregister any they find and delete its caches, those whose names start with `pwa-`, for a device whose service worker never fetched the new `/sw.js`.

## 10. Messages

| From     | To                         | Message                  | Effect                                                |
| -------- | -------------------------- | ------------------------ | ----------------------------------------------------- |
| A client | The waiting service worker | `{ "type": "activate" }` | Its version becomes active at once (`skipWaiting()`). |

- The service worker ignores any other message, a message with more fields, and any message whose source is not a window client of the app.
- Messages carry no user data.

## 11. Errors

| Failure                                                | What happens                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| An install fails (section 4)                           | The active version stays; a later update check tries again.                           |
| A file of the active version is missing from its cache | The request goes to the network, and the version gets its files again (section 6.4).  |
| Offline, a request that the cache cannot answer        | It fails as it would without a service worker.                                        |
| A client needs a file that is gone (section 7.3)       | The app shows an error that asks the user to reload.                                  |
| A newer version upgraded the database                  | The client reports that it must reload ([data-model.md §7](data-model.md#7-storage)). |

## 12. Security

- The service worker serves only files of the active and the previous version, each checked against its SHA-256 at install. A file changed on the host or on the way fails the install and is never served.
- It answers only `GET` requests of its own origin, stores no response but the files it checked, and never sees user data, which stays in IndexedDB.
- `/sw.js` itself has no integrity check (R6). The browser fetches it without HTTP caches on navigations, so a changed one can be replaced (sections 8 and 9).
- Messages are checked. A client can only make active a version that the browser has already installed and checked.
- `Clear-Site-Data` is never sent: its `storage` type would delete IndexedDB.

## 13. Tests

End-to-end tests run against production builds, served with the production headers, in Chromium, Firefox and WebKit. They show that:

- the app loads, and loads again offline, with no CSP or integrity violation, and a page from the cache keeps its version's Content-Security-Policy;
- a new version installs in the background and waits, then becomes active when the user agrees, and the page reloads into it;
- a client of the old version keeps loading its files, from the previous version's cache;
- a version with a file that fails its hash does not install, and the old version stays active;
- a version that replaces the active one takes over at once and reloads its clients;
- removing the service worker deletes its caches and unregisters it, and leaves the app's IndexedDB data as it was;
- a cleared cache is repaired;
- `/sw.js` and `/sha256sums.txt` always come from the host.

## 14. Not covered

- The web app manifest, install prompts, persistent storage and the interface that shows an update, which `@shkriuss/pwa` and `@shkriuss/shell` build on this spec without changing it.
- Push messages, background sync and share targets. They need a change to this spec first, and most of them an ADR.
- Navigation preload and the Service Worker Static Routing API, which would only make it faster.
