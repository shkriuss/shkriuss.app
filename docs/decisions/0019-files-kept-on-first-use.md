# ADR 0019: Large files kept on first use

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The service worker keeps every file of a version when it installs, so that every app works fully offline after its first load ([service worker spec](../specs/service-worker.md) §4). For most apps that is a few hundred kilobytes.

Grammar's WebAssembly module is 16 MB, 8 MB compressed ([ADR 0014](0014-webassembly.md)). The audit of 2026-10-08 measured what keeping it at install costs:

- **Every visit pays for it.** Opening Grammar downloads the module, even to look at the app from the hub, or to read its settings. Every update that changes the module downloads it again on every device that has the app, used or not.
- **The first check waits for it.** The checker waits until the service worker has kept the app, so that the module comes from that checked copy. On Slow 4G, the first check came 49 seconds after the page's heading; on Fast 4G, 11 seconds.

Browsers check no integrity for a module that a worker fetches. The service worker does: it requests every file with its SHA-256 as the request's `integrity`. A worker that the service worker controls gets its module through it.

## Decision

1. **An app may keep large files on first use.** It names them by the ends of their names, such as `.wasm`, in `keepOnFirstUse` of its `app.config.ts`. They are part of the version as any file is, but the service worker keeps them only once the app first requests them. It then requests them as at install, with their SHA-256 as the request's `integrity`, keeps them and answers with them ([service worker spec](../specs/service-worker.md) §2.1, §6.3).
2. **Once used, always kept.** The service worker records in `pwa-state` that the app has kept a file on first use. From then on, every new version keeps those files at install: it copies them if they have not changed, and downloads them otherwise (§4). An app that has used them keeps working offline after every update.
3. **Until its first use, such a file needs the network.** Product rule 2 of `CLAUDE.md` says so: every app works fully offline after its first load, but for the files that it keeps on first use, which work offline once used.
4. **Grammar keeps its module on first use.** Its checker starts when there is text, or at once when the app opens if the module is kept or the app runs installed, so that an installed app works offline from its first open. It still waits until the service worker controls the page, so that the module comes through it, checked ([Grammar spec](../specs/apps/grammar.md) §1). This replaces the last item of point 3 of ADR 0014.
5. **Tests prove it,** end to end, in Chromium, Firefox and WebKit: a file kept on first use is not downloaded at install; its first request is checked, kept and answered, and it is served offline afterwards; a file that fails its hash is neither served nor kept; once the app has used it, an update copies or downloads it at install.

## Consequences

- Opening Grammar without checking a text downloads a few hundred kilobytes instead of 8 MB, and an update that changes the module downloads it only on devices that have used it.
- The first check of a device downloads the module then, as the first visit did before.
- In a browser tab, Grammar's checker works offline only once it has checked a text there. Offline before that, the app says that the checker needs the network the first time.
- The module is still checked against its SHA-256 before it is served or kept, and a worker still gets it through the service worker.
- A page could write the record of a first use into Cache Storage, as it could write any file there. That only makes the service worker download those files at install, and Grammar start its checker sooner.

## Alternatives considered

- **Keep every file at install, as before:** one simple rule, at 8 MB for every visit.
- **Respect Save-Data:** only Chromium sends it, and only for users who turn it on.
- **Download the module in the background after install:** the same 8 MB for every visit, only later.
- **Start the checker on the first text, always:** simpler, but each opening of the app would then wait seconds for the checker at its first text, though the module is kept.
- **A message to the service worker that asks whether a file is kept:** more protocol than reading the record that the service worker already writes.
