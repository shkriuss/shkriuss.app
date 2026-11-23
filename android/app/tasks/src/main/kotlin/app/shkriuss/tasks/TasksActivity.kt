package app.shkriuss.tasks

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.security.AppLockGate
import app.shkriuss.feature.tasks.tasksServices
import app.shkriuss.feature.tasks.ui.TasksModels
import app.shkriuss.feature.tasks.ui.TasksScreens

/**
 * The one activity of Tasks (docs/apps/tasks/spec.md, "As in Water and
 * Reminders", navigation). All of its content, with every sheet and
 * dialog, is inside [AppLockGate], inside [ShkTheme]: while the app is
 * locked, nothing of it is drawn. `EveryScreenIsBehindTheAppLockTest`
 * checks it.
 */
class TasksActivity : ComponentActivity() {
    private lateinit var models: TasksModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = TasksModels(this, tasksServices)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { TasksScreens(models, versionName) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Every screen shows what is overdue and due today now, also if the clock changed while the app was away.
        models.check()
    }
}
