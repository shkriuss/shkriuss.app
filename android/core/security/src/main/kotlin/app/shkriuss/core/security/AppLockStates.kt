package app.shkriuss.core.security

import app.shkriuss.core.crypto.AppLockState

/** Why a system prompt of the app lock did not open the app. No note carries a key or a cause. */
enum class LockNote {
    /** The prompt ended with an error, for example after too many tries. */
    FAILED,

    /** The key file of the app lock is damaged. The 24 words repair it, and the app lock is then off. */
    DAMAGED,

    /** The keys cannot be used now. Nothing was lost. */
    NOT_NOW,
}

/**
 * What the lock screen of [AppLockGate] shows. [prompt] is set while the
 * system prompt is open, [working] while the keys are read.
 */
data class LockScreen(val prompt: PromptRequest? = null, val note: LockNote? = null, val working: Boolean = false)

/** Why the app lock cannot be turned on now ("The app lock" in crypto-design.md, rule 1). */
enum class CannotTurnOn {
    /** The phone has no screen lock. */
    NO_SCREEN_LOCK,

    /** The app has no recovery key yet. */
    NO_RECOVERY_KEY,

    /** Setting up the recovery key stopped half way. */
    SETUP_UNFINISHED,

    /** The app still moves the keys of its files under its recovery key. */
    FILE_KEYS_MOVING,

    /** Something else: the keys cannot be judged now. */
    NOT_NOW,
}

/** One screen of the app lock screen ([AppLockActivity]). */
sealed interface AppLockScreen

/** The keys are read. */
data object AppLockLoading : AppLockScreen

/**
 * The app lock is on: the screen asks for the system prompt before it
 * shows anything. [prompt] is set while the prompt is open.
 */
data class AppLockAsking(val prompt: PromptRequest? = null) : AppLockScreen

/** The settings of the app lock. */
data class AppLockSettingsScreen(
    val state: AppLockState,
    /** Why the app lock cannot be turned on now, or null if it can. Only while it is off. */
    val cannotTurnOn: CannotTurnOn? = null,
    val lockAfter: LockAfter = LockAfter.LEAVING,
    val blockScreenshots: Boolean = false,
    val notificationText: Boolean = false,
    /** True if turning the app lock off did not work now. */
    val turnOffFailed: Boolean = false,
) : AppLockScreen

/** The prompt found the key file of the app lock damaged. Only the 24 words repair it. */
data object AppLockDamaged : AppLockScreen

/** The keys could not be read now. */
data object AppLockFailed : AppLockScreen

/** The user closed the prompt: the screen closes, and shows nothing. */
data object AppLockClosed : AppLockScreen

/** Why the app lock could not be turned on. */
enum class TurnOnProblem {
    /** The app lock cannot be turned on now: the phone or the keys changed since the screen opened. */
    NOT_ALLOWED,

    /** The keys cannot be used now. Nothing was changed. */
    NOT_NOW,

    /** A key file is damaged. */
    DAMAGED,

    /** Android could not make the key of the app lock. */
    CANNOT_MAKE_KEY,
}

/** One screen of turning the app lock on ([TurnOnAppLockActivity]). */
sealed interface TurnOnScreen

/** The keys are read or stored. */
data object TurnOnWorking : TurnOnScreen

/**
 * The plain warning before the app lock is turned on. [keeper] is true if
 * this app keeps the recovery key: it then asks for four words, else for
 * all 24.
 */
data class TurnOnIntro(val keeper: Boolean) : TurnOnScreen

/** A keeper app reads its kept recovery key, after the system prompt, to check four words. */
data class TurnOnReading(val prompt: PromptRequest? = null, val note: KeepNote? = null) : TurnOnScreen

/** Four of the words, at [positions] picked at random. [mismatch] is true after a wrong answer. The words are never shown. */
data class TurnOnFourWords(val positions: List<Int>, val answers: List<String>, val mismatch: Boolean = false) : TurnOnScreen

/**
 * All 24 words, on the screen of "Enter your recovery key", in an app
 * that does not keep the recovery key. [notThisApp] is true when they are
 * the words of another recovery key. [keptUnreadable] is true when this
 * app keeps the key but could not read it.
 */
data class TurnOnAllWords(
    val entry: EnterWords,
    val notThisApp: Boolean = false,
    val keptUnreadable: Boolean = false,
) : TurnOnScreen

/** The words are checked. The system prompt makes the key of the app lock. */
data class TurnOnLocking(val prompt: PromptRequest? = null, val note: KeepNote? = null) : TurnOnScreen

/** The app lock is on. */
data object TurnOnDone : TurnOnScreen

/** The app lock could not be turned on. Nothing was changed. */
data class TurnOnFailed(val problem: TurnOnProblem) : TurnOnScreen
