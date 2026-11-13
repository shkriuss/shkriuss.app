package app.shkriuss.core.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.KeySetupResult
import app.shkriuss.core.crypto.KeyStatus
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.crypto.ShkCrypto
import kotlin.random.Random
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The number of words the user confirms ("Creating it", step 3, in crypto-design.md). */
private const val WORDS_TO_CONFIRM = 4

/** The number of words of a recovery key. */
private const val WORD_COUNT = 24

/**
 * Creating a recovery key: the words, four of them to confirm, then the
 * keys are stored and the key is kept ("Creating it" in crypto-design.md).
 * With [startOver], the keys of a setup that stopped are replaced by those
 * of the new key ([app.shkriuss.core.crypto.KeySetup.startOver]).
 */
class CreateViewModel internal constructor(
    crypto: ShkCrypto,
    private val startOver: Boolean,
    background: CoroutineDispatcher = Dispatchers.IO,
    private val random: Random = Random.Default,
) : FlowViewModel<CreateScreen>(crypto, background, FlowWorking) {
    /** The new recovery key, from its making until it is stored. Set on the background thread. */
    @Volatile
    private var key: RecoveryKey? = null

    init {
        work {
            val status = crypto.status()
            show(if (status.hasDerivedKeys && !startOver) FlowFailed(SecurityProblem.ALREADY_SET_UP) else CreateIntro)
        }
    }

    override fun flowScreen(step: FlowStep): CreateScreen = step

    /** Makes the recovery key and shows its words. Nothing is stored yet. */
    fun onShowWords() = work {
        val made = key ?: crypto.setup.createRecoveryKey().also { key = it }
        show(CreateWords(made.words()))
    }

    /** The user wrote the words down: ask for four of them, at positions picked at random. */
    fun onWordsWritten() {
        val positions = (1..WORD_COUNT).shuffled(random).take(WORDS_TO_CONFIRM).sorted()
        show(CreateConfirm(positions, List(WORDS_TO_CONFIRM) { "" }))
    }

    /** The user typed [text] for the answer at [index]. */
    fun onAnswerChange(index: Int, text: String) {
        val confirm = state.value as? CreateConfirm ?: return
        show(confirm.copy(answers = confirm.answers.toMutableList().also { it[index] = text }))
    }

    /** Checks the four answers. A wrong one goes back to the words; right ones store the keys. */
    fun onCheck() {
        val confirm = state.value as? CreateConfirm ?: return
        val made = key ?: return
        if (!made.hasWordsAt(confirm.positions.zip(confirm.answers).toMap())) {
            show(CreateWords(made.words(), mismatch = true))
            return
        }
        show(FlowWorking)
        work {
            val problem = if (startOver) {
                problemOf(crypto.setup.startOver(made))
            } else {
                crypto.setup.storeDerivedKeys(made).let { result ->
                    if (result == KeySetupResult.DIFFERENT_RECOVERY_KEY && crypto.status().setupIsUnfinished) {
                        SecurityProblem.SETUP_UNFINISHED
                    } else {
                        problemOf(result)
                    }
                }
            }
            if (problem != null) {
                show(FlowFailed(problem))
            } else {
                key = null
                keep(made)
            }
        }
    }

    override fun onCleared() {
        key = null
        super.onCleared()
    }
}

/**
 * Entering the 24 words of a recovery key ("Entering it" in
 * crypto-design.md): one word at a time, then the check, then the keys
 * are stored, a damaged keyset is repaired, and the key is kept. With
 * [startOver], the words start a setup that stopped over.
 */
class EnterViewModel internal constructor(
    crypto: ShkCrypto,
    private val startOver: Boolean,
    background: CoroutineDispatcher = Dispatchers.IO,
) : FlowViewModel<EnterScreen>(crypto, background, emptyWords()) {
    /** The entered recovery key, while the screen offers to start over with it. */
    @Volatile
    private var entered: RecoveryKey? = null

    override fun flowScreen(step: FlowStep): EnterScreen = step

    /** The user typed [text] for the current word. */
    fun onTyped(text: String) {
        val words = state.value as? EnterWords ?: return
        show(words.copy(typed = text, notInList = null, doNotBelong = false))
    }

    /** The user picked [word] for the current word. The next empty word comes next. */
    fun onWord(word: String) {
        val screen = state.value as? EnterWords ?: return
        val words = screen.words.toMutableList().also { it[screen.current] = word }
        val next = (screen.current + 1 until WORD_COUNT).firstOrNull { words[it].isEmpty() }
            ?: words.indexOfFirst { it.isEmpty() }.takeIf { it >= 0 }
            ?: screen.current
        show(EnterWords(words, next, typed = if (words[next].isEmpty()) "" else words[next]))
    }

    /** The user wants to change the word at [index]. */
    fun onEditWord(index: Int) {
        val screen = state.value as? EnterWords ?: return
        show(screen.copy(current = index, typed = screen.words[index], notInList = null, doNotBelong = false))
    }

    /** Checks the 24 words: each in the list, and the checksum. Then the keys are stored. */
    fun onCheck() {
        val screen = state.value as? EnterWords ?: return
        when (val result = RecoveryWords.parse(screen.words.joinToString(" "))) {
            is RecoveryWordsResult.WordNotInList ->
                show(screen.copy(current = result.position - 1, typed = "", notInList = result.position))
            RecoveryWordsResult.DoNotBelongTogether -> show(screen.copy(doNotBelong = true))
            is RecoveryWordsResult.Accepted -> store(result.recoveryKey)
        }
    }

    private fun store(key: RecoveryKey) {
        show(FlowWorking)
        work {
            if (startOver) {
                startOverWith(key)
                return@work
            }
            when (crypto.setup.storeDerivedKeys(key)) {
                KeySetupResult.STORED -> keep(key)
                KeySetupResult.OLDER_RECOVERY_KEY -> show(EnterOlderKey)
                KeySetupResult.KEY_ID_IN_USE -> show(FlowFailed(SecurityProblem.KEY_ID_IN_USE))
                KeySetupResult.DIFFERENT_RECOVERY_KEY -> {
                    val status = crypto.status()
                    if (status.setupIsUnfinished) {
                        entered = key
                        show(EnterStartOverOffer)
                    } else {
                        show(EnterDifferentKey(status.keyId?.toString()))
                    }
                }
            }
        }
    }

    private suspend fun startOverWith(key: RecoveryKey) {
        val problem = problemOf(crypto.setup.startOver(key))
        if (problem != null) show(FlowFailed(problem)) else keep(key)
    }

    /** The words do not finish the setup that stopped: start it over with them. */
    fun onStartOverWithThese() {
        val key = entered ?: return
        entered = null
        show(FlowWorking)
        work { startOverWith(key) }
    }

    /** Back to the words, all empty. */
    fun onEnterOther() {
        entered = null
        show(emptyWords())
    }

    override fun onCleared() {
        entered = null
        super.onCleared()
    }

    private companion object {
        fun emptyWords() = EnterWords(List(WORD_COUNT) { "" }, current = 0, typed = "")
    }
}

