package app.shkriuss.core.notify

import android.content.SharedPreferences

/**
 * What `core/notify` knows about the alarms of the app: which ones it
 * registered with Android, and which ones already fired.
 *
 * - [registered]: id to time, for every alarm that waits at Android.
 *   Android cannot list an app's alarms, so this is how an alarm that is
 *   no longer wanted is found and removed.
 * - [fired]: id to time, for every alarm that fired and that the app
 *   still names with the same time. It is how an alarm fires once for
 *   each id and time.
 */
internal data class AlarmState(
    val registered: Map<AlarmId, Long> = emptyMap(),
    val fired: Map<AlarmId, Long> = emptyMap(),
)

/**
 * Keeps [AlarmState] in the app's private storage. It holds ids and
 * times, never a title or other user content. Like the database, the file
 * can be read only after the first unlock (ADR 0010).
 */
internal class AlarmRegistry(private val preferences: SharedPreferences) {
    fun read(): AlarmState = AlarmState(registered = read(REGISTERED), fired = read(FIRED))

    /** Replaces the stored state with [state], in one write that is on disk when this returns. */
    fun write(state: AlarmState) {
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(REGISTERED) || it.startsWith(FIRED) }.forEach(editor::remove)
        state.registered.forEach { (id, at) -> editor.putLong(REGISTERED + id.value, at) }
        state.fired.forEach { (id, at) -> editor.putLong(FIRED + id.value, at) }
        check(editor.commit()) { "The alarm registry could not be written" }
    }

    private fun read(prefix: String): Map<AlarmId, Long> = preferences.all
        .filterKeys { it.startsWith(prefix) }
        .map { (key, value) -> AlarmId(key.removePrefix(prefix)) to value as Long }
        .toMap()

    private companion object {
        const val REGISTERED = "registered:"
        const val FIRED = "fired:"
    }
}
