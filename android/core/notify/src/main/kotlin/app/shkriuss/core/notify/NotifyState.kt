package app.shkriuss.core.notify

/**
 * Whether a notification of one channel would reach the user right now,
 * and if not, what the user can do about it. A screen asks for it every
 * time it comes to the front, because the user can change the answer in
 * Android's settings at any moment.
 *
 * Alarms fire in every state. In every state but [Ready], Android drops
 * the notification, so the reminder is silent. The screen must say so.
 */
enum class NotifyState {
    /** Notifications of this channel are shown. */
    Ready,

    /**
     * The user was never asked. The screen explains what the reminders
     * are for and then shows Android's own question for the permission
     * [Notify.PERMISSION]. When the answer is in, it calls
     * [Notify.permissionAnswered].
     */
    NotAsked,

    /**
     * The user said no, or turned the app's notifications off. The app
     * does not ask again. The screen says that reminders will not appear
     * and offers [Notify.settingsIntent], where the user can allow them.
     */
    Denied,

    /**
     * Notifications are allowed, but the user turned this channel off.
     * The screen says so and offers [Notify.settingsIntent], which opens
     * the channel.
     */
    ChannelOff,
}
