package app.shkriuss.core.testing

import app.shkriuss.core.data.IdSource

/**
 * An [IdSource] that hands out known IDs, so tests can name the records
 * they expect. The IDs have the form of a random UUID, and sort in the
 * order they were handed out:
 * `00000000-0000-4000-8000-000000000001`, then `...0002`, and so on.
 */
class TestIdSource : IdSource {
    private var count = 0L

    override fun newId(): String = idNumber(++count)

    /** The IDs that come from a [TestIdSource]. */
    companion object {
        /** The [number]th ID a new [TestIdSource] hands out, counting from 1. */
        fun idNumber(number: Long): String = "00000000-0000-4000-8000-%012x".format(number)
    }
}
