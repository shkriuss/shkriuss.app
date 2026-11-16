package app.shkriuss.feature.water

import android.app.Activity
import android.content.Context
import android.content.Intent
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.feature.water.data.WaterDatabase
import java.io.File
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Everything of Water that lives as long as the app: its database, the
 * repository on it, the phone's local time, today's date for the screens,
 * the reminders, and backup and restore. The app class builds one, calls [start] when the app starts,
 * and hands it out through [WaterHost]. Nothing here is found by a lookup:
 * the ViewModels get what they need through their constructors.
 *
 * [open] is the screen a tap on a reminder opens, Today. [notify] gives
 * the app's one `Notify`, which the app class builds with [reminders], so
 * it is read only when a reminder needs it. [crypto] is the app's one
 * `ShkCrypto`, made with [APP_NAME]: its backup keys lock a backup. [work]
 * runs the reminders' reads after a change, and the reads of the keys, off
 * the main thread.
 */
class WaterServices(
    context: Context,
    /** The app's one database. */
    val database: WaterDatabase,
    clock: Clock,
    ids: IdSource,
    open: Intent,
    notify: () -> Notify,
    crypto: ShkCrypto,
    zone: () -> ZoneId = ZoneId::systemDefault,
    work: CoroutineContext = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + work)

    /** The phone's local day and time. */
    val time: WaterTime = WaterTime(clock, zone)

    /** Today's date, for every screen: the one source that the ViewModels observe. */
    val today: WaterToday = WaterToday(time, scope)

    /** The drinks, the goals and the settings. After every change, the reminders follow. */
    val repository: WaterRepository = WaterRepository(database, clock, ids) { change -> reminders.afterChange(change) }

    /** The reminders: the app's `AlarmSource`, `AlarmHandler` and `ButtonHandler`. */
    val reminders: WaterReminders = WaterReminders(context, repository, time, ReminderBook.of(context), open, notify, work)

    /** Backup and restore, and what Settings shows about the recovery key and the app lock. */
    val backups: WaterBackups = WaterBackups(
        Backups(
            context.contentResolver,
            crypto.backups,
            APP_NAME,
            WaterBackupContent(database, clock, ids),
            // In the no-backup files folder, next to the keys, and not in the cache folder, which Android may empty
            // at any time (docs/architecture/backup-format.md, "Staging").
            File(context.noBackupFilesDir, STAGING_FOLDER),
            clock,
            work,
        ),
        crypto,
        reminders,
        time,
        clock,
        zone,
        work,
    )

    /**
     * Call once in the app class's `onCreate`. It calls `Backups.start()`,
     * which empties what a restore left behind when the app stopped in the
     * middle of it. Then, off the main thread, it finishes a pending move
     * of the file keys, which Water may do because it stores no files
     * (docs/apps/water/spec.md, "Files", point 3).
     */
    fun start() {
        backups.start()
        scope.launch { backups.keys() }
    }

    companion object {
        /** The name of the app in keys and backups (docs/apps/water/spec.md). The app class makes its `ShkCrypto` with it. */
        val APP_NAME: AppName = AppName.of("water")

        /** The folder a restore puts a backup aside in, until the whole of it was checked. Only `Backups` uses it. */
        private const val STAGING_FOLDER = "shk-restore"
    }
}

/**
 * The app class of Water. Android creates the screens itself, so they reach
 * [WaterServices] through the app class, as the screens of `core/security`
 * reach its `SecurityHost`.
 */
interface WaterHost {
    /** The app's one [WaterServices]. */
    val water: WaterServices
}

/** The [WaterServices] of the app this screen belongs to. */
val Activity.waterServices: WaterServices
    get() = (application as? WaterHost ?: error("The app class must implement WaterHost")).water
