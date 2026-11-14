package app.shkriuss.feature.water

import app.shkriuss.core.data.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * The phone's local day and time, from a [Clock] and a time zone. A day
 * starts at midnight on the phone's clock (docs/apps/water/spec.md,
 * "Units", point 11). Tests pass a clock and a zone they control.
 */
class WaterTime(
    private val clock: Clock,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
) {
    /** The local date and time now. */
    fun now(): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(clock.nowMillis()), zone())

    /** Today, on the phone's clock. */
    fun today(): LocalDate = now().toLocalDate()

    /** The minute of now, in minutes after midnight. */
    fun minuteNow(): Int = now().let { it.hour * 60 + it.minute }

    /** How long until the next midnight, in milliseconds, at least one second. */
    fun millisToNextDay(): Long {
        val now = clock.nowMillis()
        val midnight = today().plusDays(1).atStartOfDay(zone()).toInstant().toEpochMilli()
        return (midnight - now).coerceAtLeast(MIN_WAIT_MILLIS)
    }

    private companion object {
        const val MIN_WAIT_MILLIS = 1_000L
    }
}

/** This date as a day of the database: days since 1970-01-01 (`intake.day`, `goal.fromDay`). */
fun LocalDate.asWaterDay(): Int = Math.toIntExact(toEpochDay())

/** The date of a day of the database. */
fun waterDayDate(day: Int): LocalDate = LocalDate.ofEpochDay(day.toLong())
