package app.shkriuss.core.notify

/**
 * One button on a notification, such as Water's **Drank 250 ml** or
 * **Later** (ADR 0034).
 *
 * [label] is what the button says. It is fixed when the notification is
 * shown, and it goes to Android to be shown and nowhere else. [action]
 * names what the button does inside the app, such as `drank`: a fixed
 * name, never user content. [value] is a fixed number the press carries
 * back, such as an amount in millilitres, so that the button does what its
 * label says even if the app's settings change while it is shown.
 */
class ShkNotificationButton(
    val label: String,
    val action: String,
    val value: Long = 0,
) {
    init {
        require(action.length in 1..MAX_ACTION_LENGTH && action.all(::isAllowed)) {
            "A button's action has 1 to $MAX_ACTION_LENGTH characters: letters, digits, '.', '_' and '-'"
        }
    }

    private companion object {
        const val MAX_ACTION_LENGTH = 32

        fun isAllowed(char: Char): Boolean =
            char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '.' || char == '_' || char == '-'
    }
}

/**
 * A press of a button, as the app's [ButtonHandler] gets it. It carries
 * only what the notification was shown with: its [key], the [action] of
 * the button, the notification's time [atMillis], usually the time of the
 * reminder, and the button's fixed [value]. Never text.
 */
data class ButtonPress(
    val key: String,
    val action: String,
    val atMillis: Long,
    val value: Long,
)

/**
 * What an app does when the user presses a button on one of its
 * notifications (ADR 0034). Android has already asked for the phone's
 * unlock: without it, the press never comes.
 */
fun interface ButtonHandler {
    /**
     * [press] came. It runs on the worker thread of `Notify`, after any
     * alarm handler that is running, and has a few seconds.
     *
     * - A button works once, and only while its notification is the one
     *   the app shows for that reminder. A press on an older one only
     *   removes it. The app decides this from [ButtonPress.atMillis].
     * - Android does not remove a notification when one of its buttons is
     *   pressed. The app removes it with [notifications], and then calls
     *   `Notify.sync()` if the press changed an alarm.
     */
    fun onButton(press: ButtonPress, notifications: Notifications)
}
