package app.shkriuss.core.crypto

import org.junit.runner.RunWith
import org.junit.runners.Suite

/**
 * Every test of this module that runs on the emulator. The runner in
 * `core/testing` runs this class and nothing else, so a test class that is
 * not listed here does not run.
 *
 * The first four are in `src/sharedTest/` and also run on the JVM. The
 * others need the real Android Keystore.
 */
@RunWith(Suite::class)
@Suite.SuiteClasses(
    DesignVectorsTest::class,
    PublishedVectorsTest::class,
    RecoveryWordsTest::class,
    KeysetFilesTest::class,
    TinkOnAndroidTest::class,
    HardwareKeysTest::class,
    UnlockedKeyTest::class,
    ScreenLockChangesTest::class,
    SystemPromptTest::class,
    ScreenLockRemovedTest::class,
)
class InstrumentedTests
