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
    work done, the parts replaced (name, part number, quantity, price each),
    the hours worked and the labour (and other) cost. Version 2 added the
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
  vehicle's "Show repairs", shows one vehicle's history.
- Suggestions: the systems in `SYSTEMS` (for city buses first) and any typed
  before; the part names used before, and their last part number, filled in
  when the name is chosen (`partNames`); the vehicles; the models
  (`MODELS`, plus the ones used). The mileage field shows the last mileage
  noted for the vehicle (`lastMileage`).
- Costs: a repair's cost is its priced parts (quantity × price) plus labour
  (`repairCost`); nothing priced means no cost, not zero. Hours and costs are
  added up for each day, for what the list shows, and for each vehicle
  (`totals`). A part chosen from the suggestions gets its last price too.
- "Download as a spreadsheet (CSV)" saves every repair, one row each, with
  the hours and the parts, labour and total cost. Text a spreadsheet could
  read as a formula starts with `'`.
- Photos (up to 10 a repair): picked with "Add photos" (the phone offers its
  camera or its photo library), made smaller on the device (1,600 pixels on
  the longest side, plus a 320-pixel thumbnail, saved again as JPEG, which
  drops the location the camera wrote in) and kept in IndexedDB through
  `@shkriuss/storage/files`
  ([ADR 0013](../../docs/adr/0013-photos-on-the-device.md)). A repair keeps
  only their ids (data version 3), so the ids sync but the photos don't:
  another device says "1 photo on another device". Photos aren't in backups;
  "Save a copy" saves one as a file. Deleting a repair or vehicle, or all
  data, deletes its photos. `src/scripts/photos.ts` does the photo work.
- `src/scripts/repairs.ts`: connects the page to those rules.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a day, a repair, a vehicle and a part row;
  the forms are dialogs.
- `src/worker.ts`: runs the shared sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). The newest change to
  each vehicle, repair and setting wins. Vehicles and repairs reach
  `withItems` unchecked, so ones from an older version can be upgraded first;
  they're checked after.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
