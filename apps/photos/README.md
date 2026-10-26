# Photos

Your photo library, kept as the original files, on the device and (with
sync on) online too. Lives at <https://photos.shkriuss.app>. Design and
reasons: [ADR 0015](../../docs/adr/0015-photos-app.md) (on the device) and
[ADR 0016](../../docs/adr/0016-online-photo-library.md) (online).

- `src/lib/photos.ts`: the rules as plain functions, with unit tests next to
  them (`photos.test.ts`): a photo's details (`Photo`), newest first
  (`byNewest`), grouped by month (`byMonth`), and how things are shown (month
  names, when it was taken, sizes, the name to save the original as, what
  happened when photos were picked).
- `src/lib/exif.ts`: when a JPEG was taken, from what the camera wrote in it
  (Exif `DateTimeOriginal`, else `DateTime`), as the camera's local time.
- `src/scripts/process.worker.ts`: reads each picked photo in a web worker
  (asked by `process.ts`): its SHA-256 (so the same photo isn't added twice),
  when it was taken, a 512-pixel JPEG thumbnail and a 2,048-pixel JPEG for
  looking at it (`@shkriuss/ui/photos`, which Repairs uses too). The
  original is kept exactly as picked.
- `src/scripts/library.ts`: the library on this device, in IndexedDB through
  `@shkriuss/storage/files`: each photo's details and where it is
  (`photo:<id>`), its files (`photo-files:<id>`: the original and the two
  copies; only the thumbnail for a photo that's only online), and how far
  this device has caught up with the online library (`photos-online:state`).
- The online library (`@shkriuss/library`, `@shkriuss/sync`):
  - `src/lib/online.ts`: its rules, with unit tests: what changes from other
    devices do here (`applyChanges`, which also keeps the same photo once),
    which photos go up next, what "Free up space" frees, the status line.
  - `src/scripts/online.ts`: does the work after each sync: brings in
    changes, deletes online what was deleted here, puts photos online a few
    at a time, and downloads thumbnails (several at once), screen-sized
    copies and originals when they're needed.
  - `src/worker.ts`: the Worker for `/api/sync/*` and `/api/library/*`.
    `wrangler.jsonc` has the R2 bucket, `shkriuss-photos`.
  - Adding photos online needs the storage code once per account (the
    GitHub secret `PHOTOS_STORAGE_CODE`; see docs/deployment.md).
- `src/scripts/photos.ts`: connects the page to all that: the grid by month
  (120 at a time, "Show more"; each photo is named by when it was taken, to
  the second), adding photos, the viewer (Previous/Next and the arrow keys,
  which read out the photo shown; its details, "Save original", Delete),
  "Select" to save or delete several (its bar stays at the top of the screen
  while choosing, unless large text makes it too tall), and the online
  library's part of "Sync between your devices" (storage code, status, "Free
  up space on this device").
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a month and a photo.
- Photos a browser can't show (like HEIC outside Safari) are kept anyway: the
  grid shows their kind, and "Save original" works.
- No backup files: photos are too big for them (`<DataControls backup={false}>`).
  "Delete all data" deletes the photos.
- `e2e/`: browser tests (`helpers.ts` makes photos, with the date a camera
  writes in them; `online.spec.ts` uses two devices). The shared
  accessibility, security, offline and sync checks run too.
