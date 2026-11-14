package app.shkriuss.water

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
import app.shkriuss.feature.water.WaterHost
import app.shkriuss.feature.water.WaterReminders
import app.shkriuss.feature.water.WaterServices
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.Executor

/** The name of the app in keys, as `WaterApp` has it. */
private val WATER: AppName = AppName.of("water")

/** The day of the spec's examples, Friday 13 November 2026, which the screens of the tests show as today. */
val THE_DAY: LocalDate = LocalDate.of(2026, 11, 13)

/** The time on [THE_DAY] that the tests start at: 14:05, as in the spec's examples. */
val THE_TIME: LocalDateTime = THE_DAY.atTime(14, 5)

/**
 * What Water's screens and receivers get from the app class, on a
 * database in memory, with a clock the test controls. Local time is UTC,
 * so a test reads the clock as it is written.
 *
 * It builds the one `Notify` as `WaterApp` does, with a worker that runs
 * each piece at once, and starts it. A new start of the app in a test is
 * a new [TestWater] on the same [database], [clock] and [ids]. [open] is
 * what a tap on a reminder opens.
 */
class TestWater(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: WaterDatabase = inMemoryTestDatabaseBuilder<WaterDatabase>(app).build(),
    val ids: TestIdSource = TestIdSource(),
    open: Intent = Intent(app, WaterActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
) {
    /** What the app class hands to the screens. */
    val services: WaterServices = WaterServices(app, database, clock, ids, open, notify = { notify }, zone = { ZoneOffset.UTC })

    /** The app's one `Notify`. The text of notifications is hidden while the app lock of the test's app class says so. */
    val notify: Notify = Notify(
        app,
        listOf(WaterReminders.CHANNEL),
        services.reminders,
        services.reminders,
        clock,
        hidesText = { (app as SecurityHost).appLock.hidesNotificationText() },
        worker = Executor { it.run() },
        buttons = services.reminders,
    )

    init {
        notify.start()
    }
}

/** The app class of every test of the screens. It is a `NotifyHost`, as `WaterApp` is, so the receivers of core/notify find it. */
interface WaterTestApp : WaterHost, NotifyHost {
    /** The database, the clock and the services of the test. */
    val test: TestWater

    override val water: WaterServices
        get() = test.services

    override val notify: Notify
        get() = test.notify
}

/**
 * Water's app class for the check that every screen is behind the app lock:
 * locked from the start, with what `WaterApp` hands to the screens.
 */
class LockedWaterApp : LockedAppForTests(WATER), WaterTestApp {
    override val test: TestWater by lazy { TestWater(this) }
}

/**
 * Water's app class for the check that every sheet and dialog is behind
 * the app lock: the app lock is on and the app is open, so a test can open
 * a sheet or a dialog, then lock the app.
 */
class AppLockOnWaterApp : AppLockOnForTests(WATER), WaterTestApp {
    override val test: TestWater by lazy { TestWater(this) }
}

/** Water's app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedWaterApp : UnlockedAppForTests(WATER), WaterTestApp {
    override val test: TestWater by lazy { TestWater(this) }
}

/**
 * Water's app class with the app lock off, for the tests of reminders
 * through Android's alarms. [restart] is a new start of the app in a new
 * process: new objects on the same database, clock and files.
 */
class RemindersWaterApp : UnlockedAppForTests(WATER), WaterTestApp {
    private var started: TestWater? = null

    override val test: TestWater
        get() = started ?: TestWater(this).also { started = it }

    /** The app starts again. [open] is what a tap on a reminder opens. */
    fun restart(open: Intent = Intent(this, WaterActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) {
        val before = test
        started = null
        started = TestWater(this, before.clock, before.database, before.ids, open)
    }
}
