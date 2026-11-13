package app.shkriuss.core.crypto

/**
 * Proof that the user just gave this app's recovery words, needed to turn
 * the app lock on ("The app lock" in crypto-design.md, rule 2). Only
 * [KeySetup.checkFourWords] and [KeySetup.checkAllWords] make one, so the
 * app lock can never be turned on without the check. It holds nothing.
 */
class WordsProof internal constructor() {
    /** Says only what it is. */
    override fun toString(): String = "WordsProof"
}
