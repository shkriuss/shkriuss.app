package app.shkriuss.feature.water

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the reminders of Water remember on this phone, as times in
 * milliseconds since 1970. Each is null until it first happens.
 * (docs/apps/water/spec.md, "On this phone only").
 */
data class ReminderEntries(
    /** When the last reminder was shown. */
    val lastShown: Long? = null,
    /** When Later was last pressed. */
    val lastLater: Long? = null,
    /** The time of the snooze that Later set. */
    val snooze: Long? = null,
    /** The time of the reminder that is showing now. Its buttons work only while it is this one. */
    val showing: Long? = null,
    /** The time of the alarm Water set last. */
    val named: Long? = null,
    /** The time of the last alarm that reached Water's handler. `WaterReminders` forgets one that lies later than now. */
    val lastAlarm: Long? = null,
) {
    /** The alarm Water set that has not reached its handler yet, or null (`NextReminder`, point 7). */
    val pending: Long?
        get() = named?.takeIf { lastAlarm == null || it > lastAlarm }
}

/**
 * The bookkeeping of Water's reminders, in one small file of Android's
 * preferences in Water's private storage. It belongs to this phone and is
 * not the user's data: it is no record, it is not in a backup and it will
 * not be synced (ADR 0036, point 3). It holds times only: no amount and no
 * text.
 *
 * Every change is written to disk before [update] returns. Any thread may
 * call it.
 */
class ReminderBook(private val preferences: SharedPreferences) {
    private val state = MutableStateFlow(read())

    /** What the book holds now. It changes with every [update]. */
    val entries: StateFlow<ReminderEntries> = state.asStateFlow()

    /** Writes what [change] makes of the entries, and returns it. */
    fun update(change: (ReminderEntries) -> ReminderEntries): ReminderEntries = synchronized(this) {
        val next = change(state.value)
        if (next != state.value) {
            // Written at once, not later: the next sync and the next alarm read it.
            preferences.edit(commit = true) {
                put(this, LAST_SHOWN, next.lastShown)
                put(this, LAST_LATER, next.lastLater)
                put(this, SNOOZE, next.snooze)
                put(this, SHOWING, next.showing)
                put(this, NAMED, next.named)
                put(this, LAST_ALARM, next.lastAlarm)
            }
            state.value = next
        }
        next
    }

    private fun read() = ReminderEntries(
        lastShown = get(LAST_SHOWN),
        lastLater = get(LAST_LATER),
        snooze = get(SNOOZE),
        showing = get(SHOWING),
        named = get(NAMED),
        lastAlarm = get(LAST_ALARM),
    )

    private fun get(key: String): Long? = if (preferences.contains(key)) preferences.getLong(key, 0L) else null

    private fun put(editor: SharedPreferences.Editor, key: String, value: Long?) {
        if (value == null) editor.remove(key) else editor.putLong(key, value)
    }

    companion object {
        /** The name of the file, in Water's private storage (spec, "On this phone only"). */
        const val FILE = "app.shkriuss.water"

        private const val LAST_SHOWN = "last-shown"
        private const val LAST_LATER = "last-later"
        private const val SNOOZE = "snooze"
        private const val SHOWING = "showing"
        private const val NAMED = "named"
        private const val LAST_ALARM = "last-alarm"

        /** The book in its file of [context]'s app. */
        fun of(context: Context): ReminderBook =
            ReminderBook(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))
    }
}
