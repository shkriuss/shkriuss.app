package app.shkriuss.tasks

import android.app.Application
import android.content.Intent
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.testing.AppLockOnForTests
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.NewAppForTests
import app.shkriuss.core.testing.StoppedSetupAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.tasks.TasksAlarms
import app.shkriuss.feature.tasks.TasksHost
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.Executor

/** The name of the app in keys, as `TasksApp` has it. */
private val TASKS: AppName = TasksServices.APP_NAME

/** The time the tests start at: Monday 16 November 2026 at 09:30, as in the spec's examples. */
val THE_TIME: LocalDateTime = LocalDateTime.of(2026, 11, 16, 9, 30)

/** What a tap on a notification opens, as `TasksApp` has it. */
fun openTasks(app: Application): Intent =
    Intent(app, TasksActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

/**
 * What Tasks' screens and receivers get from the app class, on a database
 * in memory, with a clock the test controls. Local time is UTC, so a test
 * reads the clock as it is written.
 *
 * It builds the one `Notify` as `TasksApp` does, with a worker that runs
 * each piece at once, and starts it. A new start of the app in a test is
 * a new [TestTasks] on the same [database], [clock] and [ids]. [open] is
 * what a tap on a notification opens.
 */
class TestTasks(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: TasksDatabase = inMemoryTestDatabaseBuilder<TasksDatabase>(app).build(),
    val ids: TestIdSource = TestIdSource(),
    open: Intent = openTasks(app),
) {
    /** What the app class hands to the screens. */
    val services: TasksServices = TasksServices(
        app,
        database,
        clock,
        ids,
        open,
        notify = { notify },
        // The keys of the test's app class, as `TasksApp` passes its own.
        crypto = (app as SecurityHost).crypto,
        zone = { ZoneOffset.UTC },
    )

    /** The app's one `Notify`. The text of notifications is hidden while the app lock of the test's app class says so. */
    val notify: Notify = Notify(
        app,
        listOf(TasksAlarms.CHANNEL),
        services.alarms,
        services.alarms,
        clock,
        hidesText = { (app as SecurityHost).appLock.hidesNotificationText() },
        worker = Executor { it.run() },
        buttons = services.alarms,
        review = services.alarms,
        // The spaced steps of hiding the text of notifications run at once here.
        later = { _, step -> step() },
    )

    init {
        services.start()
        notify.start()
    }
}

/** The app class of every test of the screens. It is a `NotifyHost`, as `TasksApp` is, so the receivers of core/notify find it. */
interface TasksTestApp : TasksHost, NotifyHost {
    /** The database, the clock and the services of the test. */
    val test: TestTasks

    override val tasks: TasksServices
        get() = test.services

    override val notify: Notify
        get() = test.notify
}

/**
 * Tasks' app class for the check that every screen is behind the app
 * lock: locked from the start, with what `TasksApp` hands to the screens.
 */
class LockedTasksApp : LockedAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/**
 * Tasks' app class for the check that every sheet and dialog is behind
 * the app lock: the app lock is on and the app is open, so a test can open
 * a sheet or a dialog, then lock the app.
 */
class AppLockOnTasksApp : AppLockOnForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/** Tasks' app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedTasksApp : UnlockedAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/**
 * Tasks' app class with no recovery key yet, as right after Tasks was
 * installed, for what Settings shows before the recovery key is first
 * needed (Water's spec, "The recovery key when first needed").
 */
class NewTasksApp : NewAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/** Tasks' app class after a setup of the recovery key that stopped half way. */
class StoppedSetupTasksApp : StoppedSetupAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/**
 * Tasks' app class with the app lock off, for the tests of the reminders
 * through Android's alarms. [restart] is a new start of the app in a new
 * process: new objects on the same database, clock and files.
 */
class NotifyingTasksApp : UnlockedAppForTests(TASKS), TasksTestApp {
    private var started: TestTasks? = null

    override val test: TestTasks
        get() = started ?: TestTasks(this).also { started = it }

    /**
     * The same app on a phone with no data: new objects on an empty
     * database, with the same keys, clock and source of IDs. As a second
     * phone that has entered the same recovery words, before a restore.
     */
    fun startOnAPhoneWithNoData() {
        val before = test
        started = null
        started = TestTasks(this, before.clock, ids = before.ids)
    }

    /** The app starts again. [open] is what a tap on a notification opens. */
    fun restart(open: Intent = openTasks(this)) {
        val before = test
        started = null
        started = TestTasks(this, before.clock, before.database, before.ids, open)
    }
}
