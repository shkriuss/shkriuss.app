package app.shkriuss.feature.reminders

import app.shkriuss.core.data.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * What the phone's clock showed at one moment: the moment, and the time
 * zone of that moment. Every rule of Reminders reads one, so that a rule
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

    /** Today, on the phone's clock. */
    val today: LocalDate
        get() = local.toLocalDate()

    /** The current minute: the local date and time without its seconds. */
    val currentMinute: LocalDateTime
        get() = local.truncatedTo(ChronoUnit.MINUTES)

    /** The local date and time of the moment [millis], in this zone. */
    fun local(millis: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), zone)

    /**
     * The moment of the local date and time [time], in this zone, with
     * `java.time` (docs/apps/reminders/spec.md, "Occurrences"): a time
     * that does not exist, when the clock jumps forward, moves later by
     * the jump, and a time that happens twice is the first.
     */
    fun millisOf(time: LocalDateTime): Long = time.atZone(zone).toInstant().toEpochMilli()
}

/**
 * The phone's clock and time zone. Tests pass a clock and a zone they
 * control.
 */
class RemindersTime(
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
