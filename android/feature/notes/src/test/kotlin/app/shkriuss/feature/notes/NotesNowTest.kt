package app.shkriuss.feature.notes

import app.shkriuss.core.testing.TestClock
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The clock of the screens (docs/apps/notes/spec.md, "The clock or the
 * time zone changes"): while a screen observes it, it reads the clock at
 * each whole minute, so a time of today becomes a day at midnight, and a
 * change of zone shows within a minute or when the screen comes back.
 */
class NotesNowTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val clock = TestClock(THE_TIME)
    private val pauses = Channel<Long>(Channel.UNLIMITED)
    private val endPause = Channel<Unit>(Channel.UNLIMITED)

    @Volatile
    private var zone: ZoneId = ZoneOffset.UTC

    private val now = NotesNow(clock, scope, { zone }) { millis ->
        pauses.send(millis)
        endPause.receive()
    }

    @After
    fun close() = scope.cancel()

    @Test
    fun whileObservedItReadsTheClockAtEachWholeMinute() = runBlocking {
        val observer = scope.launch { now.reading.collect {} }
        // 09:30 sharp: the next read is a minute away.
        assertEquals(60_000L, pauses.receive())

        clock.advanceBy(14 * 60 * 60 * 1_000L + 29 * 60 * 1_000L + 30_000L)
        zone = ZoneId.of("Asia/Tbilisi")
        endPause.send(Unit)

        // 23:59:30: half a minute to the next.
        assertEquals(30_000L, pauses.receive())
        assertEquals(clock.nowMillis, now.reading.value.millis)
        assertEquals(ZoneId.of("Asia/Tbilisi"), now.reading.value.zone)
        observer.cancel()
    }

    @Test
    fun checkReadsTheClockAtOnce() {
        clock.advanceBy(1_000L)
        zone = ZoneId.of("Asia/Tbilisi")

        now.check()

        assertEquals(THE_TIME + 1_000L, now.reading.value.millis)
        assertEquals(ZoneId.of("Asia/Tbilisi"), now.reading.value.zone)
    }
}
