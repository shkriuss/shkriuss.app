package app.shkriuss.core.security

import android.hardware.biometrics.BiometricManager.Authenticators
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext

/** How one system prompt ended. */
internal enum class PromptOutcome {
    /** The user answered it. The step may finish. */
    SUCCEEDED,

    /** The user closed it. */
    CANCELLED,

    /** It ended with an error, for example after too many tries. */
    FAILED,

    /** The screen went away first, for example when the phone was turned. */
    GONE,
}

/**
 * Android's own system prompt (`android.hardware.biometrics`), for one
 * [request]: a strong fingerprint or the phone's PIN, pattern or password
 * ("The system prompt" in crypto-design.md). It is the only place in the
 * suite that shows it. [onResult] gets exactly one answer per request.
 *
 * When the screen goes away, the prompt is cancelled and the answer is
 * [PromptOutcome.GONE]. It is never shown again by itself: the screen
 * offers its button again.
 */
@Composable
internal fun SystemPrompt(
    request: PromptRequest?,
    title: String,
    subtitle: String,
    onResult: (PromptRequest, PromptOutcome) -> Unit,
) {
    if (request == null) return
    val context = LocalContext.current
    val answer by rememberUpdatedState(onResult)
    DisposableEffect(request) {
        val signal = CancellationSignal()
        var answered = false
        fun once(outcome: PromptOutcome) {
            if (answered) return
            answered = true
            answer(request, outcome)
        }
        BiometricPrompt.Builder(context)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL)
            .build()
            .authenticate(
                request.step.cryptoObject,
                signal,
                context.mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        once(PromptOutcome.SUCCEEDED)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        val cancelled = errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED ||
                            errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                        once(if (cancelled) PromptOutcome.CANCELLED else PromptOutcome.FAILED)
                    }
                },
            )
        onDispose {
            if (!answered) {
                once(PromptOutcome.GONE)
                signal.cancel()
            }
        }
    }
}
