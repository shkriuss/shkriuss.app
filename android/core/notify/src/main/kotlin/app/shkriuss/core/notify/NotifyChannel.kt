package app.shkriuss.core.notify

import android.app.NotificationManager

/**
 * One notification channel of an app: a kind of notification that the
 * user can turn off or make quiet in Android's settings, apart from the
 * app's other kinds.
 *
 * [id] is fixed for ever: Android keeps the user's choices under it.
 * [name] and [description] are string resources of the app, shown in
 * Android's settings. [importance] is only the start value. After the
 * channel exists, only the user can change it.
 */
class NotifyChannel(
    val id: String,
    val name: Int,
    val description: Int,
    val importance: ChannelImportance,
) {
    init {
        require(id.isNotBlank()) { "A channel needs an id" }
    }
}

/** How much a channel's notifications interrupt, until the user changes it. */
enum class ChannelImportance(internal val level: Int) {
    /** In the notification list, with no sound. */
    Quiet(NotificationManager.IMPORTANCE_LOW),

    /** With sound. */
    Normal(NotificationManager.IMPORTANCE_DEFAULT),

    /** With sound, and shown over the screen for a moment. For reminders. */
    Urgent(NotificationManager.IMPORTANCE_HIGH),
}
