package app.shkriuss.water

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.testing.AppLockOnForTests
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.water.WaterHost
import app.shkriuss.feature.water.WaterServices
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/** The name of the app in keys, as `WaterApp` has it. */
private val WATER: AppName = AppName.of("water")

/** The day of the spec's examples, Friday 13 November 2026, which the screens of the tests show as today. */
val THE_DAY: LocalDate = LocalDate.of(2026, 11, 13)

/** The time on [THE_DAY] that the tests start at: 14:05, as in the spec's examples. */
val THE_TIME: LocalDateTime = THE_DAY.atTime(14, 5)

/**
 * What Water's screens get from the app class, on a database in memory,
 * with a clock the test controls. Local time is UTC, so a test reads the
 * clock as it is written.
 */
class TestWater(app: android.app.Application) {
    /** The clock of the app: [THE_TIME] at the start. */
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli())

    /** What the app class hands to the screens. */
    val services: WaterServices = WaterServices(
        inMemoryTestDatabaseBuilder<WaterDatabase>(app).build(),
        clock,
        TestIdSource(),
    ) { ZoneOffset.UTC }
}

/** The app class of every test of the screens. */
interface WaterTestApp : WaterHost {
    /** The database, the clock and the services of the test. */
    val test: TestWater

    override val water: WaterServices
        get() = test.services
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
