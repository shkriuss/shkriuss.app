package app.shkriuss.core.data

/**
 * Where record timestamps come from. Code that stamps records takes a
 * [Clock] through its constructor, so a test can pass a clock it controls
 * instead of the device's.
 */
fun interface Clock {
    /** The current time, in milliseconds since 1970-01-01T00:00:00Z. */
    fun nowMillis(): Long

    companion object {
        /** The device's wall clock. Apps pass this one. */
        val System: Clock = Clock { java.lang.System.currentTimeMillis() }
    }
}
