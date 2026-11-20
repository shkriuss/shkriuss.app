package app.shkriuss.feature.water

import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * What the rule of the next reminder needs to know about one day: today's
 * drinks, and the bookkeeping of reminders that stays on this phone
 * (docs/apps/water/spec.md, "On this phone only"). Times are moments in
 * the phone's time zone.
 */
data class ReminderFacts(
    /** The day these facts are about. The rule takes them only for the day of its `now`. */
    val day: LocalDate,
    /** The latest clock time among the day's drinks that are not deleted, in minutes after midnight, or null. */
    val latestDrinkMinute: Int?,
    /** True once the day's total reaches its goal. */
    val goalMet: Boolean,
    /** When the last reminder was shown, or null. It counts only if it was on [day]. */
    val lastShown: ZonedDateTime? = null,
    /** When Later was last pressed, or null. It counts only if it was on [day]. */
    val lastLater: ZonedDateTime? = null,
    /** The time of the snooze that Later set, or null. */
    val snooze: ZonedDateTime? = null,
    /**
     * The reminder Water set an alarm for that has not reached Water's
     * handler yet, or null. While it is due by less than
     * [NextReminder.GRACE_SECONDS], it is still the next reminder.
     */
    val pending: ZonedDateTime? = null,
)

/**
 * The rule of the next reminder, as plain code
 * (docs/apps/water/spec.md, "When the next reminder comes"). Water keeps
 * one alarm at a time. `WaterReminders` names it at the time this gives,
 * and Water calls the rule again after every change.
 *
 * 1. **The count** starts at the latest of these four, all of today:
 *    "From", the time of the latest drink, the time the last reminder was
 *    shown, and the time Later was last pressed.
 * 2. **The next reminder** is the first of "the count + 1 interval", "the
 *    count + 2 intervals", and so on, that is later than now.
 * 3. **A snooze comes first, while Later is the latest.** A snooze holds
 *    only while the press of Later is still the latest of the four. A
 *    drink timed at or after the press ends it. A drink entered with an
 *    earlier time does not (the owner's decision).
 * 4. **Only inside the reminder hours, and only until the goal is met.**
 *    Otherwise the next one is tomorrow at "From" + 1 interval.
 * 5. Reminders off: no alarm.
 * 6. If "From" + 1 interval is after "Until", no reminder fits on any day:
 *    no alarm.
 * 7. **A reminder that is due and not handled yet stays for one minute.**
 *    Water set an alarm for it, and its time came less than a minute ago,
 *    but the alarm has not reached Water's handler yet. If the rule still
 *    gives it, it is still the next reminder. Without this, a sync in
 *    those seconds would move the alarm on and the reminder would be lost:
 *    when Android starts Water's process for the alarm, the start of the
 *    app runs a sync before the alarm comes (the owner's decision).
 *
 * Times count in whole minutes of real time since the start of the day.
 * On most days that is the clock's minute. On a day the clocks change, an
 * interval is still that much real time, and the hour that comes twice
 * counts twice. "From", "Until" and the time of a drink are clock times:
 * in the hour that comes twice they are the first of the two, and in the
 * hour that does not exist they move forward, as the clock does. A press
 * of Later at 12:22:40 counts as 12:22, and its snooze is at 12:37.
 */
object NextReminder {
    /** How long Later waits. It cannot be changed. */
    const val SNOOZE_MINUTES: Int = 15

    /** How long a reminder that is due and not handled yet stays the next one (point 7). */
    const val GRACE_SECONDS: Long = 60

    /**
     * The time of the next reminder after [now], or null for no alarm.
     * [facts] must be about the day of [now].
     */
    fun after(now: ZonedDateTime, settings: WaterSettings, facts: ReminderFacts): ZonedDateTime? {
        require(facts.day == now.toLocalDate()) { "The facts are about another day" }
        val day = Day(facts.day, now.zone)
        val pending = facts.pending?.takeIf {
            day.holds(it) && !it.toInstant().isAfter(now.toInstant()) && now.toInstant().isBefore(it.toInstant().plusSeconds(GRACE_SECONDS))
        }
        // Just before its time the rule gave it. If it still does, nothing has answered it.
        if (pending != null && afterMinute(day.minuteOf(pending) - 1, settings, facts, day)?.toInstant() == pending.toInstant()) {
            return pending
        }
        return afterMinute(day.minuteOf(now), settings, facts, day)
    }

