package app.shkriuss.feature.tasks

import app.shkriuss.core.data.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
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
 * What the phone's clock showed at one moment: the moment, and the time
 * zone of that moment. Every rule of Tasks reads one, so that a rule
 * never mixes two readings of the clock.
 */
data class ClockReading(
    /** The moment, in milliseconds since 1970 UTC. */
    val millis: Long,
    /** The phone's time zone at that moment. */
    val zone: ZoneId,
) {
    /** The local date and time. */
    val local: LocalDateTime
        get() = local(millis)

    /** Today: the phone's date now (docs/apps/tasks/spec.md, "Words used on this page"). */
    val today: LocalDate
        get() = local.toLocalDate()

    /** The current minute: the local date and time without its seconds. */
    val currentMinute: LocalDateTime
        get() = local.truncatedTo(ChronoUnit.MINUTES)

    /** The local date and time of the moment [millis], in this zone. */
    fun local(millis: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), zone)

    /**
     * The moment of the local date and time [time], in this zone, as
     * Reminders finds the moment of an occurrence: a time that does not
     * exist, when the clock jumps forward, moves later by the jump, and a
     * time that happens twice is the first.
     */
    fun millisOf(time: LocalDateTime): Long = time.atZone(zone).toInstant().toEpochMilli()
}

/** The phone's clock and time zone. Tests pass a clock and a zone they control. */
class TasksTime(
    private val clock: Clock,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
) {
    /** What the clock shows now. */
    fun reading(): ClockReading = ClockReading(clock.nowMillis(), zone())

    /** How long until the next whole minute, in milliseconds, at least one second. */
    fun millisToNextMinute(): Long {
        val now = clock.nowMillis()
        return (MILLIS_PER_MINUTE - Math.floorMod(now, MILLIS_PER_MINUTE)).coerceAtLeast(MIN_WAIT_MILLIS)
    }

    private companion object {
        const val MILLIS_PER_MINUTE = 60_000L
        const val MIN_WAIT_MILLIS = 1_000L
    }
}

/**
 * The phone's clock for the screens of Tasks: one source that every
 * ViewModel observes, so that no two screens disagree about which day is
 * today, and which tasks are overdue.
 *
 * While a ViewModel observes [reading], it reads the clock again:
 *
 * 1. at each whole minute, so from midnight on a task due yesterday is
 *    overdue (docs/apps/tasks/spec.md, "The clock or the time zone
 *    changes");
 * 2. when the screen comes to the front ([check]).
 *
 * Android tells no screen that the clock or the time zone was changed, so
 * a change shows within one minute. With no observer it waits for
 * nothing. [scope] lives as long as the app. [wait] waits that many
 * milliseconds. Tests pass their own.
 */
class TasksNow(
    private val time: TasksTime,
    scope: CoroutineScope,
    private val wait: suspend (millis: Long) -> Unit = { delay(it) },
) {
    private val current = MutableStateFlow(time.reading())

    /** What the clock showed when it was read last. */
    val reading: StateFlow<ClockReading> = current.asStateFlow()

    init {
        scope.launch {
            current.subscriptionCount.map { it > 0 }.distinctUntilChanged().collectLatest { observed ->
                while (observed) {
                    check()
                    wait(time.millisToNextMinute())
                }
            }
        }
    }

    /** Reads the clock now. The screen calls it each time it comes to the front. */
    fun check() {
        current.value = time.reading()
    }
}
