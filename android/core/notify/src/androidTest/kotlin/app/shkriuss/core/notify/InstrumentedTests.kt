package app.shkriuss.core.notify

import org.junit.runner.RunWith
import org.junit.runners.Suite

/**
 * Every test of this module that runs on the emulator. The runner in
 * `core/testing` runs this class and nothing else, so a test class that is
 * not listed here would not run. `./gradlew check` fails for such a class
 * (`checkInstrumentedTestSuite`).
 *
 * The order matters:
 *
 * 1. [PermissionOnAndroidTest] needs an app that was never asked for the
 *    notification permission. The tests after it grant it.
 * 2. [ClockChangesOnAndroidTest] moves the emulator's clock and time
 *    zone, so it comes last.
 */
@RunWith(Suite::class)
@Suite.SuiteClasses(
    PermissionOnAndroidTest::class,
    AlarmsOnAndroidTest::class,
    ClockChangesOnAndroidTest::class,
)
class InstrumentedTests
