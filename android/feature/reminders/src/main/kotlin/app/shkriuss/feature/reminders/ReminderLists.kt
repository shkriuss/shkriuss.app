package app.shkriuss.feature.reminders

import java.time.LocalDateTime

/** One reminder, as the screens show it. */
data class Reminder(
    /** The record's ID. */
    val id: String,
    /** The title. */
    val title: String,
    /** When it shows. */
    val schedule: Schedule,
    /** When it was created, in milliseconds since 1970 UTC. Of two at the same moment, the one created first comes first. */
    val createdAt: Long,
)

/** When an upcoming reminder shows next, as its row says it (docs/apps/reminders/spec.md, "Upcoming", point 3). */
sealed interface NextShow {
    /** Due and not shown yet: "Now". */
    data object Now : NextShow

    /** A snooze ends before the next occurrence: "Snoozed until 09:12". [until] is local. */
    data class SnoozedUntil(val until: LocalDateTime) : NextShow

    /** It shows at [time], local, as "Today, 09:00 · Every day". */
    data class At(val time: LocalDateTime) : NextShow
}

/** One row of Upcoming. */
data class UpcomingRow(
    /** The reminder. */
    val reminder: Reminder,
    /** When it shows next. */
    val next: NextShow,
    /** The moment of its alarm, in milliseconds since 1970 UTC. The rows are in this order. */
    val atMillis: Long,
)

/** One row of Past: a one-time reminder that is not upcoming. */
data class PastRow(
    /** The reminder. */
    val reminder: Reminder,
) {
    /** Its date and time, as the row shows them: "Mon 16 Nov, 14:00". */
    val time: LocalDateTime
        get() = reminder.schedule.date.atTime(reminder.schedule.time)
}

/** The two lists, Upcoming and Past. Each reminder is in one of them. */
data class ReminderLists(
    /** Soonest first. At the same moment, the one created first. */
    val upcoming: List<UpcomingRow>,
    /** Newest first. At the same time, the one created last. */
    val past: List<PastRow>,
) {
    /** How the lists are made. */
    companion object {
        /**
         * The lists of [reminders] with the phone-only [entries], now
         * (spec, "Words used on this page"). A reminder is upcoming while
         * the rule gives it an alarm: an occurrence after its mark, or a
         * snooze. Every other one is past: in practice a one-time reminder
         * that showed, since a repeat has no end.
         */
        fun of(reminders: List<Reminder>, entries: Map<String, ReminderEntry>, now: ClockReading): ReminderLists {
            val upcoming = mutableListOf<UpcomingRow>()
            val past = mutableListOf<PastRow>()
            reminders.forEach { reminder ->
                val alarm = alarmOf(reminder, entries[reminder.id], now)
                if (alarm == null) past += PastRow(reminder) else upcoming += UpcomingRow(reminder, nextShowOf(alarm, now), alarm.atMillis)
            }
            return ReminderLists(
                upcoming = upcoming.sortedWith(compareBy({ it.atMillis }, { it.reminder.createdAt }, { it.reminder.id })),
                past = past.sortedWith(
                    compareByDescending<PastRow> { it.time }.thenByDescending { it.reminder.createdAt }.thenByDescending { it.reminder.id },
                ),
            )
        }

        /** The alarm the rule gives [reminder] now, with its [entry] of this phone, or null for none. */
        fun alarmOf(reminder: Reminder, entry: ReminderEntry?, now: ClockReading): ReminderAlarm? =
            ReminderRule.alarmOf(reminder.schedule, ReminderRule.markNow(entry?.mark, now), entry?.snoozeMillis, now)

        /**
         * What a row says of [alarm]. An alarm whose moment has come is
         * "Now", a snooze too: it shows within seconds. Times are those the
         * phone's clock shows at the alarm's moment.
         */
        private fun nextShowOf(alarm: ReminderAlarm, now: ClockReading): NextShow = when {
            alarm.atMillis <= now.millis -> NextShow.Now
            alarm is ReminderAlarm.Snooze -> NextShow.SnoozedUntil(now.local(alarm.atMillis))
            else -> NextShow.At(now.local(alarm.atMillis))
        }
    }
}
