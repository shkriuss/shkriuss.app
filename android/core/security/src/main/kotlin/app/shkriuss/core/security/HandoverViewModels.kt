package app.shkriuss.core.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.CannotMakeHardwareKeyException
import app.shkriuss.core.crypto.HandedOverKeys
import app.shkriuss.core.crypto.KeySetupResult
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.ShkCrypto
import kotlin.random.Random
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A keeper's side of the handover (ADR 0041): the app [asker] asks for its
 * own keys, or, in [HandoverMode.CHECK_WORDS], for four of the words to be
 * checked first. The user allows it, the system prompt of the Recovery
 * guard opens the kept key, and `core/crypto` makes the asker's keys.
 *
 * In [HandoverMode.KEYS] the recovery key never reaches this object: the
 * prompt step makes the keys. In [HandoverMode.CHECK_WORDS] the kept key
 * is held from the prompt until the four words are checked, as when the
 * keeper turns its own app lock on, and leaves memory when the screen
 * stops. The keys wait here until the screen takes them ([takeKeys]).
 *
 * [main] is the main thread. Tests hold its work back.
 */
class HandoverViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val asker: AppName,
    private val mode: HandoverMode,
    private val background: CoroutineDispatcher = Dispatchers.IO,
    private val random: Random = Random.Default,
    private val main: CoroutineDispatcher = Dispatchers.Main.immediate,
) : ViewModel() {
    private val screen = MutableStateFlow<HandoverScreen>(HandoverWorking)

    /** The one state of the screen. */
    val state: StateFlow<HandoverScreen> = screen.asStateFlow()

    @Volatile
    private var requests = 0

    /** The short name of the kept key, for the screen that asks. */
    @Volatile
    private var keyId: String? = null

    /** The kept recovery key, in [HandoverMode.CHECK_WORDS] only, from the prompt until the words are checked. */
    @Volatile
    private var kept: RecoveryKey? = null

    /** The keys, from when they are made until the screen takes them. */
    @Volatile
    private var keys: HandedOverKeys? = null

    /** Counts the stops that dropped the kept key. Work that began before one keeps nothing. */
    @Volatile
    private var stops = 0

    init {
        work {
            val status = crypto.status()
            val id = status.keyId?.toString()
            keyId = id
            screen.value = if (status.keepsRecoveryKey && id != null) HandoverAsk(mode, id) else HandoverNotKept
        }
    }

    /** The user allows it: the system prompt of the Recovery guard. */
    fun onAllow() {
        val ask = screen.value as? HandoverAsk ?: return
        if (ask.prompt != null) return
        screen.value = HandoverWorking
        work {
            val step = try {
                if (mode == HandoverMode.KEYS) crypto.setup.beginHandOver(asker) else crypto.setup.beginShowRecoveryKey()
            } catch (failed: BlobException) {
                screen.value = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) HandoverFailed(damaged = true) else HandoverNotKept
                return@work
            }
            screen.value = ask.copy(prompt = PromptRequest(++requests, step, stops), note = null)
        }
    }

    /** How the system prompt of [request] ended. A request that is no longer shown is ignored. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        val ask = screen.value as? HandoverAsk ?: return
        if (ask.prompt?.id != request.id) return
        if (outcome != PromptOutcome.SUCCEEDED) {
            screen.value = ask.copy(prompt = null, note = keepNoteOf(outcome))
            work { request.step.cancel() }
            return
        }
        screen.value = HandoverWorking
        work {
            val result = try {
                request.step.finish()
            } catch (failed: BlobException) {
                screen.value = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) {
                    HandoverFailed(damaged = true)
                } else {
                    ask.copy(prompt = null, note = KeepNote.FAILED)
                }
                return@work
            }
            // On the main thread, where onStop runs: a stop either comes before this, and nothing is kept, or after it.
            withContext(main) {
                if (request.askedAt != stops) {
                    screen.value = ask.copy(prompt = null)
                    return@withContext
                }
                when (result) {
                    is HandedOverKeys -> {
                        keys = result
                        screen.value = HandoverReady
                    }
                    is RecoveryKey -> {
                        kept = result
                        screen.value = HandoverFourWords(confirmPositions(random), List(WORDS_TO_CONFIRM) { "" })
                    }
                    else -> screen.value = HandoverFailed(damaged = false)
                }
            }
        }
    }

    /** The user typed [text] for the answer at [index]. */
    fun onAnswerChange(index: Int, text: String) {
        val four = screen.value as? HandoverFourWords ?: return
        screen.value = four.copy(answers = four.answers.toMutableList().also { it[index] = text }, mismatch = false)
    }

    /** Checks the four answers against the kept key. Right ones make the asker's keys, marked as checked. */
    fun onCheckFour() {
        val four = screen.value as? HandoverFourWords ?: return
        val key = kept ?: return
        screen.value = HandoverWorking
        val asked = stops
        work {
            val checked = crypto.setup.handOverAfterWords(key, four.positions.zip(four.answers).toMap(), asker)
            withContext(main) {
                if (asked != stops) return@withContext
                if (checked == null) {
                    screen.value = four.copy(mismatch = true)
                } else {
                    kept = null
                    keys = checked
                    screen.value = HandoverReady
                }
            }
        }
    }

    /**
     * Hands the keys to the screen once, which gives them to the asking app
     * and closes. Null if there are none, or they were taken already.
     */
    internal fun takeKeys(): HandedOverKeys? = keys.also { keys = null }

    /**
     * The screen stopped. Unless the phone is only turning
     * ([changingConfigurations]), the kept key and any keys not handed over
     * yet leave memory, and the screen asks again.
     */
    fun onStop(changingConfigurations: Boolean) {
        if (changingConfigurations) return
        stops++
        val held = kept != null || keys != null || screen.value is HandoverFourWords || screen.value is HandoverReady
        kept = null
        keys = null
        val id = keyId
        if (held && id != null) screen.value = HandoverAsk(mode, id)
    }

    private fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                kept = null
                screen.value = HandoverFailed(damaged = failed.answer == BlobAnswer.DAMAGED_OR_CHANGED)
            }
        }
    }

    override fun onCleared() {
        kept = null
        keys = null
        cancelQuietly((screen.value as? HandoverAsk)?.prompt)
    }
}

