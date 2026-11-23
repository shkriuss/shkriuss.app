package app.shkriuss.feature.tasks

import android.content.Context
import android.content.SharedPreferences
import app.shkriuss.core.data.RecordTimes
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What Tasks remembers of one task on this phone
 * (docs/apps/tasks/spec.md, "On this phone only"), and the reminder
 * number it was written for. Each is null until it is first written.
 */
data class TaskEntry(
    /** The reminder number the other three were written for (`for.<id>`). They count only while it is the task's number now. */
    val number: Long? = null,
    /** The mark: the latest reminder moment that is dealt with, as a local date and minute. */
    val mark: LocalDateTime? = null,
    /** The end of the task's snooze, in milliseconds since 1970 UTC. */
    val snoozeMillis: Long? = null,
    /** The time of the task's notification on screen, in milliseconds since 1970 UTC. Its buttons work only while it is this one. */
    val showingMillis: Long? = null,
) {
    init {
        require(number != null || (mark == null && snoozeMillis == null && showingMillis == null)) {
            "Every write of a mark, a snooze or a showing time writes the reminder number too"
        }
    }

    /** True if nothing is remembered: the entry has no line in the file. */
    val isEmpty: Boolean
        get() = number == null && mark == null && snoozeMillis == null && showingMillis == null

    /** A new entry for the reminder number [number]: a mark, no snooze and nothing on screen. */
    companion object {
        /** The entry of a task that counts from [mark]: no snooze and nothing on screen, for [number]. */
        fun countingFrom(number: Long, mark: LocalDateTime): TaskEntry = TaskEntry(number = number, mark = mark)
    }
}

/**
 * The entries of Tasks, by task `id`, in one small file of Android's
 * preferences in Tasks' private storage, `app.shkriuss.tasks`. It belongs
 * to this phone and is not the user's data: it is no record, it is not in
 * a backup and it will not be synced. It holds ids, times and numbers
 * only, never a title.
 *
 * Each entry is up to four lines: `mark.<id>`, in minutes since
 * 1970-01-01 00:00 local time, `snooze.<id>` and `showing.<id>`, in
 * milliseconds since 1970 UTC, and `for.<id>`, the reminder number they
 * were written for. A value that cannot be read, or is outside its
 * limits, counts as missing. The first three count only while `for.<id>`
 * is the task's reminder number now ([entryOf]); otherwise all three
 * count as missing. Every write of them writes `for.<id>` too.
 *
 * Every change is written to disk before [update] returns. Any thread may
 * call it.
 *
 * If the disk refuses a write, the book still holds the change, so this
 * run of the app goes on as it should, and the next write writes the
 * whole file again, so that the file catches up with the book, as
 * Reminders' book does. Should the app stop before that, a task counts
 * from what the file last held, and entries written for an old reminder
 * number count as missing (spec, "A write fails").
 */
class TaskBook(private val preferences: SharedPreferences) {
    private val state = MutableStateFlow(read())

    /** True after the disk refused a write: the file is behind the book. */
    private var behind = false

    /** What the book holds now, by task `id`, as written: also entries for an old reminder number. */
    val entries: StateFlow<Map<String, TaskEntry>> = state.asStateFlow()

    /** The entry of the task [id] as written: empty if there is none. */
    fun storedOf(id: String): TaskEntry = state.value[id] ?: TaskEntry()

    /**
     * The entry of the task [id] that counts while its reminder number is
     * [number]: empty if [number] is null or the entry was written for
     * another one.
     */
    fun entryOf(id: String, number: Long?): TaskEntry = countingEntry(state.value[id], number)

