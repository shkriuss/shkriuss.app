# 0013. Photos on the device

Status: Accepted (2026-10-21). Extends [ADR 0006](0006-local-first-data.md).
Extended by [ADR 0014](0014-syncing-photos.md): with sync on, photos sync
too, each sealed on the device.

## Context

Repairs needs photos of the damage and of the work. Everything else apps save
lives in `localStorage` ([ADR 0006](0006-local-first-data.md)): about 5 MB
for the whole app, strings only. One phone photo is 2–5 MB, so photos need
somewhere else. The data must still stay on the device, other sites must not
read it, and "Delete all data" must delete it.

## Decision

- **Where:** the browser's IndexedDB, through `@shkriuss/storage/files`
  (`createFileStore(kind)`): one database per site (`shkriuss-files`), files
  saved as Blobs under `"<kind>:<id>"`. Browsers give IndexedDB far more room
  than `localStorage` (usually a share of the free disk space). Once a photo
  is saved, the app asks the browser to keep its storage even when the device
  runs low (`keepFiles()`, `navigator.storage.persist()`).
- **Smaller first:** a photo is read on the device and saved again as a JPEG,
  at most 1,600 pixels on its longest side (a few hundred KB), with a
  320-pixel thumbnail for lists. Saving it again also drops what the camera
  wrote into the file, like the GPS location.
- **The record keeps the ids:** a repair lists its photos' ids. The ids sync
  with the repair; the photos themselves sync on their own
  ([ADR 0014](0014-syncing-photos.md)). With sync off, another device shows
  "1 photo on another device".
- **Deleting:** deleting a repair or a vehicle deletes its photos; "Delete
  all data" (`DataControls`) deletes the whole database
  (`deleteAllFiles()`), in every app.
- **No new permissions:** `<input type="file" accept="image/*">` lets the
  phone offer its camera or its photo library itself; the `camera`
  permission (for live video) stays off. `img-src` already allows `blob:`.

## Consequences

- Photos work offline and never leave the device: no server, no cost.
- They didn't sync between devices at first; [ADR 0014](0014-syncing-photos.md)
  added that, for when sync is on.
- **They aren't in backup files** (backups hold `localStorage` only, up to
  20 MB). Each photo can be saved as a copy instead. Adding them to backups
  means a bigger, multi-file backup format.
- Clearing the browser's data for the site deletes the photos, like all other
  data. Safari may clear a site's storage after 7 days without a visit,
  unless the app was added to the Home Screen.

## Alternatives

- **Photos as text (base64) in `localStorage`:** a few photos would fill it.
- **The Cache API** (like Grammar's model, [ADR 0012](0012-deep-check-ai-model.md)):
  meant for copies of downloads, not for things people make.
- **Uploading photos to a server:** against [ADR 0006](0006-local-first-data.md)
  without the encrypted file storage above; left for later.
