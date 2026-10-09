# Service worker end-to-end tests

A small test app, never deployed, that tests the service worker of `@shkriuss/pwa` in real browsers: Chromium, Firefox and WebKit, at phone and tablet sizes ([service worker spec](../../docs/specs/service-worker.md) §13). The tests need several versions of one app at one origin, as a host serves each version in turn, so this app has five builds (`builds.ts`):

| Build     | What it is                                                                |
| --------- | ------------------------------------------------------------------------- |
| `a`       | A version of the app                                                      |
| `b`       | The next version                                                          |
| `broken`  | A version with a file that the host changed after the build hashed it     |
| `fix`     | A version that replaces `a` as a broken version (`pwa({ replaces })`, §8) |
| `removal` | A build that turns service workers off (`pwa({ remove: true })`, §9)      |

The tests show that:

- the app works offline after its first load, and a page from the kept version has the build's Content-Security-Policy, though its cache lost it;
- a navigation to a file of the version gets that file, offline too;
- a new version installs in the background and waits until the user agrees, then the page reloads into it;
- an update downloads only the files that changed, and copies the others;
- a window of the old version keeps loading its files, then reloads into the new one;
- a version with a file that fails its hash does not install, and the old one stays;
- a version that replaces the active one takes over at once and reloads its windows;
- removing the service worker deletes its caches and unregisters it, and keeps the app's IndexedDB data;
- a version whose cache was cleared gets its files again, and works offline again;
- a file of the version that a page changed in Cache Storage is not served, and comes back;
- `/sha256sums.txt` and `/sw.js` always come from the host.

## The test server

`server.ts` serves every build at `http://127.0.0.1:4175`:

- each build has a `wrangler dev` of its own, Cloudflare's asset server with the build's `_headers`, as in production;
- in front of them, a proxy sends each request, unchanged, to the build that the browser context's `build` cookie names. Requests of the service worker carry the cookie too, so each context sees one build at a time, and the tests run in parallel;
- with `build=offline`, the proxy closes every connection instead, so every request that reaches the network fails, as offline, in every browser;
- with `log=<name>`, the proxy records the path of every request that it sends on, and `GET /__requests/<name>` answers them, once, so a test can tell what reached the host.

| Command                                 | What it does                                 |
| --------------------------------------- | -------------------------------------------- |
| `pnpm --filter @shkriuss/pwa-e2e build` | Builds the five versions into `dist/<build>` |
| `pnpm --filter @shkriuss/pwa-e2e e2e`   | Starts the test server and runs the tests    |

The fixture of `@shkriuss/config/playwright` fails a test on any CSP or integrity violation, error or failed request of a page or of its workers, the service worker included in Chromium. Two tests open text files, which browsers show with an inline style of their own that the Content-Security-Policy refuses; they allow that refusal only.
