package app.shkriuss.feature.tasks

import android.app.Activity
import android.content.Context
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.sync.Mutex

/**
 * Everything of Tasks that lives as long as the app: its database, the
 * phone's clock and time zone, the clock for the screens, the phone-only
 * entries, and the repository on them. The app class builds one and hands
 * it out through [TasksHost]. Nothing here is found by a lookup: the
 * ViewModels get what they need through their constructors.
 *
 * [work] runs the work on the phone-only file off the main thread. Tests
 * pass their own, and a [zone] they control.
 */
class TasksServices(
    context: Context,
    /** The app's one database. */
    val database: TasksDatabase,
    clock: Clock,
    ids: IdSource,
    zone: () -> ZoneId = ZoneId::systemDefault,
    work: CoroutineContext = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + work)

    /**
     * The one lock that the work on the phone-only file after each write
     * takes, and that the handler of an alarm and a press of a button will
     * take too, as in Reminders.
     */
    private val turns = Mutex()

    /** The phone's clock and time zone. */
    val time: TasksTime = TasksTime(clock, zone)

    /** The clock for every screen: the one source that the ViewModels observe. */
    val now: TasksNow = TasksNow(time, scope)

    /** What this phone remembers of each task: its mark, its snooze, its notification on screen, and the reminder number of all three. */
    private val book = TaskBook.of(context)

    /** The lists and tasks, and the phone-only entries that each write changes. */
    val repository: TasksRepository = TasksRepository(database, clock, ids, time, book, turns, work)

    companion object {
        /** The name of the app in keys and backups (docs/apps/tasks/spec.md). The app class makes its `ShkCrypto` with it. */
        val APP_NAME: AppName = AppName.of("tasks")
    }
}

/**
 * The app class of Tasks. Android creates the screens itself, so they
 * reach [TasksServices] through the app class, as the screens of
 * `core/security` reach its `SecurityHost`.
 */
interface TasksHost {
    /** The app's one [TasksServices]. */
    val tasks: TasksServices
}

/** The [TasksServices] of the app this screen belongs to. */
val Activity.tasksServices: TasksServices
    get() = (application as? TasksHost ?: error("The app class must implement TasksHost")).tasks
