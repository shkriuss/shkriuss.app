# Water

Documents for Water (`app.shkriuss.water`), the pilot app: log the water
you drink, see how close you are to your daily goal, and get reminders
during the hours you choose.

Pages:

- [Specification](spec.md): every screen, the data, units, reminders,
  settings, backup contents, permissions and TalkBack notes, and what is
  out of scope for version 1.0. Written in step 2.1. Steps 2.2 to 2.5
  built the app from it.

- [Release checklist 1.0.0](release-checklist-1.0.0.md): every check on
  the phones before and after the release of 1.0.0, with the steps
  written out. Written in step 2.6.

For users:

- The user guide: [water.md](../../user/water.md), with the known
  problems of 1.0.0. Written in step 2.6.
- What Water stores, and what leaves the phone:
  [data-inventory.md](../../security/data-inventory.md#water-appshkriusswater)
  and, in plain words, [privacy.md](../../user/privacy.md).

Code:

- `android/feature/water`: the data and logic, from step 2.2. The
  database, the repository, the rules of the specification as plain code,
  the ViewModels and the backup content. Its package `ui` holds the
  screens, from step 2.3: Today, History with the open day, Settings, the
  drink sheet and the dialogs. From step 2.5: backup and restore, the
  rows of the recovery key and the app lock in Settings, and Licences.
- `android/app/water`: the app, from step 2.2. Its one activity shows the
  screens inside the app lock's gate. Its tests hold the screenshots of
  every screen, sheet and dialog, and the check that each is behind the
  app lock.
- What changed in each version:
  [CHANGELOG.md](../../../android/app/water/CHANGELOG.md).
- How the modules fit together:
  [modules.md](../../architecture/modules.md).
