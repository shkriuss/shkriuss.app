# 0010 Exact alarms and reminder storage

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 3, 8 and 16

## Context

- Calendar, Reminders, Tasks and Water show reminders at set times.
- Every release checks that reminders fire on time with the screen off,
  and after a reboot and unlock (section 16).
- WorkManager is used in the Sync app only (section 3).

## Decision

1. Exact alarms use `AlarmManager`, and only through `core/notify`.
2. Calendar, Reminders, Tasks and Water declare `USE_EXACT_ALARM`.
3. Alarms are registered again after a reboot, an app update and a
   time-zone change.
4. Reminder data stays in credential-encrypted storage.
5. Deferred, not decided: an opt-in mode that keeps only times and a
   generic title available before the first unlock may be added later.
6. The docs explain two system limits:
   - A locked Private Space stops its apps.
   - Secondary profiles deliver notifications only while they are running.

## Options rejected

None recorded. The opt-in mode in point 5 is deferred, not rejected.

## Consequences

- Nothing fires between a reboot and the first unlock.
- Reminders in a locked Private Space, or in a secondary profile that is
  not running, are not delivered.
- `USE_EXACT_ALARM` is listed with its reason in
  `docs/security/permissions.md` ([CLAUDE.md](../../CLAUDE.md)).
