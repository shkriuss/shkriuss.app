package app.shkriuss.core.security

import android.content.Context
import androidx.core.content.edit

/**
 * How long the app may be away from the screen before the app lock locks
 * it. The time is counted with a clock the user cannot change. The app
 * also locks when the phone's screen turns off with the app on it, and
 * after Android stopped it (docs/architecture/security-screens.md).
 */
enum class LockAfter(val millis: Long) {
    /** As soon as the app leaves the screen. The default. */
    LEAVING(0),

    /** One minute away. */
    ONE_MINUTE(60_000),

    /** Five minutes away. */
    FIVE_MINUTES(300_000),

    /** Fifteen minutes away. */
    FIFTEEN_MINUTES(900_000),

    /** One hour away. */
    ONE_HOUR(3_600_000),
}

/**
 * The three settings of the app lock, in a small file of their own in
 * the app's private storage, as `core/notify` keeps its state (ADR
 * 0032). No user content. Whether the app lock is on is not here: only the
 * `file-key` keyset file says that ("The app lock" in crypto-design.md,
 * rule 5).
 */
internal class AppLockSettings(context: Context) {
    private val preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** When the app locks after it left the screen. */
    var lockAfter: LockAfter
        get() = LockAfter.entries.firstOrNull { it.name == preferences.getString(LOCK_AFTER, null) } ?: LockAfter.LEAVING
        set(value) = preferences.edit { putString(LOCK_AFTER, value.name) }

    /** True if every window of the app blocks screenshots and shows blank in the recent apps. */
    var blockScreenshots: Boolean
        get() = preferences.getBoolean(BLOCK_SCREENSHOTS, false)
        set(value) = preferences.edit { putBoolean(BLOCK_SCREENSHOTS, value) }

    /** True if notifications show their text while the app lock is on. Off by default. */
    var notificationText: Boolean
        get() = preferences.getBoolean(NOTIFICATION_TEXT, false)
        set(value) = preferences.edit { putBoolean(NOTIFICATION_TEXT, value) }

    private companion object {
        /** The file of the app lock's settings in the app's private storage. */
        const val STORE = "app.shkriuss.core.security"
        const val LOCK_AFTER = "lock-after"
        const val BLOCK_SCREENSHOTS = "block-screenshots"
        const val NOTIFICATION_TEXT = "notification-text"
    }
}
