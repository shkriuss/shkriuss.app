package app.shkriuss.core.crypto

import android.hardware.biometrics.BiometricPrompt

/**
 * One step that needs the system prompt: Android's own `BiometricPrompt`
 * with a fingerprint or the phone's PIN, pattern or password.
 *
 * 1. Give [cryptoObject] to the prompt.
 * 2. When the prompt succeeds, call [finish]. It does the work and returns
 *    the result.
 * 3. When the prompt is cancelled or fails, or the screen goes away, call
 *    [cancel]. To try again, ask for a new step.
 *
 * One step serves one prompt. The screen code never touches the cipher
 * inside [cryptoObject].
 */
class PromptStep<T> internal constructor(
    val cryptoObject: BiometricPrompt.CryptoObject,
    private val onFinish: () -> T,
    private val onCancel: () -> Unit,
) {
    private var used = false

    /**
     * Does the work the prompt allowed. Call it once, and only after the
     * prompt succeeded. Throws [BlobException] if the key could not be
     * used, for example because the prompt was not really answered.
     */
    fun finish(): T {
        markUsed()
        try {
            return onFinish()
        } catch (failed: Exception) {
            onCancel()
            throw failed
        }
    }

    /** Throws the step away. Nothing was changed. */
    fun cancel() {
        markUsed()
        onCancel()
    }

    @Synchronized
    private fun markUsed() {
        check(!used) { "One step serves one prompt" }
        used = true
    }

    /** Never shows what the step holds. */
    override fun toString(): String = "PromptStep"
}
