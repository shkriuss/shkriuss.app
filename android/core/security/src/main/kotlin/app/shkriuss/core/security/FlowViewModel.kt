package app.shkriuss.core.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.CannotMakeHardwareKeyException
import app.shkriuss.core.crypto.KeySetupResult
import app.shkriuss.core.crypto.PromptStep
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.StartOverResult
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What the create and the enter flow share: one screen state, work on a
 * background thread, the step that keeps the recovery key on this phone,
 * and how a failure becomes what the screen says.
 *
 * The recovery key lives in this object only while the flow needs it.
 * It is never put in a saved state, so it survives a turn of the phone
 * but not the end of the screen.
 */
abstract class FlowViewModel<S : Any> internal constructor(
    protected val crypto: ShkCrypto,
    private val background: CoroutineDispatcher,
    first: S,
) : ViewModel() {
    private val screen = MutableStateFlow(first)

    /** The one state of the screen. */
    val state: StateFlow<S> = screen.asStateFlow()

    /** The recovery key the flow keeps, between storing and keeping. Set on the background thread. */
    @Volatile
    private var keeping: RecoveryKey? = null

    @Volatile
    private var requests = 0

    /** True once storing the keys turned the app lock off. The end of the flow says so. */
    @Volatile
    protected var appLockWentOff = false

    protected fun show(next: S) {
        screen.value = next
    }

    /** The screen of the flow for one of the shared steps. */
    protected abstract fun flowScreen(step: FlowStep): S

    /** Runs [work] on the background thread. A failure of the keys becomes [FlowFailed]. */
    protected fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                show(flowScreen(FlowFailed(problemOf(failed))))
            } catch (_: CannotMakeHardwareKeyException) {
                show(flowScreen(FlowFailed(SecurityProblem.CANNOT_MAKE_KEY)))
            }
        }
    }

    /** After the keys are stored: keep [key] on this phone, if the phone can. */
    protected suspend fun keep(key: RecoveryKey) {
        keeping = key
        val step = crypto.setup.beginKeepRecoveryKey(key)
        if (step == null) {
            keeping = null
            val status = crypto.status()
            val kept = when {
                status.keepsRecoveryKey -> Kept.KEPT
                !status.hasScreenLock -> Kept.NO_SCREEN_LOCK
                else -> Kept.NOT_KEPT
            }
            show(flowScreen(FlowDone(kept, appLockWentOff)))
            return
        }
        show(flowScreen(FlowKeeping(prompt = PromptRequest(++requests, step))))
    }

    /** The user asks for the system prompt again, after closing it. */
    fun onKeepAgain() {
        val key = keeping ?: return
        work { keep(key) }
    }

    /** The user keeps only the paper copy. */
    fun onSkipKeeping() {
        keeping = null
        show(flowScreen(FlowDone(Kept.NOT_KEPT, appLockWentOff)))
    }

    /** How the system prompt of [request] ended. A request that is no longer shown is ignored. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        val current = (state.value as? FlowKeeping)?.prompt
        if (current == null || current.id != request.id) return
        promptEnded(request.step, outcome)
    }

    /** The step's prompt ended with [outcome]. The keeping step finishes or is thrown away. */
    private fun promptEnded(step: PromptStep<*>, outcome: PromptOutcome) {
        if (outcome != PromptOutcome.SUCCEEDED) {
            val note = when (outcome) {
                PromptOutcome.CANCELLED -> KeepNote.CANCELLED
                PromptOutcome.FAILED -> KeepNote.FAILED
                else -> null
            }
            show(flowScreen(FlowKeeping(note = note)))
            work { step.cancel() }
            return
        }
        show(flowScreen(FlowWorking))
        work {
            try {
                step.finish()
                keeping = null
                show(flowScreen(FlowDone(Kept.KEPT, appLockWentOff)))
            } catch (_: BlobException) {
                show(flowScreen(FlowKeeping(note = KeepNote.FAILED)))
            } catch (_: IllegalStateException) {
                // The kept file changed after the step began. Nothing was written.
                show(flowScreen(FlowKeeping(note = KeepNote.FAILED)))
            }
        }
    }

    /** What the screen says for a result of storing the keys. Null: they are stored. */
    protected fun problemOf(result: KeySetupResult): SecurityProblem? = when (result) {
        KeySetupResult.STORED -> null
        KeySetupResult.KEY_ID_IN_USE -> SecurityProblem.KEY_ID_IN_USE
        KeySetupResult.OLDER_RECOVERY_KEY, KeySetupResult.DIFFERENT_RECOVERY_KEY -> SecurityProblem.ALREADY_SET_UP
    }

    /** What the screen says for a result of starting over. Null: the keys are stored. */
    protected fun problemOf(result: StartOverResult): SecurityProblem? = when (result) {
        StartOverResult.STORED -> null
        StartOverResult.NOT_UNFINISHED -> SecurityProblem.ALREADY_SET_UP
        StartOverResult.KEY_ID_IN_USE -> SecurityProblem.KEY_ID_IN_USE
        StartOverResult.FILE_KEYS_DAMAGED -> SecurityProblem.FILE_KEYS_DAMAGED
    }

    protected fun problemOf(failed: BlobException): SecurityProblem = when (failed.answer) {
        BlobAnswer.DAMAGED_OR_CHANGED -> SecurityProblem.DAMAGED
        else -> SecurityProblem.NOT_NOW
    }

    override fun onCleared() {
        keeping = null
        val pending = (state.value as? FlowKeeping)?.prompt?.step
        try {
            pending?.cancel()
        } catch (_: IllegalStateException) {
            // The step was already used.
        } catch (_: BlobException) {
            // The unused Recovery guard is deleted at the next start.
        }
    }
}
