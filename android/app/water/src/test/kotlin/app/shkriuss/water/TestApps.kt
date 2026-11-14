package app.shkriuss.water

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.water.WaterHost
import app.shkriuss.feature.water.WaterServices
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.ZoneOffset

/** The name of the app in keys, as `WaterApp` has it. */
private val WATER: AppName = AppName.of("water")

/** What Water's screens get from the app class, on a database in memory. */
private fun servicesFor(app: android.app.Application): WaterServices = WaterServices(
    inMemoryTestDatabaseBuilder<WaterDatabase>(app).build(),
    TestClock(),
    TestIdSource(),
) { ZoneOffset.UTC }

/**
 * Water's app class for the check that every screen is behind the app lock:
 * locked from the start, with what `WaterApp` hands to the screens.
 */
class LockedWaterApp : LockedAppForTests(WATER), WaterHost {
    override val water: WaterServices by lazy { servicesFor(this) }
}

/** Water's app class with the app lock off, for screenshots of the screens. */
class UnlockedWaterApp : UnlockedAppForTests(WATER), WaterHost {
    override val water: WaterServices by lazy { servicesFor(this) }
}
