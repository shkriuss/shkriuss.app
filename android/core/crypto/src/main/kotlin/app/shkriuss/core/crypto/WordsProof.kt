package app.shkriuss.core.crypto

/**
 * Proof that the user just gave this app's recovery words, needed to turn
 * the app lock on ("The app lock" in crypto-design.md, rule 2). Only
 * [KeySetup.checkFourWords] and [KeySetup.checkAllWords] make one, so the
 * app lock can never be turned on without the check.
 *
 * It holds only [keyId]: the public key ID of the `record` key the words
 * were checked against. [AppLock.beginTurnOn] refuses a proof whose key
 * ID is not the one of the `record` key stored now.
 */
class WordsProof internal constructor(internal val keyId: KeyId) {
    /** Says only what it is. */
    override fun toString(): String = "WordsProof"
}
