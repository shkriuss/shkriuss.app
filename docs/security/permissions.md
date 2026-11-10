# Permissions

Every permission each app declares, and why. A pull request that adds a
permission updates this page and has its own decision record
([CLAUDE.md](../../CLAUDE.md)).

## Rules

- Data apps never declare `android.permission.INTERNET`. Only the Sync app
  may (hard rule 4, [ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)).
- No storage permissions. Files come and go only through the system
  pickers.
- Every APK build fails if the app's final manifest declares or requests a
  permission it is not allowed. Today no app is allowed any. The check is
  described in [build.md](../development/build.md#apk-rules-check).

## Apps

### Catalog (`app.shkriuss.catalog`)

No permissions.

Libraries can add permissions to an app without anyone writing them. One
did:

| Permission | Added by | What happens to it |
|---|---|---|
| `app.shkriuss.catalog.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` | Removed in Catalog's manifest. `androidx.core` uses it only on Android 12 and older, and the minimum is Android 13. |

Other components that libraries add, none of them a permission:

- `androidx.startup.InitializationProvider`: not exported. Starts
  libraries when the app starts.
- `androidx.profileinstaller.ProfileInstallReceiver`: exported, but only
  callers with `android.permission.DUMP` can reach it. Normal apps cannot
  get that permission; the system and the developer shell have it. It
  installs the app's start-up profile.
- The emoji font loader from `androidx.emoji2` is removed, because it would
  ask a system font provider, usually Google Play services, for a font.

Catalog stores no data, so Android backup and device-to-device transfer are
turned off.
