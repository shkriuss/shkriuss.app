# Water

Documents for Water (`app.shkriuss.water`), the pilot app: log the water
you drink, see how close you are to your daily goal, and get reminders
during the hours you choose.

Pages:

- [Specification](spec.md): every screen, the data, units, reminders,
  settings, backup contents, permissions and TalkBack notes, and what is
  out of scope for version 1.0. Written in step 2.1. Steps 2.2 to 2.5
  built the app from it.

Not written yet, both in step 2.6: the release checklist of 1.0.0, and
the user guide, `docs/user/water.md`, in [user/](../../user/README.md).

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
