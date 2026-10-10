# Service worker

- **Status:** accepted, 2026-10-06 (Phase 1.2)
- **Implements:** [architecture §9](../architecture.md#9-offline-install-and-updates), [ADR 0016](../decisions/0016-frontend-stack-as-built.md) (our own service worker) and [ADR 0011](../decisions/0011-worker-trusted-types-policy.md) (starting it under Trusted Types)
- **Implemented by:** `@shkriuss/pwa` (Phase 1.2)

Every app has a service worker at `/sw.js`. It makes the app work offline after its first load: it keeps a checked copy of every file of one version of the app and answers the app's requests from it. Large files that the app keeps on first use come into that copy once the app has used them. It also decides when a new version takes over: it installs in the background and waits until the user agrees, so an update never interrupts a task, unless it replaces a broken version (section 8).

It never stores user data, which lives in IndexedDB ([data-model.md](data-model.md)), and it never answers requests for other origins. **Must**, **must not**, **should** and **may** are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Terms

- **Version:** one build of an app, as deployed. Its **version id** is 16 lowercase hexadecimal digits (section 2.2).
- **Precache list:** the files of a version that the service worker keeps, each with its SHA-256 (section 2.1).
- **Files kept on first use:** files of the precache list that the service worker keeps only once the app has requested one of them, not at install (section 2.1).
- **App shell:** the version's `/index.html`, which answers every navigation that is not to a file.
- **Client:** a tab or window of the app. The **active** service worker controls the clients; a **waiting** one has installed a newer version and waits to take over.

## 2. What a build publishes

### 2.1 The precache list

Every file that the build's `sha256sums.txt` lists ([ADR 0007](../decisions/0007-security-baseline.md)), except `/sw.js` and `/.well-known/security.txt`, with the SHA-256 it gives. `sha256sums.txt` lists every file the app serves but itself.

`security.txt` expires a fixed time after the commit that the build is made from, so it changes with every commit. In the list, it would make every commit a new version, which every installed app would download and announce though nothing in it changed. It need not work offline.

An app may keep large files on first use, such as Grammar's WebAssembly module, which not every use of the app needs ([ADR 0019](../decisions/0019-files-kept-on-first-use.md)). It names them by the ends of their names, such as `.wasm`, and the list marks them. The service worker keeps them once the app first requests one (section 6.3), and from then on at every install (section 4). Until then they need the network. The build fails if an end matches no file, or the app shell.

Each file is requested at the URL the host serves it from without a redirect: `/index.html` at `/`, `/<path>/index.html` at `/<path>/`, `/<name>.html` at `/<name>`, and every other file at its own path. The build fails if two files would be served at one URL, or if it has no `/index.html`.

### 2.2 The version id

The first 16 hexadecimal digits of the SHA-256 of `/sw.js` as it would be with sixteen zeros as its version id.

- Any change to a file of the precache list, to the security headers, to the service worker's code or to the versions it replaces gives a new version id, and the same build always gives the same one.
- The browser installs a new service worker exactly when `/sw.js` changes, so every service worker it installs has a version id, and a cache (section 4), of its own.

### 2.3 `/sw.js`

- One classic script, built from `@shkriuss/pwa`, with no `importScripts()` ([ADR 0011](../decisions/0011-worker-trusted-types-policy.md)). It contains its version id, its precache list, the security headers that the host sends with every file of the build (section 6.5) and the versions it replaces (section 8).
- It changes whenever the version does, so the browser finds a new version by comparing it byte for byte.
- It is served with the same security headers as every other file of the app, so the Content-Security-Policy applies inside it. As every worker script, it starts with code that logs each violation of the policy inside it on its console, where the end-to-end tests see it ([architecture §12](../architecture.md#12-security)).
- It is listed in `sha256sums.txt`, but browsers cannot check its integrity ([threat model](../threat-model.md#5-residual-risks-accepted) R6).

## 3. Registration

- The page registers `/sw.js` with scope `/` and `updateViaCache: "none"`, through `@shkriuss/edge/workers` ([ADR 0011](../decisions/0011-worker-trusted-types-policy.md)), once the page has loaded. Development builds register none, and neither do builds that turn service workers off (section 9).
- Where the browser has no service workers, or refuses one, as some private windows do, the app works online only.
- If registering fails, for example because `/sw.js` could not be fetched, or the first version fails to install (section 4), which leaves the browser no service worker, the app works online only too, rather than wait for one. The page registers again when the device comes back online, and when it becomes visible or stays open, once an hour has passed since it last tried (section 7.1).

## 4. Install

When the browser has fetched a new `/sw.js`, the new service worker installs its version:

1. It opens the cache `pwa-<version id>`.
2. It copies each file of the precache list, files kept on first use included, that the cache of another version keeps under the same URL with the same SHA-256, which the service worker computes from the kept bytes: an update downloads only the files that changed. It looks in every cache whose name starts with `pwa-`, but `pwa-state`, and copies only a response with status 200, with its `Content-Type` and no other header (section 6.5).
3. It requests every other file with `cache: "no-cache"`, `redirect: "error"` and the file's SHA-256 as the request's `integrity`, so the browser checks every byte. It keeps each response in the cache under its URL, with status 200, its `Content-Type` and no other header (section 6.5). It requests files kept on first use only if `pwa-state` records that the app has kept one (section 6.3), so that an app that has used them keeps working offline after an update.
4. Any failure fails the install: a network error, a status other than 200, a redirect, a hash that does not match, storage that is full, or a cache that is gone before the install has finished, as when another version that becomes active meanwhile deletes it (section 5). The service worker stops its other requests, deletes its cache, and the active version stays active. The browser tries again on a later update check (section 7.1).
5. Once it has installed, it deletes the caches of the waiting versions that it replaces, which will never become active: every cache whose name starts with `pwa-`, except its own, those of the active and the previous version, as `pwa-state` records them (section 5), and `pwa-state`. It deletes none while a version is becoming active, which may be one of them before it has recorded itself.

So a version is installed complete and checked, or not at all, whether it copied its files or downloaded them. A deployment during an install changes some of its files, which then fail their hashes; a later update check installs the newer version.

The cache of a failed install is kept only if it belongs to the active or the previous version, as `pwa-state` records them (section 5). That happens only when the browser installs the active version's `/sw.js` again, for example when the host serves it again after a newer version that is still waiting.

## 5. Activate

A version becomes active:

- at once, when no version was active, as on the first load;
- when the user agrees to an update (section 7.2), or once no client uses the old version any more;
- at once, when it replaces a broken version (section 8).

Then the service worker:

1. records, in the cache `pwa-state`, its version id as the active one, and the version it took over from as the previous one;
2. deletes every cache whose name starts with `pwa-`, except its own, the previous version's and `pwa-state`: those of older versions, and of versions that never became active. It deletes none while a newer version installs, whose cache it cannot tell from an old one; that version deletes them once it has installed (section 4);
3. takes control of every client with `clients.claim()`, so the app works offline right after its first load. A page that gets its first controller this way does not treat it as an update (section 7.3).

## 6. Fetch

### 6.1 Which requests

The service worker answers only `GET` requests for URLs of the app's own origin. Every other request goes to the network as if there were no service worker. It stores no response but those it precaches (sections 4 and 6.4).

### 6.2 Navigations

A navigation is matched by the path of its URL; its query does not matter, as for the host.

- A navigation to the URL of a file of the precache list, `/` included, is answered with that file from the active version's cache (section 6.5).
- A navigation to `/sw.js`, `/sha256sums.txt` or `/.well-known/security.txt` goes to the network.
- Any other navigation is answered with the app shell, whatever its path and query, as the host's single-page fallback does. The app's router then shows the page, or its own "not found" page.

### 6.3 Other requests

A request for the exact URL of a file of the active version is answered from the active version's cache (section 6.5), or else from the network (section 6.4). Any other request is answered with the response kept under its exact URL in the previous version's cache, or else from the network. So a client that still runs the previous version keeps loading its own files (section 7.3), and the page's integrity checks still apply to every script.

A request for a file of the active version that is kept on first use, and that the active version's cache does not have, goes to the network as the requests of section 4 do. The service worker keeps the response in the active version's cache, records in `pwa-state` that the app has kept a file on first use, and answers with it. If the request fails, as offline or for a file that fails its hash, the request fails, as without a service worker. The page can read that record, to start at once what needs such a file.

### 6.4 Repair

If a file of the active version is missing from its cache, because the browser or the user cleared Cache Storage, or fails its check (section 6.5), the request goes to the network, though the previous version's cache may have a file under the same URL: it may be another file, as the previous version's app shell is. The service worker then requests the files that its cache lacks again, in the background, with the checks of section 4, but those kept on first use, which come again when they are next requested. A repair that fails, for example offline, is tried again at the next miss.

### 6.5 Checks before serving

Pages of the app can write to Cache Storage, as the service worker does. A script injected into a page could change a file that the cache keeps, or its headers, and the changed file would then be served on every launch, offline too, perhaps without the Content-Security-Policy. So each time the service worker answers with a file of the active version from its cache:

- it checks the file's SHA-256 again, and its status, which must be 200. A file that fails is deleted from the cache and handled as a missing one (section 6.4);
- it answers with the file's `Content-Type` and the security headers that `/sw.js` contains (section 2.3), and with no other header, whatever the cache keeps. A header that the cache keeps is only as trustworthy as the page that could have written it: served as kept, a reporting policy that a script had added would make every launch report to whoever it names, offline too, long after the script was gone.

The files of the previous version are served as they are kept: the service worker does not know their hashes. Only requests for URLs that are not files of the active version reach them, such as those of clients that still run the previous version (section 7.3).

## 7. Updates

### 7.1 Checking

The browser checks for a new `/sw.js` on navigations to the app. Installed apps often stay open for days, so the page also asks the browser to check (`registration.update()`) when it becomes visible, when the device comes back online, and every ten minutes while it stays open, once an hour has passed since the last check. A check that fails, for example offline, is not retried until the next one.

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
2. deletes every cache of the service worker, those whose names start with `pwa-`;
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

| Failure                                                       | What happens                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| An install fails (section 4)                                  | The active version stays; a later update check tries again.                            |
| The first version fails to install (section 3)                | The app works online only; the page registers again later.                             |
| A file of the active version is missing from its cache        | The request goes to the network, and the version gets its files again (section 6.4).   |
| A file of the active version fails its check (section 6.5)    | It is deleted; the request goes to the network, and the version gets it again.         |
| Offline, a request that the cache cannot answer               | It fails as it would without a service worker.                                         |
| Offline, a file kept on first use that the app has not used   | It fails as it would without a service worker; the app says that it needs the network. |
| Cache Storage fails, as when the browser's storage is damaged | Requests go to the network, as without a service worker.                               |
| A client needs a file that is gone (section 7.3)              | The app shows an error that asks the user to reload.                                   |
| A newer version upgraded the database                         | The client reports that it must reload ([data-model.md §7](data-model.md#7-storage)).  |

## 12. Security

- The service worker serves only files of the active and the previous version, each checked against its SHA-256 when it keeps it: at install, or on its first use (section 6.3). A file changed on the host or on the way fails the install and is never served. It checks the active version's files again each time it serves them, and serves them with their `Content-Type` and the build's security headers only, so a script injected into a page cannot change them, or their headers, through Cache Storage (section 6.5).
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
- an update downloads only the files that changed, and copies the others;
- a file kept on first use is not downloaded at install; its first request is checked, kept and answered, and it is served offline afterwards; a file that fails its hash is neither served nor kept; once the app has used one, an update copies or downloads them at install;
- a version that replaces the active one takes over at once and reloads its clients;
- removing the service worker deletes its caches and unregisters it, and leaves the app's IndexedDB data as it was;
- a cleared cache is repaired;
- a file of the active version that a page changed in Cache Storage is not served, and is repaired, and a page from the cache has the build's headers, though the cache lost them;
- `/sw.js` and `/sha256sums.txt` always come from the host.

## 14. Not covered

- The web app manifest, install prompts, persistent storage and the interface that shows an update, which `@shkriuss/pwa` and `@shkriuss/shell` build on this spec without changing it.
- Push messages, background sync and share targets. They need a change to this spec first, and most of them an ADR.
- Navigation preload and the Service Worker Static Routing API, which would only make it faster.
