package app.shkriuss.feature.reminders

import android.app.Activity
import android.content.Context
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.sync.Mutex

/**
 * Everything of Reminders that lives as long as the app: its database,
 * the phone's clock and time zone, the clock for the screens, the
 * phone-only entries and the repository on them. The app class builds
 * one and hands it out through [RemindersHost]. Nothing here is found by
 * a lookup: the ViewModels get what they need through their constructors.
 *
 * [work] runs the work on the phone-only file off the main thread. Tests
 * pass their own, and a [zone] they control.
 */
class RemindersServices(
    context: Context,
    /** The app's one database. */
    val database: RemindersDatabase,
    clock: Clock,
    ids: IdSource,
    zone: () -> ZoneId = ZoneId::systemDefault,
    work: CoroutineContext = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + work)

    /**
     * The one lock that the work on the phone-only file after each write
     * takes its turn on (docs/apps/reminders/spec.md, "How Reminders uses
     * core/notify", point 3).
     */
    private val turns = Mutex()

    /** The phone's clock and time zone. */
    val time: RemindersTime = RemindersTime(clock, zone)

    /** The clock for every screen: the one source that the ViewModels observe. */
    val now: RemindersNow = RemindersNow(time, scope)

    /** The reminders, and the phone-only entries that each write changes. */
    val repository: RemindersRepository = RemindersRepository(database, clock, ids, time, ReminderBook.of(context), turns, work)

    companion object {
        /** The name of the app in keys and backups (docs/apps/reminders/spec.md). The app class makes its `ShkCrypto` with it. */
        val APP_NAME: AppName = AppName.of("reminders")
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
