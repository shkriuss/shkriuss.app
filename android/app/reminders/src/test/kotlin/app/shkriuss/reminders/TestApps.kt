package app.shkriuss.reminders

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.testing.AppLockOnForTests
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.reminders.RemindersHost
import app.shkriuss.feature.reminders.RemindersServices
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.LocalDateTime
import java.time.ZoneOffset

/** The name of the app in keys, as `RemindersApp` has it. */
private val REMINDERS: AppName = RemindersServices.APP_NAME

/** The time the tests start at: Monday 16 November 2026 at 09:30, as in the spec's examples. */
val THE_TIME: LocalDateTime = LocalDateTime.of(2026, 11, 16, 9, 30)

/**
 * What Reminders' screens get from the app class, on a database in
 * memory, with a clock the test controls. Local time is UTC, so a test
 * reads the clock as it is written.
 */
class TestReminders(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: RemindersDatabase = inMemoryTestDatabaseBuilder<RemindersDatabase>(app).build(),
    val ids: TestIdSource = TestIdSource(),
) {
    /** What the app class hands to the screens. */
    val services: RemindersServices = RemindersServices(app, database, clock, ids, zone = { ZoneOffset.UTC })
}

/** The app class of every test of the screens. */
interface RemindersTestApp : RemindersHost {
    /** The database, the clock and the services of the test. */
    val test: TestReminders

    override val reminders: RemindersServices
        get() = test.services
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
