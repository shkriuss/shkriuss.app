package app.shkriuss.core.data

import java.util.UUID

/**
 * Where the IDs of new records come from. Code that creates records takes
 * an [IdSource] through its constructor, so a test can pass one that gives
 * known IDs.
 */
fun interface IdSource {
    /** An ID that was never handed out before. */
    fun newId(): String

    companion object {
        /**
         * Random UUIDs (version 4) in their 36-character lower-case form,
         * for example `3f2b8c1e-5d4a-4f6b-9c7d-2e1a0b9c8d7e`. Apps pass this
         * one. The random bits come from the platform's secure random
         * source.
         */
        val RandomUuid: IdSource = IdSource { UUID.randomUUID().toString() }
    }
}
