package app.shkriuss.core.security

/** One screen of a keeper's handover screen ([HandoverActivity]), where another app asks for its keys. */
sealed interface HandoverScreen

/** Waiting for the keys or the prompt. */
data object HandoverWorking : HandoverScreen

/**
 * What the asking app wants, and **Allow** and **Do not allow**. [keyId]
 * is the short name of the kept recovery key. [prompt] is set while the
 * system prompt is open; [note] says how the last one ended.
 */
data class HandoverAsk(
    val mode: HandoverMode,
    val keyId: String,
    val prompt: PromptRequest? = null,
    val note: KeepNote? = null,
) : HandoverScreen

/** Four of the words, at [positions] (from 1), for [HandoverMode.CHECK_WORDS]. [mismatch] after a wrong answer. */
data class HandoverFourWords(val positions: List<Int>, val answers: List<String>, val mismatch: Boolean = false) : HandoverScreen

/** This app does not keep the recovery key now. Nothing can be handed over. */
data object HandoverNotKept : HandoverScreen

/** The keys are made. The screen hands them over and closes. */
data object HandoverReady : HandoverScreen

/** The keys could not be read now, or the kept key is damaged ([damaged]). Nothing was handed over. */
data class HandoverFailed(val damaged: Boolean) : HandoverScreen

/** One screen of the asking app's "Get the keys" screen ([GetKeysActivity]). */
sealed interface GetKeysScreen

/** Waiting for the keeper, or storing the keys. */
data object GetKeysWorking : GetKeysScreen

/**
 * The keys are stored. [keyId] is the short name of the recovery key they
 * come from. [appLockOff] is true when storing them turned the app lock
 * off, as entered words would.
 */
data class GetKeysDone(val keyId: String, val appLockOff: Boolean = false) : GetKeysScreen

/** Why no keys were stored. Nothing was changed. */
enum class GetKeysProblem {
    /** The keeper does not keep the recovery key now. */
    NOT_KEEPER,

    /** One of the two apps is older than the other. */
    UPDATE,

    /** The keeper sent something this app cannot read. */
    UNREADABLE,

    /** The other app is not one this app may take keys from. */
    NOT_A_SUITE_APP,

    /** The keys are of an older recovery key of this app. */
    OLDER_KEY,

    /** This app has its keys from another recovery key, or a setup of another key stopped half way. */
    DIFFERENT_KEY,

    /** As [SecurityProblem.KEY_ID_IN_USE]. */
    KEY_ID_IN_USE,

    /** The keys could not be stored now. */
    NOT_NOW,

    /** A key file is damaged, and these keys could not repair it. */
    DAMAGED,

    /** Android could not make a hardware key. */
    CANNOT_MAKE_KEY,
}

/** No keys were stored, because of [problem]. [keyId] is the short name of this app's own recovery key, for [GetKeysProblem.DIFFERENT_KEY]. */
data class GetKeysFailed(val problem: GetKeysProblem, val keyId: String? = null) : GetKeysScreen

/** The user did not allow it. The screen closes, and nothing changed. */
data object GetKeysClosed : GetKeysScreen