    /**
     * Writes what [change] makes of the entry of each of [ids], in one
     * write. [change] gets the entry as written. An entry that becomes
     * empty is removed. Returns false if the disk refused the write. The
     * book holds the change all the same.
     */
    fun update(ids: Collection<String>, change: (id: String, entry: TaskEntry) -> TaskEntry): Boolean = synchronized(this) {
        val before = state.value
        val next = before.toMutableMap()
        ids.forEach { id ->
            val entry = change(id, before[id] ?: TaskEntry())
            if (entry.isEmpty) next.remove(id) else next[id] = entry
        }
        if (next == before && !behind) return true
        val editor = preferences.edit()
        // After a refused write, the whole file again: every entry, and no line of one that is gone.
        if (behind) editor.clear()
        (if (behind) next.keys else ids).forEach { id ->
            val entry = next[id] ?: TaskEntry()
            put(editor, FOR + id, entry.number)
            put(editor, MARK + id, entry.mark?.let(::minutesOf))
            put(editor, SNOOZE + id, entry.snoozeMillis)
            put(editor, SHOWING + id, entry.showingMillis)
        }
        // Written at once, not later: the next sync and the next alarm read it.
        val written = editor.commit()
        behind = !written
        state.value = next
        written
    }

    /** Removes the entries of [ids]: their numbers, marks, snoozes and notifications on screen. Returns false if the disk refused it. */
    fun remove(ids: Collection<String>): Boolean = update(ids) { _, _ -> TaskEntry() }

    /** Every entry in the file. A line that is not a whole number, or is outside its limits, is left out. */
    private fun read(): Map<String, TaskEntry> {
        val entries = mutableMapOf<String, TaskEntry>()
        val numbers = mutableMapOf<String, Long>()
        val marks = mutableMapOf<String, LocalDateTime>()
        val snoozes = mutableMapOf<String, Long>()
        val showings = mutableMapOf<String, Long>()
        preferences.all.forEach { (key, value) ->
            if (value !is Long) return@forEach
            when {
                key.startsWith(FOR) -> if (value in 0..TaskReminders.MOST_NUMBER) numbers[key.removePrefix(FOR)] = value
                key.startsWith(MARK) -> if (value in 0..MOST_MARK_MINUTES) marks[key.removePrefix(MARK)] = localOf(value)
                key.startsWith(SNOOZE) -> if (RecordTimes.allows(value)) snoozes[key.removePrefix(SNOOZE)] = value
                key.startsWith(SHOWING) -> if (RecordTimes.allows(value)) showings[key.removePrefix(SHOWING)] = value
            }
        }
        // Without a number that can be read, the other three count for nothing.
        numbers.forEach { (id, number) -> entries[id] = TaskEntry(number, marks[id], snoozes[id], showings[id]) }
        return entries
    }

    private fun put(editor: SharedPreferences.Editor, key: String, value: Long?) {
        if (value == null) editor.remove(key) else editor.putLong(key, value)
    }

    companion object {
        /** The name of the file, in Tasks' private storage (spec, "On this phone only"). */
        const val FILE: String = "app.shkriuss.tasks"

        /** The last mark the file can hold: 9999-12-31 23:59, in minutes since 1970-01-01 00:00. */
        const val MOST_MARK_MINUTES: Long = 4_223_371_679L

        private const val FOR = "for."
        private const val MARK = "mark."
        private const val SNOOZE = "snooze."
        private const val SHOWING = "showing."
        private const val SECONDS_PER_MINUTE = 60L

        /** The book in its file of [context]'s app. */
        fun of(context: Context): TaskBook = TaskBook(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))

        /** The entry of [stored] that counts while the task's reminder number is [number]. */
        internal fun countingEntry(stored: TaskEntry?, number: Long?): TaskEntry =
            if (stored != null && number != null && stored.number == number) stored else TaskEntry()

        /** A local date and minute as the file holds it: minutes since 1970-01-01 00:00. */
        internal fun minutesOf(local: LocalDateTime): Long = Math.floorDiv(local.toEpochSecond(ZoneOffset.UTC), SECONDS_PER_MINUTE)

        /** The local date and minute of [minutes] in the file, from 0 to [MOST_MARK_MINUTES]. */
        internal fun localOf(minutes: Long): LocalDateTime = LocalDateTime.ofEpochSecond(minutes * SECONDS_PER_MINUTE, 0, ZoneOffset.UTC)
    }
}
