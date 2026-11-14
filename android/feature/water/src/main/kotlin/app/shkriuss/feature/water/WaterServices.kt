package app.shkriuss.feature.water

import android.app.Activity
import android.content.Context
import android.content.Intent
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers

/**
 * Everything of Water that lives as long as the app: its database, the
 * repository on it, the phone's local time and the reminders. The app
 * class builds one and hands it out through [WaterHost]. Nothing here is
 * found by a lookup: the ViewModels get what they need through their
 * constructors.
 *
 * [open] is the screen a tap on a reminder opens, Today. [notify] gives
 * the app's one `Notify`, which the app class builds with [reminders], so
 * it is read only when a reminder needs it. [work] runs the reminders'
 * reads after a change, off the main thread.
 */
class WaterServices(
    context: Context,
    /** The app's one database. */
    val database: WaterDatabase,
    clock: Clock,
    ids: IdSource,
    open: Intent,
    notify: () -> Notify,
    zone: () -> ZoneId = ZoneId::systemDefault,
    work: CoroutineContext = Dispatchers.IO,
) {
    /** The phone's local day and time. */
    val time: WaterTime = WaterTime(clock, zone)

    /** The drinks, the goals and the settings. After every change, the reminders follow. */
    val repository: WaterRepository = WaterRepository(database, clock, ids) { change -> reminders.afterChange(change) }

    /** The reminders: the app's `AlarmSource`, `AlarmHandler` and `ButtonHandler`. */
    val reminders: WaterReminders = WaterReminders(context, repository, time, ReminderBook.of(context), open, notify, work)
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
