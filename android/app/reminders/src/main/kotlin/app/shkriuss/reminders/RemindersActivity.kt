package app.shkriuss.reminders

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.security.AppLockGate
import app.shkriuss.feature.reminders.remindersServices
import app.shkriuss.feature.reminders.ui.RemindersModels
import app.shkriuss.feature.reminders.ui.RemindersScreens

/**
 * The one activity of Reminders (docs/apps/reminders/spec.md, "As in
 * Water", navigation). All of its content, with every sheet and dialog,
 * is inside [AppLockGate], inside [ShkTheme]: while the app is locked,
 * nothing of it is drawn. `EveryScreenIsBehindTheAppLockTest` checks it.
 *
 * A tap on a notification starts it with the reminder's `id` as the
 * intent's identifier, and the form of that reminder opens, after the app
 * lock (spec, "The notification", point 6). Only the identifier is read:
 * no text travels. It is read on a new start only, and not when the user
 * opens Reminders again from Recents. Another app can start the screen
 * the same way. Then the form of that reminder opens, or Upcoming if no
 * reminder has that id.
 */
class RemindersActivity : ComponentActivity() {
    private lateinit var models: RemindersModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = RemindersModels(this, remindersServices)
        tappedReminderOf(savedInstanceState)?.let(models.notifications::open)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { RemindersScreens(models, versionName) }
            }
        }
    }

    /**
     * The `id` of the reminder whose notification was tapped, or null.
     * Only on a new start: when the phone is turned, the form is as the
     * user left it. Not when Reminders is opened again from Recents: the
     * tap that started the task is old by then, and Android passes its
     * intent again, with `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`.
     */
    private fun tappedReminderOf(savedInstanceState: Bundle?): String? {
        if (savedInstanceState != null) return null
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
        return intent.identifier
    }

    override fun onStart() {
        super.onStart()
        // Every screen shows what is upcoming and what is past now, also if the clock changed while the app was away.
        models.check()
    }
}
