package app.shkriuss.core.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.CannotMakeHardwareKeyException
import app.shkriuss.core.crypto.KeyStatus
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.WordsProof
import kotlin.random.Random
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What a prompt that did not succeed leaves as a note. Gone, for example after a turn of the phone, leaves none. */
private fun keepNoteOf(outcome: PromptOutcome): KeepNote? = when (outcome) {
    PromptOutcome.CANCELLED -> KeepNote.CANCELLED
    PromptOutcome.FAILED -> KeepNote.FAILED
    else -> null
}

/** Throws a step away that nobody will finish. A step that was used already is left alone. */
private fun cancelQuietly(request: PromptRequest?) {
    try {
        request?.step?.cancel()
    } catch (_: IllegalStateException) {
        // The step was used already.
    } catch (_: BlobException) {
        // An unused key is deleted at the next start.
    }
}

/**
 * The lock screen of [AppLockGate]: one system prompt of the Lock key,
 * one unlock ("Unlock" in crypto-design.md). The prompt shows by itself
 * once for each lock, and after that from the button. [onUnlocked] runs
 * on the main thread when the file keys are in memory.
 */
class UnlockViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val onUnlocked: () -> Unit,
    private val background: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val screen = MutableStateFlow(LockScreen())

    /** The one state of the lock screen. */
    val state: StateFlow<LockScreen> = screen.asStateFlow()

    @Volatile
    private var requests = 0
    private var shownFor = -1

    /** The app locked for the [lock]th time. The prompt shows by itself once for each lock. */
    fun onLocked(lock: Int) {
        if (lock == shownFor) return
        shownFor = lock
        onUnlock()
    }

    /** Starts the system prompt that unlocks the app. */
    fun onUnlock() {
        val now = screen.value
        if (now.prompt != null || now.working) return
        screen.value = LockScreen(working = true)
        work {
            val step = crypto.appLock.beginUnlock()
            screen.value = LockScreen(prompt = PromptRequest(++requests, step))
        }
    }

    /** How the system prompt of [request] ended. A request that is no longer shown is ignored. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        val current = screen.value.prompt
        if (current == null || current.id != request.id) return
        if (outcome != PromptOutcome.SUCCEEDED) {
            screen.value = LockScreen(note = if (outcome == PromptOutcome.FAILED) LockNote.FAILED else null)
            work { request.step.cancel() }
            return
        }
        screen.value = LockScreen(working = true)
        work {
            request.step.finish()
            screen.value = LockScreen()
            withContext(Dispatchers.Main.immediate) { onUnlocked() }
        }
    }

    private fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                val note = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) LockNote.DAMAGED else LockNote.NOT_NOW
                screen.value = LockScreen(note = note)
            }
        }
    }

    override fun onCleared() {
        cancelQuietly(screen.value.prompt)
    }
}

/**
 * The app lock screen: turn the app lock on or off, when it locks, the
 * notification text, and screenshots. While the app lock is on, nothing
 * shows before a system prompt in this opening of the screen, and again
 * after the app locked while the screen was away. Closing that prompt
 * closes the screen. So whoever is handed the open app cannot turn the
 * lock off, pick a longer time or show the text of notifications.
 *
 * The prompt is the unlock of the Lock key, so it also unlocks the app.
 */
class AppLockViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val watcher: AppLockWatcher,
    private val background: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val screen = MutableStateFlow<AppLockScreen>(AppLockLoading)

    /** The one state of the screen. */
    val state: StateFlow<AppLockScreen> = screen.asStateFlow()

    @Volatile
    private var requests = 0

    /** True once a prompt in this opening of the screen succeeded, and the app has not locked since. */
    @Volatile
    private var opened = false

    /** Reads the keys again. The screen calls it each time it comes to the front. */
    fun refresh() {
        val now = screen.value
        if (now is AppLockClosed || (now is AppLockAsking && now.prompt != null)) return
        work {
            val status = crypto.status()
            if (status.appLock == AppLockState.ON && (!opened || crypto.appLock.isLocked())) {
                opened = false
                screen.value = AppLockAsking()
            } else {
                screen.value = settingsOf(status, crypto.appLock.canTurnOn())
            }
        }
    }

    /** Starts the system prompt that opens the screen. The screen calls it while it asks and no prompt is open. */
    fun onAsk() {
        val now = screen.value as? AppLockAsking ?: return
        if (now.prompt != null) return
        work {
            val step = crypto.appLock.beginUnlock()
            screen.value = AppLockAsking(PromptRequest(++requests, step))
        }
    }

    /** How the system prompt of [request] ended. Closed or failed: the screen closes. Gone: it asks again. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        val current = (screen.value as? AppLockAsking)?.prompt
        if (current == null || current.id != request.id) return
        when (outcome) {
            PromptOutcome.SUCCEEDED -> {
                screen.value = AppLockLoading
                work {
                    request.step.finish()
                    opened = true
                    withContext(Dispatchers.Main.immediate) { watcher.unlocked() }
                    screen.value = settingsOf(crypto.status(), crypto.appLock.canTurnOn())
                }
            }
            PromptOutcome.GONE -> {
                screen.value = AppLockAsking()
                work { request.step.cancel() }
            }
            else -> {
                screen.value = AppLockClosed
                work { request.step.cancel() }
            }
        }
    }

    /** Turns the app lock off, while it is open. The screen asks first. */
    fun onTurnOff() {
        val settings = screen.value as? AppLockSettingsScreen ?: return
        screen.value = AppLockLoading
        viewModelScope.launch {
            try {
                withContext(background) { crypto.appLock.turnOff() }
                watcher.turnedOff()
            } catch (_: BlobException) {
                screen.value = settings.copy(turnOffFailed = true)
                return@launch
            } catch (_: IllegalStateException) {
                // The app lock is off already. The refresh shows that.
            }
            refresh()
        }
    }

    /** The user chose when the app locks. */
    fun onLockAfter(choice: LockAfter) {
        val settings = screen.value as? AppLockSettingsScreen ?: return
        watcher.lockAfter = choice
        screen.value = settings.copy(lockAfter = choice)
    }

    /** The user turned the screenshot block on or off. */
    fun onBlockScreenshots(on: Boolean) {
        val settings = screen.value as? AppLockSettingsScreen ?: return
        watcher.blocksScreenshots = on
        screen.value = settings.copy(blockScreenshots = on)
    }

    /** The user turned the text of notifications on or off. */
    fun onNotificationText(on: Boolean) {
        val settings = screen.value as? AppLockSettingsScreen ?: return
        watcher.showsNotificationText = on
        screen.value = settings.copy(notificationText = on)
    }

    private fun settingsOf(status: KeyStatus, canTurnOn: Boolean) = AppLockSettingsScreen(
        state = status.appLock,
        cannotTurnOn = when {
            status.appLock != AppLockState.OFF || canTurnOn -> null
            !status.hasScreenLock -> CannotTurnOn.NO_SCREEN_LOCK
            status.setupIsUnfinished -> CannotTurnOn.SETUP_UNFINISHED
            !status.hasDerivedKeys -> CannotTurnOn.NO_RECOVERY_KEY
            status.fileKeyMoveIsPending -> CannotTurnOn.FILE_KEYS_MOVING
            else -> CannotTurnOn.NOT_NOW
        },
        lockAfter = watcher.lockAfter,
        blockScreenshots = watcher.blocksScreenshots,
        notificationText = watcher.showsNotificationText,
    )

    private fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                screen.value = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) AppLockDamaged else AppLockFailed
            }
        }
    }

    override fun onCleared() {
        cancelQuietly((screen.value as? AppLockAsking)?.prompt)
    }
}

/**
 * Turning the app lock on ("Turning it on" in crypto-design.md): the plain
 * warning, then the check of the words, then one system prompt that makes
 * the key of the app lock.
 *
 * - An app that keeps the recovery key reads it after one prompt and asks
 *   for four of the words, at positions picked at random. A wrong word is
 *   named, and the words are never shown.
 * - An app that does not keep it asks for all 24 words, on the screen of
 *   "Enter your recovery key". Words that give this app's own `record`
 *   key are the proof. The key is not kept here.
 *
 * The recovery key is dropped right after the check. [onTurnedOn] runs on
 * the main thread when the app lock is on.
 */
class TurnOnViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val onTurnedOn: () -> Unit,
    private val background: CoroutineDispatcher = Dispatchers.IO,
    private val random: Random = Random.Default,
) : ViewModel() {
    private val screen = MutableStateFlow<TurnOnScreen>(TurnOnWorking)

    /** The one state of the screen. */
    val state: StateFlow<TurnOnScreen> = screen.asStateFlow()

    @Volatile
    private var requests = 0

    /** The kept recovery key, from the prompt that read it until the four words are checked. */
    @Volatile
    private var kept: RecoveryKey? = null

    /** The proof that the words were checked, kept for a new try of the last prompt. It holds nothing secret. */
    @Volatile
    private var proof: WordsProof? = null

    init {
        work {
            screen.value = if (crypto.appLock.canTurnOn()) {
                TurnOnIntro(keeper = crypto.setup.keepsRecoveryKey())
            } else {
                TurnOnFailed(TurnOnProblem.NOT_ALLOWED)
            }
        }
    }

    /** The user read the warning. */
    fun onContinue() {
        val intro = screen.value as? TurnOnIntro ?: return
        if (intro.keeper) onRead() else screen.value = TurnOnAllWords(WordEntry.empty())
    }

    /** Starts the system prompt that reads the kept recovery key. */
    fun onRead() {
        screen.value = TurnOnWorking
        work {
            val step = try {
                crypto.setup.beginShowRecoveryKey()
            } catch (_: BlobException) {
                // The kept copy is gone or damaged. All 24 words are the proof instead.
                screen.value = TurnOnAllWords(WordEntry.empty(), keptUnreadable = true)
                return@work
            }
            screen.value = TurnOnReading(prompt = PromptRequest(++requests, step))
        }
    }

    /** How the system prompt of [request] ended. A request that is no longer shown is ignored. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        when (val now = screen.value) {
            is TurnOnReading -> if (now.prompt?.id == request.id) readEnded(request, outcome)
            is TurnOnLocking -> if (now.prompt?.id == request.id) lockEnded(request, outcome)
            else -> Unit
        }
    }

    private fun readEnded(request: PromptRequest, outcome: PromptOutcome) {
        if (outcome != PromptOutcome.SUCCEEDED) {
            screen.value = TurnOnReading(note = keepNoteOf(outcome))
            work { request.step.cancel() }
            return
        }
        screen.value = TurnOnWorking
        work {
            kept = try {
                request.step.finish() as RecoveryKey
            } catch (failed: BlobException) {
                screen.value = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) {
                    TurnOnAllWords(WordEntry.empty(), keptUnreadable = true)
                } else {
                    TurnOnReading(note = KeepNote.FAILED)
                }
                return@work
            }
            screen.value = TurnOnFourWords(confirmPositions(random), List(WORDS_TO_CONFIRM) { "" })
        }
    }

    /** The user typed [text] for the answer at [index]. */
    fun onAnswerChange(index: Int, text: String) {
        val four = screen.value as? TurnOnFourWords ?: return
        screen.value = four.copy(answers = four.answers.toMutableList().also { it[index] = text }, mismatch = false)
    }

    /** Checks the four answers against the kept key. */
    fun onCheckFour() {
        val four = screen.value as? TurnOnFourWords ?: return
        val key = kept ?: return
        screen.value = TurnOnWorking
        work {
            val checked = crypto.setup.checkFourWords(key, four.positions.zip(four.answers).toMap())
            if (checked == null) {
                screen.value = four.copy(mismatch = true)
            } else {
                kept = null
                proof = checked
                beginLocking()
            }
        }
    }

    /** The user typed [text] for the current one of the 24 words. */
    fun onTyped(text: String) = onWords { WordEntry.typed(it, text) }

    /** The user picked [word] for the current one of the 24 words. */
    fun onWord(word: String) = onWords { WordEntry.picked(it, word) }

    /** The user wants to change the word at [index]. */
    fun onEditWord(index: Int) = onWords { WordEntry.edit(it, index) }

    private fun onWords(change: (EnterWords) -> EnterWords) {
        val all = screen.value as? TurnOnAllWords ?: return
        screen.value = all.copy(entry = change(all.entry), notThisApp = false)
    }

    /** Checks the 24 words: each in the list, the checksum, and then that they give this app's own keys. */
    fun onCheckAll() {
        val all = screen.value as? TurnOnAllWords ?: return
        when (val result = WordEntry.check(all.entry)) {
            is RecoveryWordsResult.Accepted -> {
                screen.value = TurnOnWorking
                work {
                    val checked = crypto.setup.checkAllWords(result.recoveryKey)
                    if (checked == null) {
                        screen.value = all.copy(notThisApp = true)
                    } else {
                        proof = checked
                        beginLocking()
                    }
                }
            }
            else -> screen.value = all.copy(entry = WordEntry.problem(all.entry, result), notThisApp = false)
        }
    }

    /** Asks for the last prompt again, after it was closed. */
    fun onLockAgain() {
        if (proof == null) return
        screen.value = TurnOnWorking
        work { beginLocking() }
    }

    private fun beginLocking() {
        val checked = proof ?: return
        val step = crypto.appLock.beginTurnOn(checked)
        screen.value = TurnOnLocking(prompt = PromptRequest(++requests, step))
    }

    private fun lockEnded(request: PromptRequest, outcome: PromptOutcome) {
        if (outcome != PromptOutcome.SUCCEEDED) {
            screen.value = TurnOnLocking(note = keepNoteOf(outcome))
            work { request.step.cancel() }
            return
        }
        screen.value = TurnOnWorking
        work {
            try {
                request.step.finish()
            } catch (_: BlobException) {
                screen.value = TurnOnLocking(note = KeepNote.FAILED)
                return@work
            }
            proof = null
            withContext(Dispatchers.Main.immediate) { onTurnedOn() }
            screen.value = TurnOnDone
        }
    }

    private fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                val problem = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) TurnOnProblem.DAMAGED else TurnOnProblem.NOT_NOW
                screen.value = TurnOnFailed(problem)
            } catch (_: CannotMakeHardwareKeyException) {
                screen.value = TurnOnFailed(TurnOnProblem.CANNOT_MAKE_KEY)
            } catch (_: IllegalStateException) {
                // The app lock may not be turned on now, or the file-key keyset changed meanwhile. Nothing was changed.
                screen.value = TurnOnFailed(TurnOnProblem.NOT_ALLOWED)
            }
        }
    }

    override fun onCleared() {
        kept = null
        proof = null
        when (val now = screen.value) {
            is TurnOnReading -> cancelQuietly(now.prompt)
            is TurnOnLocking -> cancelQuietly(now.prompt)
            else -> Unit
        }
    }
}
