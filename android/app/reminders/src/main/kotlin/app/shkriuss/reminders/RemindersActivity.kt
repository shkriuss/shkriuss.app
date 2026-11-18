package app.shkriuss.reminders

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
 */
class RemindersActivity : ComponentActivity() {
    private lateinit var models: RemindersModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = RemindersModels(this, remindersServices)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { RemindersScreens(models, versionName) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Every screen shows what is upcoming and what is past now, also if the clock changed while the app was away.
        models.check()
    }
}