    /** The rule of points 1 to 6, for a now in the minute [nowMinute] of [day], in real minutes. */
    private fun afterMinute(nowMinute: Int, settings: WaterSettings, facts: ReminderFacts, day: Day): ZonedDateTime? {
        if (!settings.remindersOn || !settings.reminderFits) return null
        val tomorrow = firstOf(Day(day.date.plusDays(1), day.zone), settings)
        if (facts.goalMet) return tomorrow

        val from = day.minuteOfClock(settings.fromMinute)
        val until = day.minuteOfClock(settings.untilMinute)
        val drink = facts.latestDrinkMinute?.let(day::minuteOfClock)
        val shown = facts.lastShown?.takeIf(day::holds)?.let(day::minuteOf)
        val later = facts.lastLater?.takeIf(day::holds)?.let(day::minuteOf)

        val snooze = facts.snooze?.takeIf(day::holds)?.let(day::minuteOf)
        if (snooze != null && later != null && laterIsLatest(later, from, drink, shown) && snooze > nowMinute && snooze <= until) {
            return day.at(snooze)
        }

        val count = listOfNotNull(from, drink, shown, later).max()
        val interval = settings.intervalMinutes
        // The smallest n of 1, 2, 3 ... for which the count + n intervals is later than now.
        val steps = if (count + interval > nowMinute) 1 else (nowMinute - count) / interval + 1
        val next = count + steps * interval
        return if (next <= until) day.at(next) else tomorrow
    }

    /**
     * The snooze that Later sets when it is pressed at [pressedAt]: 15
     * minutes of real time later, or null if that is after "Until" or on
     * another day. Then Later sets no snooze, and no more reminder comes
     * today.
     */
    fun snoozeAfter(pressedAt: ZonedDateTime, settings: WaterSettings): ZonedDateTime? {
        val day = Day(pressedAt.toLocalDate(), pressedAt.zone)
        val minute = day.minuteOf(pressedAt) + SNOOZE_MINUTES
        return if (minute <= day.minuteOfClock(settings.untilMinute)) day.at(minute) else null
    }

    /**
     * True while the press of Later at [later] is still the latest of the
     * four. A drink at the same minute or after ends the snooze: the drink is
     * then the latest. A reminder shown at the same minute does not: Later
     * was pressed on it.
     */
    private fun laterIsLatest(later: Int, from: Int, drink: Int?, shown: Int?): Boolean =
        later >= from && (shown == null || later >= shown) && (drink == null || later > drink)

    /** The first reminder of [day]: "From" + 1 interval. */
    private fun firstOf(day: Day, settings: WaterSettings): ZonedDateTime =
        day.at(day.minuteOfClock(settings.fromMinute) + settings.intervalMinutes)

    /**
     * One local day in [zone], counted in whole minutes of real time from
     * its start. On most days a minute of it is the clock's minute.
     */
    private class Day(val date: LocalDate, val zone: ZoneId) {
        private val start: ZonedDateTime = date.atStartOfDay(zone)

        /** True if [time] lies on this day in [zone]. */
        fun holds(time: ZonedDateTime): Boolean = time.withZoneSameInstant(zone).toLocalDate() == date

        /** The whole minutes of real time from the start of the day to [time]. */
        fun minuteOf(time: ZonedDateTime): Int = Math.toIntExact(Duration.between(start, time).toMinutes())

        /** The real minute of the clock time [clockMinute] of this day: the first of two, or moved forward over a gap. */
        fun minuteOfClock(clockMinute: Int): Int = minuteOf(date.atStartOfDay().plusMinutes(clockMinute.toLong()).atZone(zone))

        /** The moment [minute] real minutes after the start of the day. */
        fun at(minute: Int): ZonedDateTime = start.plusMinutes(minute.toLong())
    }
}