/**
 * The asking app's side of the handover (ADR 0041): it stores what a
 * keeper handed over, as entered words would be stored
 * ([app.shkriuss.core.crypto.KeySetup.storeHandedOverKeys]), and says how
 * it went. [onAppLockChanged] runs on the main thread when storing turned
 * the app lock off, as in [EnterViewModel].
 */
class GetKeysViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val background: CoroutineDispatcher = Dispatchers.IO,
    private val onAppLockChanged: () -> Unit = {},
) : ViewModel() {
    private val screen = MutableStateFlow<GetKeysScreen>(GetKeysWorking)

    /** The one state of the screen. */
    val state: StateFlow<GetKeysScreen> = screen.asStateFlow()

    /** What the keeper answered. */
    internal fun onAnswer(answer: KeeperAnswer) {
        when (answer) {
            is KeeperAnswer.Keys -> store(answer.keys)
            KeeperAnswer.Declined -> screen.value = GetKeysClosed
            KeeperAnswer.NotKeeper -> screen.value = GetKeysFailed(GetKeysProblem.NOT_KEEPER)
            KeeperAnswer.Update -> screen.value = GetKeysFailed(GetKeysProblem.UPDATE)
            KeeperAnswer.Unreadable -> screen.value = GetKeysFailed(GetKeysProblem.UNREADABLE)
            KeeperAnswer.NotASuiteApp -> screen.value = GetKeysFailed(GetKeysProblem.NOT_A_SUITE_APP)
        }
    }

    private fun store(keys: HandedOverKeys) {
        screen.value = GetKeysWorking
        viewModelScope.launch {
            screen.value = try {
                withContext(background) { stored(keys) }
            } catch (failed: BlobException) {
                GetKeysFailed(if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) GetKeysProblem.DAMAGED else GetKeysProblem.NOT_NOW)
            } catch (_: CannotMakeHardwareKeyException) {
                GetKeysFailed(GetKeysProblem.CANNOT_MAKE_KEY)
            }
        }
    }

    private suspend fun stored(keys: HandedOverKeys): GetKeysScreen {
        val lockBefore = crypto.appLock.state()
        return when (crypto.setup.storeHandedOverKeys(keys)) {
            KeySetupResult.STORED -> {
                val off = lockBefore != AppLockState.OFF && crypto.appLock.state() == AppLockState.OFF
                if (off) withContext(Dispatchers.Main.immediate) { onAppLockChanged() }
                GetKeysDone(keys.keyId.toString(), appLockOff = off)
            }
            KeySetupResult.OLDER_RECOVERY_KEY -> GetKeysFailed(GetKeysProblem.OLDER_KEY)
            KeySetupResult.KEY_ID_IN_USE -> GetKeysFailed(GetKeysProblem.KEY_ID_IN_USE)
            KeySetupResult.DIFFERENT_RECOVERY_KEY -> GetKeysFailed(GetKeysProblem.DIFFERENT_KEY, crypto.status().keyId?.toString())
        }
    }
}
