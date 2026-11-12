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
    private const val FIELD_TIMEOUT_MILLIS = 15_000L
    private const val ANSWER_TIMEOUT_SECONDS = 30L
    private const val CLOSE_TIMEOUT_MILLIS = 5_000L

    /**
     * Shows the prompt for [cryptoObject], types the PIN of the screen
     * lock and returns when Android says the prompt succeeded. Fails the
     * test if Android says anything else, or nothing.
     */
    fun answer(cryptoObject: BiometricPrompt.CryptoObject) {
        val pin = ScreenLock.currentPin
        val instrumentation = TestDevice.instrumentation
        val screen = instrumentation.startActivitySync(
            Intent(TestDevice.context, PromptHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        try {
            val answers = LinkedBlockingQueue<String>()
            instrumentation.runOnMainSync { show(screen, cryptoObject, answers) }
            val fieldShown = TestDevice.waitUntil(FIELD_TIMEOUT_MILLIS) { pinFieldIsShown() }
            TestDevice.shell("input text $pin")
            TestDevice.shell("input keyevent KEYCODE_ENTER")
            val answer = answers.poll(ANSWER_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                ?: "no answer. PIN field seen: $fieldShown. Window in front: ${windowInFront()}"
            assertEquals("The system prompt", SUCCEEDED, answer)
            TestDevice.waitUntil(CLOSE_TIMEOUT_MILLIS) { !pinFieldIsShown() }
        } finally {
            instrumentation.runOnMainSync { screen.finish() }
        }
    }

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

    /** True while the window in front belongs to the system and holds a field to type into. */
    private fun pinFieldIsShown(): Boolean {
        val root = TestDevice.instrumentation.uiAutomation.rootInActiveWindow ?: return false
        return root.packageName == SYSTEM_UI && holdsTextField(root)
    }

    private fun holdsTextField(node: AccessibilityNodeInfo): Boolean {
        if (node.isEditable || node.isPassword) return true
        return (0 until node.childCount).any { index -> node.getChild(index)?.let { holdsTextField(it) } == true }
    }

    private fun windowInFront(): String {
        val root = TestDevice.instrumentation.uiAutomation.rootInActiveWindow ?: return "none"
        return "${root.packageName} ${root.className}"
    }
}
