# Photos

Your photo library, kept as the original files. Lives at
<https://photos.shkriuss.app>. Design and reasons:
[ADR 0015](../../docs/adr/0015-photos-app.md).

- `src/lib/photos.ts`: the rules as plain functions, with unit tests next to
  them (`photos.test.ts`): a photo's details (`Photo`), newest first
  (`byNewest`), grouped by month (`byMonth`), and how things are shown (month
  names, when it was taken, sizes, the name to save the original as, what
  happened when photos were picked).
- `src/lib/exif.ts`: when a JPEG was taken, from what the camera wrote in it
  (Exif `DateTimeOriginal`, else `DateTime`), as the camera's local time.
- `src/scripts/process.worker.ts`: reads each picked photo in a web worker
  (started by `process.ts`): its SHA-256 (so the same photo isn't added twice),
  when it was taken, a 512-pixel JPEG thumbnail and a 2,048-pixel JPEG for
  looking at it. The original is kept exactly as picked.
- `src/scripts/library.ts`: the library on this device, in IndexedDB through
  `@shkriuss/storage/files`: each photo's details (`photo:<id>`) and its
  files (`photo-files:<id>`: the original and the two copies).
- `src/scripts/photos.ts`: connects the page to all that: the grid by month
  (120 at a time, "Show more"), adding photos, the viewer (Previous/Next and
  the arrow keys, its details, "Save original", Delete), and "Select" to save
  or delete several.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a month and a photo.
- Photos a browser can't show (like HEIC outside Safari) are kept anyway: the
  grid shows their kind, and "Save original" works.
- No backup files: photos are too big for them (`<DataControls backup={false}>`).
  "Delete all data" deletes the photos.
- `e2e/`: browser tests (`helpers.ts` makes photos, with the date a camera
  writes in them). The shared accessibility, security and offline checks run
  too.

Next: keeping the library online (Cloudflare R2), sealed on the device, and
syncing it between devices.
