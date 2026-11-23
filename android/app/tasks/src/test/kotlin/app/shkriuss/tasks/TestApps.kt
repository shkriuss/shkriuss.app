package app.shkriuss.tasks

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.tasks.TasksHost
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.LocalDateTime
import java.time.ZoneOffset

/** The name of the app in keys, as `TasksApp` has it. */
private val TASKS: AppName = TasksServices.APP_NAME

/** The time the tests start at: Monday 16 November 2026 at 09:30, as in the spec's examples. */
val THE_TIME: LocalDateTime = LocalDateTime.of(2026, 11, 16, 9, 30)

/**
 * What Tasks' screens get from the app class, on a database in memory,
 * with a clock the test controls. Local time is UTC, so a test reads the
 * clock as it is written.
 */
class TestTasks(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: TasksDatabase = inMemoryTestDatabaseBuilder<TasksDatabase>(app).build(),
    val ids: TestIdSource = TestIdSource(),
) {
    /** What the app class hands to the screens. */
    val services: TasksServices = TasksServices(app, database, clock, ids, zone = { ZoneOffset.UTC })
}

/** The app class of every test of the screens. */
interface TasksTestApp : TasksHost {
    /** The database, the clock and the services of the test. */
    val test: TestTasks

    override val tasks: TasksServices
        get() = test.services
}

/**
 * Tasks' app class for the check that every screen is behind the app
 * lock: locked from the start, with what `TasksApp` hands to the screens.
 */
class LockedTasksApp : LockedAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}

/** Tasks' app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedTasksApp : UnlockedAppForTests(TASKS), TasksTestApp {
    override val test: TestTasks by lazy { TestTasks(this) }
}
