package app.shkriuss.core.crypto

import android.app.Activity
import android.content.Intent
import android.hardware.biometrics.BiometricManager.Authenticators
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import android.view.accessibility.AccessibilityNodeInfo
import app.shkriuss.core.testing.TestDevice
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals

/**
 * Android's own system prompt, shown and answered in a test. It is the
 * `BiometricPrompt` of `android.hardware.biometrics`, with the same
 * authenticators the prompt keys are made for: a strong biometric or the
 * device credential. The emulator has no fingerprint enrolled, so Android
 * asks for the PIN, and the test types it as the shell user.
 */
internal object SystemPrompt {
    private const val SUCCEEDED = "succeeded"
    private const val SYSTEM_UI = "com.android.systemui"
    private const val BUTTON = "android.widget.Button"
    private const val PIN_PAD_BUTTONS = 10
    private const val PIN_SCREEN_TIMEOUT_MILLIS = 15_000L
    private const val ANSWER_TIMEOUT_SECONDS = 30L
    private const val CLOSE_TIMEOUT_MILLIS = 5_000L

    private var screen: Activity? = null

    /** True once the first prompt was shown. From then on the emulator must not be locked: see [openScreen]. */
    val screenIsOpen: Boolean get() = screen != null

    /**
     * Shows the prompt for [cryptoObject], types the PIN of the screen
     * lock and returns when Android says the prompt succeeded. Fails the
     * test if Android says anything else, or nothing.
     */
    fun answer(cryptoObject: BiometricPrompt.CryptoObject) {
        val pin = ScreenLock.currentPin
        val screen = openScreen()
        val answers = LinkedBlockingQueue<String>()
        TestDevice.instrumentation.runOnMainSync { show(screen, cryptoObject, answers) }
        val pinScreenShown = TestDevice.waitUntil(PIN_SCREEN_TIMEOUT_MILLIS) { pinScreenIsShown() }
        if (!pinScreenShown) TestDevice.note("No PIN screen was seen before typing. Window in front: ${windowInFront()}")
        TestDevice.shell("input text $pin")
        TestDevice.shell("input keyevent KEYCODE_ENTER")
        val answer = answers.poll(ANSWER_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            ?: "no answer. PIN screen seen: $pinScreenShown. Window in front: ${windowInFront()}"
        assertEquals("The system prompt", SUCCEEDED, answer)
        TestDevice.waitUntil(CLOSE_TIMEOUT_MILLIS) { !pinScreenIsShown() }
    }

    /**
     * The empty screen of the test APK. It is opened at the first prompt
     * and stays open until the run ends.
     *
     * It is never closed, and never covered by another app, because
     * Android then saves a picture of it for the recent-apps view. On the
     * Android 17 emulator image that crashes Android's system process, in
     * the emulator's graphics driver (emulator-tests.md).
     */
    private fun openScreen(): Activity = screen ?: TestDevice.instrumentation.startActivitySync(
        Intent(TestDevice.context, PromptHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    ).also { screen = it }

    private fun show(screen: Activity, cryptoObject: BiometricPrompt.CryptoObject, answers: LinkedBlockingQueue<String>) {
        val prompt = BiometricPrompt.Builder(screen)
            .setTitle("Instrumented test")
            .setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL)
            .build()
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                answers.add(SUCCEEDED)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                answers.add("error $errorCode: $errString")
            }
        }
        prompt.authenticate(cryptoObject, CancellationSignal(), screen.mainExecutor, callback)
    }

    /**
     * True while the window in front belongs to the system and asks for
     * the PIN. Android 13 to 15 show a field to type into. Android 17
     * shows a number pad: ten buttons or more, and no field.
     */
    private fun pinScreenIsShown(): Boolean {
        val root = TestDevice.instrumentation.uiAutomation.rootInActiveWindow ?: return false
        if (root.packageName != SYSTEM_UI) return false
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collect(root, nodes)
        return nodes.any { it.isEditable || it.isPassword } || nodes.count { it.className?.toString() == BUTTON } >= PIN_PAD_BUTTONS
    }

    private fun collect(node: AccessibilityNodeInfo, nodes: MutableList<AccessibilityNodeInfo>) {
        nodes += node
        for (index in 0 until node.childCount) node.getChild(index)?.let { collect(it, nodes) }
    }

    /** The window in front and how many views of each kind it holds, to say what was there when no PIN screen was found. */
    private fun windowInFront(): String {
        val root = TestDevice.instrumentation.uiAutomation.rootInActiveWindow ?: return "none"
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collect(root, nodes)
        val kinds = nodes.groupingBy { it.className?.toString()?.substringAfterLast('.') ?: "unknown" }.eachCount()
        return "${root.packageName}: ${kinds.toSortedMap().map { (kind, count) -> "$count $kind" }.joinToString(", ")}"
    }
}
