package app.shkriuss.feature.reminders

import android.app.Activity
import android.content.Context
import android.content.Intent
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.io.File
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * Everything of Reminders that lives as long as the app: its database,
 * the phone's clock and time zone, the clock for the screens, the
 * phone-only entries, the repository on them, the notifications, and
 * backup and restore. The app class builds one, calls [start] when the
 * app starts, and hands it out through [RemindersHost]. Nothing here is
 * found by a lookup: the ViewModels get what they need through their
 * constructors.
 *
 * [open] is the screen a tap on a notification opens. [notify] gives the
 * app's one `Notify`, which the app class builds with [alarms], so it is
 * read only when a notification needs it. [crypto] is the app's one
 * `ShkCrypto`, made with [APP_NAME]: its backup keys lock a backup.
 * [work] runs the work on the phone-only file, and the reads of the keys,
 * off the main thread. Tests pass their own, and a [zone] they control.
 */
class RemindersServices(
    context: Context,
    /** The app's one database. */
    val database: RemindersDatabase,
    clock: Clock,
    ids: IdSource,
    open: Intent,
    notify: () -> Notify,
    crypto: ShkCrypto,
    zone: () -> ZoneId = ZoneId::systemDefault,
    work: CoroutineContext = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + work)

    /**
     * The one lock that the handler of an alarm, a press of a button, the
     * source of the alarms and the work on the phone-only file after each
     * write take turns on (docs/apps/reminders/spec.md, "How Reminders
     * uses core/notify", point 3).
     */
    private val turns = Mutex()

    /** The phone's clock and time zone. */
    val time: RemindersTime = RemindersTime(clock, zone)

    /** The clock for every screen: the one source that the ViewModels observe. */
    val now: RemindersNow = RemindersNow(time, scope)

    /** What this phone remembers of each reminder: its mark, its snooze and its notification on screen. */
    private val book = ReminderBook.of(context)

    /** The reminders, and the phone-only entries that each write changes. After every change, the notifications follow. */
    val repository: RemindersRepository =
        RemindersRepository(database, clock, ids, time, book, turns, work) { change -> alarms.afterChange(change) }

    /** The notifications: the app's `AlarmSource`, `AlarmHandler` and `ButtonHandler`. */
    val alarms: RemindersAlarms = RemindersAlarms(context, repository, time, book, turns, open, notify, work)

    /** Backup and restore, and what Settings shows about the recovery key and the app lock. */
    val backups: RemindersBackups = RemindersBackups(
        Backups(
            context.contentResolver,
            crypto.backups,
            APP_NAME,
            // After a restore, the reminders it took count from that moment, and the notifications follow.
            RemindersBackupContent(database, clock, ids, afterRestore = repository::afterRestore),
            // In the no-backup files folder, next to the keys, and not in the cache folder, which Android may empty
            // at any time (docs/architecture/backup-format.md, "Staging").
            File(context.noBackupFilesDir, STAGING_FOLDER),
            clock,
            work,
        ),
        crypto,
        time,
        clock,
        zone,
        work,
    )

    /**
     * Call once in the app class's `onCreate`. It calls `Backups.start()`,
     * which empties what a restore left behind when the app stopped in the
     * middle of it. Then, off the main thread, it finishes a pending move
     * of the file keys, which Reminders may do because it stores no files
     * (docs/apps/reminders/spec.md, "As in Water", files).
     */
    fun start() {
        backups.start()
        scope.launch { backups.keys() }
    }

    companion object {
        /** The name of the app in keys and backups (docs/apps/reminders/spec.md). The app class makes its `ShkCrypto` with it. */
        val APP_NAME: AppName = AppName.of("reminders")

        /** The folder a restore puts a backup aside in, until the whole of it was checked. Only `Backups` uses it. */
        private const val STAGING_FOLDER = "shk-restore"
    }
}

/**
 * The app class of Reminders. Android creates the screens itself, so they
 * reach [RemindersServices] through the app class, as the screens of
 * `core/security` reach its `SecurityHost`.
 */
interface RemindersHost {
    /** The app's one [RemindersServices]. */
    val reminders: RemindersServices
}

/** The [RemindersServices] of the app this screen belongs to. */
val Activity.remindersServices: RemindersServices
    get() = (application as? RemindersHost ?: error("The app class must implement RemindersHost")).reminders
