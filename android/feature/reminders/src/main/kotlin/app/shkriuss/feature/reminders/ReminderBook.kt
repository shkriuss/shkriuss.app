package app.shkriuss.feature.reminders

import android.content.Context
import android.content.SharedPreferences
import java.time.DateTimeException
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What Reminders remembers of one reminder on this phone
 * (docs/apps/reminders/spec.md, "On this phone only"). Each is null until
 * it is first written.
 */
data class ReminderEntry(
    /** The mark: the latest occurrence that is dealt with, as a local date and minute. */
    val mark: LocalDateTime? = null,
    /** The end of the reminder's snooze, in milliseconds since 1970 UTC. */
    val snoozeMillis: Long? = null,
    /** The time of the reminder's notification on screen, in milliseconds since 1970 UTC. Its buttons work only while it is this one. */
    val showingMillis: Long? = null,
) {
    /** True if nothing is remembered: the entry has no line in the file. */
    val isEmpty: Boolean
        get() = mark == null && snoozeMillis == null && showingMillis == null
}

/**
 * The entries of Reminders, by reminder `id`, in one small file of
 * Android's preferences in Reminders' private storage,
 * `app.shkriuss.reminders`. It belongs to this phone and is not the user's
 * data: it is no record, it is not in a backup and it will not be synced
 * (ADR 0036, point 3). It holds ids and times only, never a title.
 *
 * Each entry is up to three lines: `mark.<id>`, in minutes since
 * 1970-01-01 00:00 local time, and `snooze.<id>` and `showing.<id>`, in
 * milliseconds since 1970 UTC.
 *
 * Every change is written to disk before [update] returns. Any thread may
 * call it.
 */
class ReminderBook(private val preferences: SharedPreferences) {
    private val state = MutableStateFlow(read())

    /** What the book holds now, by reminder `id`. A reminder with no entry is not in it. */
    val entries: StateFlow<Map<String, ReminderEntry>> = state.asStateFlow()

    /** The entry of the reminder [id]: empty if there is none. */
    fun entryOf(id: String): ReminderEntry = state.value[id] ?: ReminderEntry()

    /**
     * Writes what [change] makes of the entry of each of [ids], in one
     * write. An entry that becomes empty is removed. Returns false if
     * the disk refused the write: the book then still holds the change
     * until the app stops, and a reminder with no entry counts from the
     * minute the app sees it again (spec, "The mark", point 2).
     */
    fun update(ids: Collection<String>, change: (id: String, entry: ReminderEntry) -> ReminderEntry): Boolean = synchronized(this) {
        val before = state.value
        val next = before.toMutableMap()
        ids.forEach { id ->
            val entry = change(id, before[id] ?: ReminderEntry())
            if (entry.isEmpty) next.remove(id) else next[id] = entry
        }
        if (next == before) return true
        val editor = preferences.edit()
        ids.forEach { id ->
            val entry = next[id] ?: ReminderEntry()
            put(editor, MARK + id, entry.mark?.let(::minutesOf))
            put(editor, SNOOZE + id, entry.snoozeMillis)
            put(editor, SHOWING + id, entry.showingMillis)
        }
        // Written at once, not later: the next sync and the next alarm read it.
        val written = editor.commit()
        state.value = next
        written
    }

    /** Writes what [change] makes of the entry of the reminder [id]. Returns false if the disk refused it. */
    fun update(id: String, change: (ReminderEntry) -> ReminderEntry): Boolean = update(listOf(id)) { _, entry -> change(entry) }

    /** Removes the entries of [ids]: their marks, snoozes and notifications on screen. Returns false if the disk refused it. */
    fun remove(ids: Collection<String>): Boolean = update(ids) { _, _ -> ReminderEntry() }

    /** Every entry in the file. A line that is not a time, or a mark no date can hold, is left out. */
    private fun read(): Map<String, ReminderEntry> {
        val entries = mutableMapOf<String, ReminderEntry>()
        fun add(id: String, change: (ReminderEntry) -> ReminderEntry) {
            entries[id] = change(entries[id] ?: ReminderEntry())
        }
        preferences.all.forEach { (key, value) ->
            if (value !is Long) return@forEach
            when {
                key.startsWith(MARK) -> localOf(value)?.let { mark -> add(key.removePrefix(MARK)) { it.copy(mark = mark) } }
                key.startsWith(SNOOZE) -> add(key.removePrefix(SNOOZE)) { it.copy(snoozeMillis = value) }
                key.startsWith(SHOWING) -> add(key.removePrefix(SHOWING)) { it.copy(showingMillis = value) }
            }
        }
        return entries
    }

    private fun put(editor: SharedPreferences.Editor, key: String, value: Long?) {
        if (value == null) editor.remove(key) else editor.putLong(key, value)
    }

    companion object {
        /** The name of the file, in Reminders' private storage (spec, "On this phone only"). */
        const val FILE: String = "app.shkriuss.reminders"

        private const val MARK = "mark."
        private const val SNOOZE = "snooze."
        private const val SHOWING = "showing."
        private const val SECONDS_PER_MINUTE = 60L

        /** The book in its file of [context]'s app. */
        fun of(context: Context): ReminderBook = ReminderBook(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))

        /** A local date and minute as the file holds it: minutes since 1970-01-01 00:00. */
        internal fun minutesOf(local: LocalDateTime): Long = Math.floorDiv(local.toEpochSecond(ZoneOffset.UTC), SECONDS_PER_MINUTE)

        /** The local date and minute of [minutes] in the file, or null for a value no date can hold. */
        internal fun localOf(minutes: Long): LocalDateTime? = try {
            LocalDateTime.ofEpochSecond(Math.multiplyExact(minutes, SECONDS_PER_MINUTE), 0, ZoneOffset.UTC)
        } catch (_: ArithmeticException) {
            null
        } catch (_: DateTimeException) {
            null
        }
    }
}
