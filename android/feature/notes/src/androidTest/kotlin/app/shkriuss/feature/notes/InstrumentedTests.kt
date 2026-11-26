package app.shkriuss.feature.notes

import org.junit.runner.RunWith
import org.junit.runners.Suite

/**
 * Every test of this module that runs on the emulator. The runner in
 * `core/testing` runs this class and nothing else, so a test class that is
 * not listed here would not run. `./gradlew check` fails for such a class
 * (`checkInstrumentedTestSuite`).
 */
@RunWith(Suite::class)
@Suite.SuiteClasses(
    NotesAtTheLimitsTest::class,
)
class InstrumentedTests
