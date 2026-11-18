package app.shkriuss.reminders

import android.app.Application
import android.content.Intent
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.testing.AppLockOnForTests
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.reminders.RemindersAlarms
import app.shkriuss.feature.reminders.RemindersHost
import app.shkriuss.feature.reminders.RemindersServices
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.Executor

/** The name of the app in keys, as `RemindersApp` has it. */
private val REMINDERS: AppName = RemindersServices.APP_NAME

/** The time the tests start at: Monday 16 November 2026 at 09:30, as in the spec's examples. */
val THE_TIME: LocalDateTime = LocalDateTime.of(2026, 11, 16, 9, 30)

/** What a tap on a notification opens, as `RemindersApp` has it. */
fun openReminders(app: Application): Intent =
    Intent(app, RemindersActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

/**
 * What Reminders' screens and receivers get from the app class, on a
 * database in memory, with a clock the test controls. Local time is UTC,
 * so a test reads the clock as it is written.
 *
 * It builds the one `Notify` as `RemindersApp` does, with a worker that
 * runs each piece at once, and starts it. A new start of the app in a
 * test is a new [TestReminders] on the same [database], [clock] and
 * [ids]. [open] is what a tap on a notification opens.
 */
class TestReminders(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: RemindersDatabase = inMemoryTestDatabaseBuilder<RemindersDatabase>(app).build(),
    val ids: TestIdSource = TestIdSource(),
    open: Intent = openReminders(app),
) {
    /** What the app class hands to the screens. */
    val services: RemindersServices =
        RemindersServices(app, database, clock, ids, open, notify = { notify }, zone = { ZoneOffset.UTC })

    /** The app's one `Notify`. The text of notifications is hidden while the app lock of the test's app class says so. */
    val notify: Notify = Notify(
        app,
        listOf(RemindersAlarms.CHANNEL),
        services.alarms,
        services.alarms,
        clock,
        hidesText = { (app as SecurityHost).appLock.hidesNotificationText() },
        worker = Executor { it.run() },
        buttons = services.alarms,
    )

    init {
        notify.start()
    }
}

/** The app class of every test of the screens. It is a `NotifyHost`, as `RemindersApp` is, so the receivers of core/notify find it. */
interface RemindersTestApp : RemindersHost, NotifyHost {
    /** The database, the clock and the services of the test. */
    val test: TestReminders

    override val reminders: RemindersServices
        get() = test.services

    override val notify: Notify
        get() = test.notify
}

/**
 * Reminders' app class for the check that every screen is behind the app
 * lock: locked from the start, with what `RemindersApp` hands to the
 * screens.
 */
class LockedRemindersApp : LockedAppForTests(REMINDERS), RemindersTestApp {
    override val test: TestReminders by lazy { TestReminders(this) }
}

/**
 * Reminders' app class for the check that every sheet and dialog is behind
 * the app lock: the app lock is on and the app is open, so a test can open
 * a sheet or a dialog, then lock the app.
 */
class AppLockOnRemindersApp : AppLockOnForTests(REMINDERS), RemindersTestApp {
    override val test: TestReminders by lazy { TestReminders(this) }
}

/** Reminders' app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedRemindersApp : UnlockedAppForTests(REMINDERS), RemindersTestApp {
    override val test: TestReminders by lazy { TestReminders(this) }
}

/**
 * Reminders' app class with the app lock off, for the tests of the
 * notifications through Android's alarms. [restart] is a new start of the
 * app in a new process: new objects on the same database, clock and files.
 */
class NotifyingRemindersApp : UnlockedAppForTests(REMINDERS), RemindersTestApp {
    private var started: TestReminders? = null

    override val test: TestReminders
        get() = started ?: TestReminders(this).also { started = it }

    /** The app starts again. [open] is what a tap on a notification opens. */
    fun restart(open: Intent = openReminders(this)) {
        val before = test
        started = null
        started = TestReminders(this, before.clock, before.database, before.ids, open)
    }
}
