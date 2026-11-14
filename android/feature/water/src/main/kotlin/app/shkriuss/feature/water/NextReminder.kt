package app.shkriuss.feature.water

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/**
 * What the rule of the next reminder needs to know about one day: today's
 * drinks, and the bookkeeping of reminders that stays on this phone
 * (docs/apps/water/spec.md, "On this phone only"). Times are the phone's
 * local time.
 */
data class ReminderFacts(
    /** The day these facts are about. The rule takes them only for the day of its `now`. */
    val day: LocalDate,
    /** The latest time among the day's drinks that are not deleted, in minutes after midnight, or null. */
    val latestDrinkMinute: Int?,
    /** True once the day's total reaches its goal. */
    val goalMet: Boolean,
    /** When the last reminder was shown, or null. It counts only if it was on [day]. */
    val lastShown: LocalDateTime? = null,
    /** When Later was last pressed, or null. It counts only if it was on [day]. */
    val lastLater: LocalDateTime? = null,
    /** The time of the snooze that Later set, or null. */
    val snooze: LocalDateTime? = null,
)

/**
 * The rule of the next reminder, as plain code
 * (docs/apps/water/spec.md, "When the next reminder comes"). Water keeps
 * one alarm at a time. Step 2.4 names it in its `AlarmSource` at the time
 * this gives, and calls the rule again after every change.
 *
 * 1. **The count** starts at the latest of these four, all of today:
 *    "From", the time of the latest drink, the time the last reminder was
 *    shown, and the time Later was last pressed.
 * 2. **The next reminder** is the first of "the count + 1 interval", "the
 *    count + 2 intervals", and so on, that is later than now.
 * 3. **A snooze comes first, while Later is the latest.** A snooze holds
 *    only while the press of Later is still the latest of the four. A
 *    drink timed at or after the press ends it. A drink entered with an
 *    earlier time does not (the owner's decision in step 2.2).
 * 4. **Only inside the reminder hours, and only until the goal is met.**
 *    Otherwise the next one is tomorrow at "From" + 1 interval.
 * 5. Reminders off: no alarm.
 * 6. If "From" + 1 interval is after "Until", no reminder fits on any day:
 *    no alarm.
 *
 * Times count in whole minutes. A press of Later at 12:22:40 counts as
 * 12:22, and its snooze is at 12:37.
 */
object NextReminder {
    /** How long Later waits. It cannot be changed. */
    const val SNOOZE_MINUTES: Int = 15

    /**
     * The time of the next reminder after [now], or null for no alarm.
     * [facts] must be about the day of [now].
     */
    fun after(now: LocalDateTime, settings: WaterSettings, facts: ReminderFacts): LocalDateTime? {
        require(facts.day == now.toLocalDate()) { "The facts are about another day" }
        if (!settings.remindersOn || !settings.reminderFits) return null
        val today = facts.day
        val tomorrow = firstOf(today.plusDays(1), settings)
        if (facts.goalMet) return tomorrow

        val nowMinute = minuteOf(now)
        val drink = facts.latestDrinkMinute
        val shown = facts.lastShown?.takeIf { it.toLocalDate() == today }?.let(::minuteOf)
        val later = facts.lastLater?.takeIf { it.toLocalDate() == today }?.let(::minuteOf)

        val snooze = facts.snooze?.takeIf { it.toLocalDate() == today }?.let(::minuteOf)
        if (snooze != null && later != null && laterIsLatest(later, settings.fromMinute, drink, shown) &&
            snooze > nowMinute && snooze <= settings.untilMinute
        ) {
            return today.atMinute(snooze)
        }

        val count = listOfNotNull(settings.fromMinute, drink, shown, later).max()
        val interval = settings.intervalMinutes
        // The smallest n of 1, 2, 3 ... for which the count + n intervals is later than now.
        val steps = if (count + interval > nowMinute) 1 else (nowMinute - count) / interval + 1
        val next = count + steps * interval
        return if (next <= settings.untilMinute) today.atMinute(next) else tomorrow
    }

    /**
     * The snooze that Later sets when it is pressed at [pressedAt]: 15
     * minutes later, or null if that is after "Until" or on another day.
     * Then Later sets no snooze, and no more reminder comes today.
     */
    fun snoozeAfter(pressedAt: LocalDateTime, settings: WaterSettings): LocalDateTime? {
        val minute = minuteOf(pressedAt) + SNOOZE_MINUTES
        return if (minute <= settings.untilMinute) pressedAt.toLocalDate().atMinute(minute) else null
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
    private fun firstOf(day: LocalDate, settings: WaterSettings): LocalDateTime =
        day.atMinute(settings.fromMinute + settings.intervalMinutes)

    private fun minuteOf(time: LocalDateTime): Int = time.hour * 60 + time.minute

    private fun LocalDate.atMinute(minute: Int): LocalDateTime = atStartOfDay().plus(minute.toLong(), ChronoUnit.MINUTES)
}
