package app.shkriuss.core.notify

/**
 * The name of one alarm inside an app: the `id` of the record it belongs
 * to, or a fixed name the app picks, such as `next-drink`. It goes to
 * Android and into a small file, so it is never user content.
 */
@JvmInline
value class AlarmId(val value: String) {
    init {
        require(value.length in 1..MAX_LENGTH && value.all(::isAllowed)) {
            "An alarm id has 1 to $MAX_LENGTH characters: letters, digits, '.', '_' and '-'"
        }
    }

    private companion object {
        const val MAX_LENGTH = 64

        fun isAllowed(char: Char): Boolean =
            char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '.' || char == '_' || char == '-'
    }
}

/**
 * One exact alarm: wake the app at [atMillis], also when the device
 * sleeps. [atMillis] is in milliseconds since 1970-01-01T00:00:00Z, like
 * every timestamp of a record. It holds nothing to show: when the alarm
 * fires, the app reads what to show from its own database.
 */
data class Alarm(val id: AlarmId, val atMillis: Long)

/**
 * The alarms an app wants, read from its own records. `core/notify`
 * stores no reminder. It asks this every time it registers alarms: when
 * the app starts, when the app says something changed, after an alarm
 * fired, and after a reboot, an app update and a change of the time or
 * the time zone.
 */
fun interface AlarmSource {
    /**
     * Every alarm that should fire from now on, each id once. Called on a
     * background thread, so it may read the database.
     *
     * - Work out each time from the record and the time zone of this
     *   moment. A reminder "every day at 09:00" then follows a new time
     *   zone by itself.
     * - A time in the past is allowed. That alarm fires at once. It is how
     *   a reminder that was missed while the device was off shows up late.
     * - After [AlarmHandler.onAlarm] ran for an alarm, return its next
     *   time, or leave it out.
     */
    fun alarms(): List<Alarm>
}

/**
 * What an app does when one of its alarms fires. Usually it reads the
 * record and shows a notification.
 */
fun interface AlarmHandler {
    /**
     * [alarm] is due. It is called once for each id and time, on a
     * background thread, and has a few seconds. Show notifications with
     * [notifications].
     *
     * If the app stops in the middle, it is called again for the same
     * alarm later. So doing it twice must give the same result as doing
     * it once.
     */
    fun onAlarm(alarm: Alarm, notifications: Notifications)
}
