package app.shkriuss.feature.reminders

import java.time.LocalDateTime

/**
 * Where the one alarm of a reminder is, and why (docs/apps/reminders/spec.md,
 * "The rule"). [atMillis] is its moment, in milliseconds since 1970 UTC.
 */
sealed interface ReminderAlarm {
    /** The moment of the alarm. */
    val atMillis: Long

    /** Rule 1: pending occurrences are due. [occurrence] is the latest of them. Its moment has passed, so it shows late. */
    data class Due(val occurrence: LocalDateTime, override val atMillis: Long) : ReminderAlarm

    /** Rule 2: the end of a snooze, which is earlier than the first pending occurrence. It counts also when it has passed. */
    data class Snooze(override val atMillis: Long) : ReminderAlarm

    /** Rule 3: the first pending [occurrence]. */
    data class Next(val occurrence: LocalDateTime, override val atMillis: Long) : ReminderAlarm
}

/**
 * The rule of docs/apps/reminders/spec.md, "The rule", and the mark of
 * "The mark", as plain code. Each reminder has at most one alarm. Pending
 * occurrences are those later than the mark. In order:
 *
 * 1. If pending occurrences are due, the alarm is at the moment of the
 *    latest. The older ones are skipped.
 * 2. Otherwise, if a snooze is set, the alarm is at its end or at the
 *    first pending occurrence, whichever is earlier.
 * 3. Otherwise, at the first pending occurrence.
 * 4. A one-time reminder with neither has no alarm. It is past.
 *
 * An occurrence is due when its moment is at or before now. Occurrences
 * and the mark are local times; their moments are found in the time zone
 * of [ClockReading], so a reminder follows a new time zone and summer
 * time by itself.
 */
object ReminderRule {
    /**
     * The mark the rule uses now. **The mark never stays later than now**
     * (spec, "The mark", point 3): a mark whose moment is later than now,
     * because the clock was set back or the phone moved to a zone further
     * west, counts as the current minute. So does no mark at all (point 2).
     * The moment of a mark is found as for an occurrence: of a time that
     * happens twice it is the first, so in the hour that happens twice
     * the mark stays.
     */
    fun markNow(stored: LocalDateTime?, now: ClockReading): LocalDateTime =
        if (stored == null || now.millisOf(stored) > now.millis) now.currentMinute else stored

    /** The alarm of [schedule] with the mark [mark] and the snooze [snoozeMillis], now, or null for none. */
    fun alarmOf(schedule: Schedule, mark: LocalDateTime, snoozeMillis: Long?, now: ClockReading): ReminderAlarm? {
        latestDue(schedule, mark, now)?.let { return ReminderAlarm.Due(it, now.millisOf(it)) }
        val next = Occurrences.firstAfter(schedule, mark)?.let { ReminderAlarm.Next(it, now.millisOf(it)) }
        if (snoozeMillis != null && (next == null || snoozeMillis <= next.atMillis)) return ReminderAlarm.Snooze(snoozeMillis)
        return next
    }

    /**
     * The latest pending occurrence whose moment is at or before now, or
     * null. No occurrence a day or more after now on the phone's clock can
     * be due: no change of a zone's offset is that large. From there it
     * steps back one occurrence at a time while the moment is still to
     * come, which takes one or two steps, and it stops at the mark.
     */
    private fun latestDue(schedule: Schedule, mark: LocalDateTime, now: ClockReading): LocalDateTime? {
        var candidate = Occurrences.latestAtOrBefore(schedule, now.local.plusDays(1))
        while (candidate != null && candidate > mark && now.millisOf(candidate) > now.millis) {
            candidate = Occurrences.latestAtOrBefore(schedule, candidate.minusMinutes(1))
        }
        return candidate?.takeIf { it > mark }
    }
}
