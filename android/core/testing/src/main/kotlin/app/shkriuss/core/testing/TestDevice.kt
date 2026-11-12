package app.shkriuss.core.testing

import android.app.Instrumentation
import android.content.Context
import android.os.ParcelFileDescriptor
import android.os.SystemClock

/**
 * The emulator an instrumented test runs on. [InstrumentedTestRunner]
 * fills it in before the first test. It is the one place where
 * instrumented tests keep shared state: Android starts one
 * instrumentation per run, and JUnit builds the test classes itself, so
 * nothing can be passed to them through a constructor.
 */
object TestDevice {
    private var attached: Instrumentation? = null
    private var reporter: (String) -> Unit = {}

    /** The running instrumentation. Fails outside an instrumented test. */
    val instrumentation: Instrumentation
        get() = checkNotNull(attached) { "TestDevice works only in a test run by InstrumentedTestRunner" }

    /** The context of the test APK. In a library module, the module's code runs inside it. */
    val context: Context get() = instrumentation.targetContext

    internal fun attach(instrumentation: Instrumentation, reporter: (String) -> Unit) {
        attached = instrumentation
        this.reporter = reporter
    }

    /**
     * Runs a command as the shell user, as `adb shell` would, and returns
     * what it printed. The shell user may do what an app may not, such as
     * setting the screen lock or pressing keys. Error output and the exit
     * code are not returned: check the effect of a command, not its words.
     */
    fun shell(command: String): String {
        val output = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(output).use { it.readBytes().decodeToString() }
    }

    /**
     * Writes down what Android answered, for the run's output. Use it for
     * facts that differ between Android versions and that the docs record,
     * never for anything secret.
     */
    fun note(text: String) = reporter("NOTE  $text")

    /**
     * Waits until [condition] is true, asking again every [STEP_MILLIS].
     * Returns false if it is still not true after [timeoutMillis].
     */
    fun waitUntil(timeoutMillis: Long, condition: () -> Boolean): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (true) {
            if (condition()) return true
            if (SystemClock.uptimeMillis() >= deadline) return false
            SystemClock.sleep(STEP_MILLIS)
        }
    }

    private const val STEP_MILLIS = 250L
}
