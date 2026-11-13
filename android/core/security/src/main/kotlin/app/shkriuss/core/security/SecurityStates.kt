package app.shkriuss.core.security

import app.shkriuss.core.crypto.HardwareKeyKind
import app.shkriuss.core.crypto.SecurityLevel

/** What went wrong in a flow, as the screen says it. No answer carries a key, a word or a cause. */
enum class SecurityProblem {
    /** The Keystore cannot be used now, for example while the phone is locked. Nothing was lost. */
    NOT_NOW,

    /** A key file is damaged, and the words did not repair it. */
    DAMAGED,

    /** Android could not make a hardware key. */
    CANNOT_MAKE_KEY,

    /** The key ID of the words already names another key of this app. Very rare. */
    KEY_ID_IN_USE,

    /** A keyset that seals file keys is damaged. Those files are given up first. */
    FILE_KEYS_DAMAGED,

    /** A setup stopped half way. The security screen finishes it or starts over. */
    SETUP_UNFINISHED,

    /** The app already has its keys from a recovery key. */
    ALREADY_SET_UP,
}

/** Whether the recovery key is kept on this phone at the end of a flow. */
enum class Kept {
    /** This app keeps it, behind the system prompt. */
    KEPT,

    /** The user did not keep it this time. */
    NOT_KEPT,

    /** The phone has no screen lock, so no app can keep it. */
    NO_SCREEN_LOCK,
}

/** What the keeping step says under its button. */
enum class KeepNote {
    /** The user closed the system prompt. */
    CANCELLED,

    /** The system prompt ended with an error, for example after too many tries. */
    FAILED,
}

/**
 * One request to show Android's system prompt. Only the module makes
 * one, for one `PromptStep`; a screen in the Catalog never has one.
 */
class PromptRequest internal constructor(
    internal val id: Int,
    internal val step: app.shkriuss.core.crypto.PromptStep<*>,
) {
    override fun toString(): String = "PromptRequest($id)"
}

/** A screen of the create flow ([CreateRecoveryKeyActivity]). */
sealed interface CreateScreen

/** A screen of the enter flow ([EnterRecoveryKeyActivity]). */
sealed interface EnterScreen

/** The steps the create and the enter flow share: storing, keeping, done, or a failure. */
sealed interface FlowStep : CreateScreen, EnterScreen

/** Waiting for the keys. */
data object FlowWorking : FlowStep

/**
 * The keys are stored, and the recovery key can be kept on this phone.
 * [prompt] is set while the system prompt is open.
 */
data class FlowKeeping(val prompt: PromptRequest? = null, val note: KeepNote? = null) : FlowStep

/** The flow is done. */
data class FlowDone(val kept: Kept) : FlowStep

/** The flow stopped. Nothing was stored, or what was stored is whole. */
data class FlowFailed(val problem: SecurityProblem) : FlowStep

/** What a recovery key is and how to keep it safe, before the words are shown. */
data object CreateIntro : CreateScreen

/** The 24 words. [mismatch] is true after a wrong answer in [CreateConfirm]. */
data class CreateWords(val words: List<String>, val mismatch: Boolean = false) : CreateScreen

/** Four of the words, at [positions] (from 1), with what the user typed for each. */
data class CreateConfirm(val positions: List<Int>, val answers: List<String>) : CreateScreen

/**
 * The words typed so far: [words] holds 24 entries, empty where no word
 * is entered yet. [current] (from 0) is the word being typed, [typed] its
 * letters. [notInList] (from 1) or [doNotBelong] say what the check found.
 */
data class EnterWords(
    val words: List<String>,
    val current: Int,
    val typed: String,
    val notInList: Int? = null,
    val doNotBelong: Boolean = false,
) : EnterScreen {
    /** True when every one of the 24 words is entered. */
    val complete: Boolean get() = words.none { it.isEmpty() }
}

/** The words are an older recovery key of this app. Nothing was stored. */
data object EnterOlderKey : EnterScreen

/** The app has its keys from another recovery key, whose public short name is [keyId]. Nothing was stored. */
data class EnterDifferentKey(val keyId: String?) : EnterScreen

/** The words do not finish a setup that stopped. They can start it over. */
data object EnterStartOverOffer : EnterScreen

/** A screen of the show flow ([ShowRecoveryKeyActivity]). */
sealed interface ShowScreen

/** Before the prompt. [prompt] is set while the system prompt is open. */
data class ShowIntro(val prompt: PromptRequest? = null, val note: KeepNote? = null) : ShowScreen

/** The 24 words, shown once after one prompt. */
data class ShowWords(val words: List<String>) : ShowScreen

/** This app does not keep the recovery key, or its Recovery guard is gone. */
data object ShowNotKept : ShowScreen

/** The kept recovery key is damaged. The words repair it. */
data object ShowDamaged : ShowScreen

/** Where the recovery key of this app stands. */
enum class RecoveryKeyState {
    /** The app has no recovery key yet. */
    NONE,

    /** A setup stopped half way ("Starting over after a setup that stopped" in crypto-design.md). */
    UNFINISHED,

    /** The app has its keys from a recovery key. */
    SET_UP,
}

/** One hardware key of the app, and where it lives. */
data class KeyRow(val kind: HardwareKeyKind, val level: SecurityLevel)

/** What the security screen ([SecurityActivity]) shows. Nothing here is secret. */
data class SecurityState(
    val loaded: Boolean = false,
    val recoveryKey: RecoveryKeyState = RecoveryKeyState.NONE,
    /** The public short name of the recovery key, eight hex digits. */
    val keyId: String? = null,
    val kept: Kept = Kept.NOT_KEPT,
    val hasScreenLock: Boolean = true,
    val keys: List<KeyRow> = emptyList(),
    val needsRepair: Boolean = false,
    val filesCanBeGivenUp: Boolean = false,
    /** True if the keys could not be read now. */
    val failed: Boolean = false,
) {
    /** True if any key is not protected by hardware. */
    val softwareOnly: Boolean get() = keys.any { it.level == SecurityLevel.SOFTWARE }
}
