package app.shkriuss.core.notify

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.Intent
import app.shkriuss.core.data.Clock
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowAlarmManager

/**
 * The app class of the unit tests. It is a [NotifyHost], as the app class
 * of every app that uses `core/notify` is. A test puts its [Notify] in.
 */
class TestApp : Application(), NotifyHost {
    override lateinit var notify: Notify
}

/**
 * Stands in for Android's `AlarmManager` where a test is about which
 * alarms are registered and when they fire, not about Android's own
 * calls. Like Android, it keeps one alarm for each id, forgets an alarm
 * when it fires, and forgets all of them at a reboot.
 */
class FakeAlarmScheduler : AlarmScheduler {
    /** The alarms that wait, id to time. */
    val waiting = mutableMapOf<AlarmId, Long>()

    /** Every call, in order, as `set <id> <time>` or `cancel <id>`. */
    val calls = mutableListOf<String>()

    override fun set(alarm: Alarm) {
        calls += "set ${alarm.id.value} ${alarm.atMillis}"
        waiting[alarm.id] = alarm.atMillis
    }

    override fun cancel(id: AlarmId) {
        calls += "cancel ${id.value}"
        waiting.remove(id)
    }

    /**
     * What Android does as time passes: every alarm whose time has come
     * on [clock] leaves the list and is delivered to [deliver], soonest
     * first. An alarm that is set during a delivery and is due fires in
     * the same call, as it would on a device.
     */
    fun fireDue(clock: Clock, deliver: (AlarmId) -> Unit) {
        while (true) {
            val due = waiting.filterValues { it <= clock.nowMillis() }.minByOrNull { it.value } ?: return
            waiting.remove(due.key)
            deliver(due.key)
        }
    }

    /** A reboot, an app update or a "Force stop": Android drops every alarm of the app. */
    fun forgetEverything() = waiting.clear()
}

/** A reminder of the test app: at one moment, or every day at a time on the wall clock. */
sealed interface TestReminder {
    val id: AlarmId

    data class Once(override val id: AlarmId, val atMillis: Long) : TestReminder

    data class Daily(override val id: AlarmId, val at: LocalTime) : TestReminder
}

/**
 * The records of a small app with reminders, as an [AlarmSource] and an
 * [AlarmHandler]. It works the way the docs tell an app to: a daily
 * reminder gets its time from the time zone of the moment, and a
 * reminder that was handled gets its next time or is left out.
 */
class TestReminders(private val clock: Clock, var zone: ZoneId = ZoneId.of("UTC")) : AlarmSource, AlarmHandler {
    val reminders = mutableListOf<TestReminder>()

    /** Every alarm the handler got, in order. */
    val handled = mutableListOf<Alarm>()

    /** For each daily reminder, the moment it was last handled. */
    private val lastHandled = mutableMapOf<AlarmId, Long>()
    private val done = mutableSetOf<AlarmId>()

    /** How often the app was asked for its alarms. */
    var asked = 0

    /** If set, a reminder that fired once is still named with its old time, as a careless app would. */
    var keepsNamingDoneReminders = false

    /** If set, the handler fails with this. */
    var failure: RuntimeException? = null

    override fun alarms(): List<Alarm> {
        asked++
        return reminders.mapNotNull { reminder ->
            when (reminder) {
                is TestReminder.Once ->
                    if (reminder.id in done && !keepsNamingDoneReminders) null else Alarm(reminder.id, reminder.atMillis)
                is TestReminder.Daily -> Alarm(reminder.id, nextTimeOf(reminder))
            }
        }
    }

    override fun onAlarm(alarm: Alarm, notifications: Notifications) {
        handled += alarm
        failure?.let { throw it }
        done += alarm.id
        lastHandled[alarm.id] = clock.nowMillis()
    }

    /** The first moment with this wall-clock time that is after the last one handled, or after the start of today. */
    private fun nextTimeOf(reminder: TestReminder.Daily): Long {
        val now = Instant.ofEpochMilli(clock.nowMillis()).atZone(zone)
        val after = lastHandled[reminder.id]?.let { Instant.ofEpochMilli(it).atZone(zone) } ?: now.toLocalDate().atStartOfDay(zone)
        var next: ZonedDateTime = after.toLocalDate().atTime(reminder.at).atZone(zone)
        while (!next.isAfter(after)) next = next.plusDays(1)
        return next.toInstant().toEpochMilli()
    }
}

/**
 * The broadcast that Robolectric's `AlarmManager` sends for this alarm.
 * Robolectric offers it only as a field it marks as deprecated, with
 * nothing in its place.
 */
@Suppress("DEPRECATION")
fun ShadowAlarmManager.ScheduledAlarm.broadcast(): Intent = shadowOf(operation).savedIntent

/** The alarms that wait at Robolectric's `AlarmManager`, id to time. */
fun ShadowAlarmManager.waiting(): Map<String?, Long> = scheduledAlarms.associate { it.broadcast().identifier to it.triggerAtMs }

/** A reboot, an app update or a "Force stop": Android drops every alarm of the app. */
@Suppress("DEPRECATION")
fun AlarmManager.forgetEverything() = shadowOf(this).scheduledAlarms.forEach { cancel(checkNotNull(it.operation)) }

/** The private file `core/notify` keeps its state in. */
fun Context.notifyStore() = getSharedPreferences("app.shkriuss.core.notify", Context.MODE_PRIVATE)

const val MINUTE = 60_000L
const val HOUR = 60 * MINUTE
const val DAY = 24 * HOUR
