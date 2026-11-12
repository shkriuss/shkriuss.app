package app.shkriuss.core.testing

import app.shkriuss.core.data.Clock

/**
 * A [Clock] that a test sets and moves by hand. It never moves by itself.
 */
class TestClock(
    /** The time it starts at, in milliseconds since 1970-01-01T00:00:00Z. */
    var nowMillis: Long = START_MILLIS,
) : Clock {
    override fun nowMillis(): Long = nowMillis

    /** Moves the clock forward, or back with a negative [millis]. */
    fun advanceBy(millis: Long) {
        nowMillis += millis
    }

    /** The default start time. */
    companion object {
        /** 2026-01-01T00:00:00Z. */
        const val START_MILLIS: Long = 1_767_225_600_000L
    }
}
