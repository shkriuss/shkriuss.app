package app.shkriuss.feature.notes

import app.shkriuss.core.data.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * What the phone's clock showed at one moment, for the screens: the
 * moment and the time zone. A note's last change shows as a time when it
 * is [today], else as a date (docs/apps/notes/spec.md, "Notes", point 3).
 */
data class NotesClock(
    /** The moment, in milliseconds since 1970 UTC. */
    val millis: Long,
    /** The phone's time zone at that moment. */
    val zone: ZoneId,
) {
    /** The phone's date at that moment. */
    val today: LocalDate
        get() = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
}

/**
 * The phone's clock for the screens of Notes, so that "14:05" becomes "Mon
 * 16 Nov" as the day changes, and a last change shows in the zone the
 * phone is in now (docs/apps/notes/spec.md, "The clock or the time zone
 * changes").
 *
 * While a screen observes [reading], it reads the clock at each whole
 * minute, and when the screen comes to the front ([check]). Android tells
 * no screen that the clock or the time zone was changed, so a change shows
 * within one minute. With no observer it waits for nothing. [scope] lives
 * as long as the app. [zone] and [wait] are the time zone and the pause,
 * which tests pass.
 */
class NotesNow(
    private val clock: Clock,
    scope: CoroutineScope,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
    private val wait: suspend (millis: Long) -> Unit = { delay(it) },
) {
    private val current = MutableStateFlow(read())

    /** What the clock showed when it was read last. */
    val reading: StateFlow<NotesClock> = current.asStateFlow()

    init {
        scope.launch {
            current.subscriptionCount.map { it > 0 }.distinctUntilChanged().collectLatest { observed ->
                while (observed) {
                    check()
                    wait(millisToNextMinute())
                }
            }
        }
    }

    /** Reads the clock now. The screens call it each time they come to the front. */
    fun check() {
        current.value = read()
    }

    private fun read(): NotesClock = NotesClock(clock.nowMillis(), zone())

    /** How long until the next whole minute, at least one second. */
    private fun millisToNextMinute(): Long =
        (MILLIS_PER_MINUTE - Math.floorMod(clock.nowMillis(), MILLIS_PER_MINUTE)).coerceAtLeast(MIN_WAIT_MILLIS)

    private companion object {
        const val MILLIS_PER_MINUTE = 60_000L
        const val MIN_WAIT_MILLIS = 1_000L
    }
}
