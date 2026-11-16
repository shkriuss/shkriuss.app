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
    /** Now, in milliseconds since 1970. */
    fun nowMillis(): Long = clock.nowMillis()

    /** The local date and time now. */
    fun now(): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(clock.nowMillis()), zone())

    /** Today, on the phone's clock. */
    fun today(): LocalDate = now().toLocalDate()

    /** The minute of now, in minutes after midnight. */
    fun minuteNow(): Int = now().let { it.hour * 60 + it.minute }

    /** The local date and time of the moment [millis], in milliseconds since 1970. */
    fun local(millis: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), zone())

    /** The moment of the local date and time [time], in milliseconds since 1970. A time in a gap of summer time moves forward. */
    fun millisOf(time: LocalDateTime): Long = time.atZone(zone()).toInstant().toEpochMilli()

    /** The moment of the next midnight on the phone's clock, in milliseconds since 1970. */
    fun nextMidnightMillis(): Long = today().plusDays(1).atStartOfDay(zone()).toInstant().toEpochMilli()

    /** How long until the next midnight, in milliseconds, at least one second. */
    fun millisToNextDay(): Long {
        val now = clock.nowMillis()
        return (nextMidnightMillis() - now).coerceAtLeast(MIN_WAIT_MILLIS)
    }

    private companion object {
        const val MIN_WAIT_MILLIS = 1_000L
    }
}

/**
 * The days a record of Water can hold (`intake.day`, `goal.fromDay`):
 * from 1970-01-01, day 0, to 9999-12-31 (docs/apps/water/spec.md, "Data
 * model"). A backup with another day is refused. Without the limit, one
 * record with a far day would make History build a row for every day up
 * to today.
 */
val WATER_DAYS: IntRange = 0..2_932_896

/** This date as a day of the database: days since 1970-01-01 (`intake.day`, `goal.fromDay`). */
fun LocalDate.asWaterDay(): Int = Math.toIntExact(toEpochDay())

/** The date of a day of the database. */
fun waterDayDate(day: Int): LocalDate = LocalDate.ofEpochDay(day.toLong())
