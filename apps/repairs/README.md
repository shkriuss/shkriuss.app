# Repairs

A record of every repair, vehicle by vehicle. Made first for a technician
working on city buses (Isuzu Novociti Life), and just as useful for keeping a
private car's service history. Lives at <https://repairs.shkriuss.app>.

- `src/lib/repairs.ts`: the rules as plain functions, with unit tests next to
  them (`repairs.test.ts`). Three lists, saved on the device and synced
  separately:
  - vehicles (`shkriuss:repairs-vehicles`): a name or number (a bus number, a
    plate, "My car"), and optionally the model, number plate and notes. Typing
    a new vehicle in the repair form adds it (`readRepair` returns it as
    `newVehicle`). Deleting a vehicle deletes its repairs, after asking;
  - repairs (`shkriuss:repairs`): the vehicle (by id, so it can be renamed),
    the day, the mileage, the system (brakes, doors…), the damage found, the
    work done, the parts replaced (name, part number, quantity, price each;
    up to 30, which the form says under "Add a part", and that button goes
    once there are 30), the hours worked and the labour (and other) cost. Version 2 added the
    hours, labour and prices, version 3 the photos' ids; `migrateRepairs`
    upgrades older versions (here, from a backup, or from a device that synced
    before), leaving them unknown or empty;
  - settings (`shkriuss:repairs-settings`): kilometres or miles, and the
    currency, only for showing (nothing is converted). Saved only once
    changed.
- The list shows the latest day first. Search looks at every word typed in the
  vehicle (name, model, plate), system, damage, work and parts; a word of only
  letters and digits must start a word, so "7" finds Bus 7 but not a part
  number with a 7 inside (`matchesSearch`). The vehicle filter, or a
  vehicle's "Show repairs", shows one vehicle's history. The list is drawn
  again once typing pauses, and how many repairs a search or the filter
  finds is read out to screen readers ("2 repairs found.").
- Suggestions: the systems in `SYSTEMS` (for city buses first) and any typed
  before; the part names used before, and their last part number, filled in
  when the name is chosen (`partNames`); the vehicles; the models
  (`MODELS`, plus the ones used). The mileage field shows the last mileage
  noted for the vehicle (`lastMileage`).
- Costs: a repair's cost is its priced parts (quantity × price) plus labour
  (`repairCost`); nothing priced means no cost, not zero. Each part's
  quantity × price is rounded once, to the currency's own decimals, as it's
  shown (`partCost`: 2.5 litres at $3.45 is $8.63), and the sums add up those
  shown amounts, so they match what's on the screen. Hours and costs are
  added up for each day, for what the list shows, and for each vehicle
  (`totals`). A part chosen from the suggestions gets its last price too.
  A price or labour cost typed in a way that could be read two ways, like
  "1.500" in French (1500 or 1.5), is asked again.
- "Download as a spreadsheet (CSV)" saves every repair, one row each, with
  the hours and the parts, labour and total cost. Text a spreadsheet could
  read as a formula starts with `'`. The file starts with a byte-order mark,
  so Excel shows text beyond plain English letters (Georgian, "’", the "×"
  of a part's quantity) as typed. In a language that writes decimals with a
  comma, cells are split by ";" and numbers written "12,5", as spreadsheets
  there read them (audit 4 F2-9).
- Repairs keeps up to 3,000 repairs (`LIMITS.repairs`). Why not more: each
  repair is saved on the device, where a browser keeps about 5 MB for each
  site, and with sync on, sync keeps records of its own there too. The test
  "has room for every repair" fills Repairs up with modest repairs (200
  characters of text, two parts on most, a photo or two on some) and checks
  that it all still fits, on an iPhone too, and in the copy that syncs. If a
  change makes repairs bigger, that test fails, and the limit has to come
  down. (Photos aren't counted: they're kept in IndexedDB, which holds far
  more.)
- To make room, "Delete a year…" (next to the spreadsheet download) deletes
  every repair of one year, with its photos (`repairYears`, `removeYear`).
  It says how many that is, and offers the spreadsheet first. With sync on,
  the repairs and their photos are deleted on the other devices too. If
  that year changes on another device or tab while the dialog is open, it
  closes and says so, rather than deleting another year or more than it
  said; so does "Delete Bus 105?" when the bus's repairs change. Once more
  than 90% of the 3,000 are used, a note at the top says how many are left
  and points to it (`roomNote`).
- Photos (up to 10 a repair): picked with "Add photos" (the phone offers its
  camera or its photo library), made smaller on the device (1,600 pixels on
  the longest side, plus a 320-pixel thumbnail, saved again as JPEG, which
  drops the location the camera wrote in) and kept in IndexedDB through
  `@shkriuss/storage/files`
  ([ADR 0013](../../docs/adr/0013-photos-on-the-device.md)). A repair keeps
  only their ids (data version 3). With sync on, the photos sync too
  ([ADR 0014](../../docs/adr/0014-syncing-photos.md)): each one as two files
  sealed on the device, `<id>.thumb` and `<id>.full` (`photoFiles`). Another
  device downloads the thumbnail when the list shows it and the full photo
  when it's opened, and says "1 photo hasn't arrived yet" until it can (with
  sync off: "1 photo on another device"). A photo is saved small enough to
  sync (`MAX_PHOTO_BYTES`, `PHOTO_QUALITIES`). Photos aren't in backups;
  "Save a copy" saves one as a file. Deleting a repair, a vehicle or a year
  deletes their photos (online too, with sync on); "Delete all data"
  deletes them on this device only (sync is turned off first). A photo
  taken off a repair in its form, or deleted with it, goes only once the
  change is saved: if it can't be (a full device), the repair as saved
  still has its photos. With sync off, photos a repair lists that aren't on
  this device (a backup restored on a new phone, say) can be taken off it
  in its form ("Take them off this repair"). A photo taken off a repair on
  another device is deleted here at the next sync.
  Any other photo no repair uses (left by an older backup restored, say) is
  deleted when Repairs opens and after each sync, unless it was saved in
  the last minute (`deleteUnusedPhotos`).
  `src/scripts/photos.ts` does the photo work; `make-photo.worker.ts` makes
  picked photos smaller in a web worker (with `@shkriuss/ui/photos`), so a
  big photo doesn't freeze the page.
- `src/scripts/repairs.ts`: connects the page to those rules: the lists,
  search, settings and deleting, and keeping up with other devices and
  tabs. The repair form is in `repair-form.ts` (its photos in
  `form-photos.ts`), the vehicle form in `vehicle-form.ts`, "Delete a
  year" in `delete-year.ts`, and the photo viewer in `photo-viewer.ts`.
  Each loads the first time it opens (`later`), so the page stays within
  its size budget.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a day, a repair, a vehicle and a part row;
  the forms and "Delete a year" are dialogs.
- `src/worker.ts`: runs the shared sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)), with files on for the
  photos (`syncHandler({ files: true })`). The newest change to
  each vehicle, repair and setting wins. A repair's form that's open while
  a sync (or another tab) changes the repair saves only what was changed in
  it (`readEditedRepair`), and its photos follow the repair's while it's
  open (`mergePhotos`): a photo added on another device meanwhile stays,
  and one taken off in the form stays off. The vehicle form saves only
  what was changed in it too. Vehicles and repairs reach
  `withItems` unchecked, so ones from an older version can be upgraded first;
  they're checked after.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
