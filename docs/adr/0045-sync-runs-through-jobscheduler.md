# 0045 The Sync app runs through JobScheduler

- Status: Accepted
- Date: 2026-11-27
- Source: the owner's choice for Phase 5, step 4, the build of the Sync
  app ([PROMPTS.md](../development/PROMPTS.md)), on 2026-11-27:
  JobScheduler, Android's own, instead of WorkManager. The details are
  Claude's, in the pull request of that step.

## Context

- The Sync app runs every 15 minutes while the phone has a network,
  soon after a data app pokes it, and when the user asks
  ([sync-protocol.md](../architecture/sync-protocol.md#when-the-sync-app-runs)).
  A run must survive a restart of the phone, and Android decides when it
  really runs.
- The plan (section 3), [0003](0003-kotlin-compose-material-3-navigation-3.md)
  and [0005](0005-no-network-permission-in-data-apps.md), point 14,
  named WorkManager for it, in the Sync app only.
- WorkManager is not in the version catalog. It would be a new
  dependency with its own record (hard rule 5). It brings Room 2 beside
  the Room 3 of the suite, and a database of its own. It keeps one
  global instance, which an app replaces with a `Configuration.Provider`
  ([CLAUDE.md](../../CLAUDE.md): no service locators, no global mutable
  state). It sets an alarm of its own to notice a force stop, and adds
  `WAKE_LOCK`, a foreground service and receivers to the manifest,
  which the Sync app would then have to remove.
- Android's own `JobScheduler`, in the platform since Android 5, does
  what Sync needs: a periodic job of 15 minutes, a job soon, a network
  as the condition, and jobs kept after a restart.

## Decision

1. The Sync app runs through `android.app.job.JobScheduler`. It uses no
   WorkManager and adds no dependency.
2. Two jobs: one periodic, every 15 minutes with any network, kept after
   a restart; and one soon, with any network, for a poke and for
   **Sync now**. A request for the job soon while one waits keeps the
   one that waits, unless the user asked and the waiting one did not.
3. Its permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, to wait for a
   network and to tell a metered one, and `RECEIVE_BOOT_COMPLETED`, to
   keep the periodic job after a restart. No `WAKE_LOCK`: Android holds
   one while a job runs.
4. The job service asks callers for `BIND_JOB_SERVICE`, so only Android
   can bind it.
5. Android keeps the jobs. Sync keeps no database of its own.

## Options rejected

- **WorkManager.** A new dependency with Room 2 and a database of its
  own, a global instance, an alarm of its own, and more parts in the
  manifest, for what the platform already does.

## Consequences

- Point 14 of [0005](0005-no-network-permission-in-data-apps.md) and the
  line on WorkManager in [0003](0003-kotlin-compose-material-3-navigation-3.md)
  are superseded by this record. Their status lines say so.
- The Sync app's allow list in the APK rules check holds three
  permissions ([permissions.md](../security/permissions.md#sync-appshkriusssync)).
- Sync keeps its own waits: after three failed runs, the day's limit and
  a full server, a job that runs finds the wait in Sync's state and
  makes no request ([Sync's specification](../apps/sync/spec.md#when-sync-runs)).
- Android drops the jobs of an app that the user force-stopped. Sync
  asks for its periodic job again at every start, which changes nothing
  while the job exists.