/**
 * Showing the kept recovery key again ("Showing it again" in
 * crypto-design.md): one prompt, one showing. The words are dropped when
 * the screen stops: when it closes, the phone turns its screen off, or
 * another app comes to the front.
 */
class ShowViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val background: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val screen = MutableStateFlow<ShowScreen>(ShowIntro())

    @Volatile
    private var requests = 0

    /** The one state of the screen. */
    val state: StateFlow<ShowScreen> = screen.asStateFlow()

    /** Starts the system prompt that opens the kept key. */
    fun onShow() {
        work {
            val step = crypto.setup.beginShowRecoveryKey()
            screen.value = ShowIntro(prompt = PromptRequest(++requests, step))
        }
    }

    /** How the system prompt of [request] ended. */
    internal fun onPromptResult(request: PromptRequest, outcome: PromptOutcome) {
        val current = (screen.value as? ShowIntro)?.prompt
        if (current == null || current.id != request.id) return
        if (outcome != PromptOutcome.SUCCEEDED) {
            screen.value = ShowIntro(note = if (outcome == PromptOutcome.FAILED) KeepNote.FAILED else null)
            work { request.step.cancel() }
            return
        }
        work {
            val key = request.step.finish() as RecoveryKey
            screen.value = ShowWords(key.words())
        }
    }

    /** The screen stopped: the words leave memory. A new prompt shows them again. */
    fun onStop() {
        if (screen.value is ShowWords) screen.value = ShowIntro()
    }

    private fun work(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(background) { work() }
            } catch (failed: BlobException) {
                screen.value = if (failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) ShowDamaged else ShowNotKept
            }
        }
    }

    override fun onCleared() {
        screen.value = ShowIntro()
    }
}

/** The security screen: what [KeyStatus] says, read each time the screen comes to the front. */
class SecurityViewModel internal constructor(
    private val crypto: ShkCrypto,
    private val background: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val screen = MutableStateFlow(SecurityState())

    /** The one state of the screen. */
    val state: StateFlow<SecurityState> = screen.asStateFlow()

    /** Reads the keys again. */
    fun refresh() {
        viewModelScope.launch {
            screen.value = try {
                withContext(background) { stateOf(crypto.status()) }
            } catch (_: BlobException) {
                SecurityState(loaded = true, failed = true)
            }
        }
    }

    /**
     * Gives up the files whose keys no words can bring back. The screen
     * asks first, and says that those files never open again.
     */
    fun onGiveUpFiles() {
        viewModelScope.launch {
            try {
                withContext(background) { crypto.setup.giveUpDamagedFileKeys() }
            } catch (_: IllegalStateException) {
                // Nothing is damaged any more. The refresh shows that.
            } catch (_: BlobException) {
                // The refresh shows what is there now.
            }
            refresh()
        }
    }

    private fun stateOf(status: KeyStatus) = SecurityState(
        loaded = true,
        recoveryKey = when {
            status.setupIsUnfinished -> RecoveryKeyState.UNFINISHED
            status.hasDerivedKeys -> RecoveryKeyState.SET_UP
            else -> RecoveryKeyState.NONE
        },
        keyId = status.keyId?.toString(),
        kept = when {
            status.keepsRecoveryKey -> Kept.KEPT
            !status.hasScreenLock -> Kept.NO_SCREEN_LOCK
            else -> Kept.NOT_KEPT
        },
        hasScreenLock = status.hasScreenLock,
        keys = status.hardwareKeys.map { KeyRow(it.kind, it.level) },
        needsRepair = status.needsRepair,
        filesCanBeGivenUp = status.filesCanBeGivenUp,
    )
}
