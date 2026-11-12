package app.shkriuss.core.testing

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.util.Log
import java.io.PrintWriter
import java.io.StringWriter
import org.junit.runner.Description
import org.junit.runner.JUnitCore
import org.junit.runner.Result
import org.junit.runner.notification.Failure
import org.junit.runner.notification.RunListener

/**
 * Runs a module's instrumented tests on an emulator. It is the project's
 * own runner: Android's `Instrumentation` and JUnit 4, and no test library
 * (ADR 0028).
 *
 * 1. It runs one class: the JUnit suite `InstrumentedTests` in the
 *    module's package. The test APK of the module `a.b` has the package
 *    `a.b.test`, so the suite is `a.b.InstrumentedTests`.
 * 2. It writes one line per test, and the stack trace of each failure, to
 *    the output of `am instrument -w` and to the system log.
 * 3. Its last line is [PASSED] only if at least one test ran and none
 *    failed. The CI job looks for exactly that line. `am instrument`
 *    itself ends without an error also when a test fails or the process
 *    crashes.
 *
 * Tests reach the device through [TestDevice].
 */
class InstrumentedTestRunner : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    /** Runs on the instrumentation's own thread, so tests may wait. */
    override fun onStart() {
        // Android has finished starting the test APK when its main thread is idle.
        waitForIdleSync()
        TestDevice.attach(this, ::report)
        val result = try {
            val suite = Class.forName(context.packageName.removeSuffix(TEST_PACKAGE_ENDING) + SUITE_ENDING)
            JUnitCore().apply { addListener(Reporter(::report)) }.run(suite)
        } catch (failed: Throwable) {
            report("The tests could not start.\n${stackTraceOf(failed)}")
            null
        }
        finish(Activity.RESULT_OK, Bundle().apply { putString(REPORT_KEY_STREAMRESULT, summaryOf(result)) })
    }

    private fun summaryOf(result: Result?): String {
        if (result == null) return FAILED
        val counts = "${result.runCount} tests, ${result.failureCount} failed, " +
            "${result.assumptionFailureCount} skipped by their own condition, ${result.ignoreCount} ignored"
        val passed = result.runCount > 0 && result.wasSuccessful()
        Log.i(LOG_TAG, counts)
        return "\n$counts\n${if (passed) PASSED else FAILED}"
    }

    /** One piece of text for the output of `am instrument -w`, and for the system log. */
    private fun report(text: String) {
        text.lineSequence().forEach { Log.i(LOG_TAG, it) }
        sendStatus(0, Bundle().apply { putString(REPORT_KEY_STREAMRESULT, text + "\n") })
    }

    /** Turns JUnit's events into one line per test. */
    private class Reporter(private val report: (String) -> Unit) : RunListener() {
        private var outcome = OK
        private var startedAt = 0L

        override fun testStarted(description: Description) {
            outcome = OK
            startedAt = System.nanoTime()
            report("START ${nameOf(description)}")
        }

        override fun testFailure(failure: Failure) {
            outcome = "FAIL "
            report(stackTraceOf(failure.exception))
        }

        override fun testAssumptionFailure(failure: Failure) {
            outcome = "SKIP "
            report("      ${failure.message}")
        }

        override fun testFinished(description: Description) {
            val seconds = (System.nanoTime() - startedAt) / NANOS_PER_SECOND
            report("$outcome ${nameOf(description)} ($seconds s)")
        }

        override fun testIgnored(description: Description) {
            report("IGNORED ${nameOf(description)}")
        }

        private fun nameOf(description: Description): String =
            "${description.className.substringAfterLast('.')}.${description.methodName}"

        private companion object {
            const val OK = "OK   "
            const val NANOS_PER_SECOND = 1_000_000_000L
        }
    }

    companion object {
        /** The last line of the output when at least one test ran and none failed. */
        const val PASSED = "INSTRUMENTED_TESTS_PASSED"

        /** The last line of the output in every other case. */
        const val FAILED = "INSTRUMENTED_TESTS_FAILED"

        private const val LOG_TAG = "InstrumentedTests"
        private const val TEST_PACKAGE_ENDING = ".test"
        private const val SUITE_ENDING = ".InstrumentedTests"

        private fun stackTraceOf(failed: Throwable): String =
            StringWriter().also { failed.printStackTrace(PrintWriter(it)) }.toString().trimEnd()
    }
}
