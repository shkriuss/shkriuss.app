package app.shkriuss.tasks

import android.content.Intent
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
 *
 * A tap on a notification starts it with the task's `id` as the intent's
 * identifier, and the task's list opens with its form, after the app lock
 * (spec, "The notification", point 2). Only the identifier is read: no
 * text travels. It is read on a new start only, and not when the user
 * opens Tasks again from Recents. Another app can start the screen the
 * same way. Then the form of that task opens, or Today if no task has
 * that id.
 */
class TasksActivity : ComponentActivity() {
    private lateinit var models: TasksModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = TasksModels(this, tasksServices)
        tappedTaskOf(savedInstanceState)?.let(models.notifications::open)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { TasksScreens(models, versionName) }
            }
        }
    }

    /**
     * The `id` of the task whose notification was tapped, or null. Only on
     * a new start: when the phone is turned, the screen is as the user
     * left it. Not when Tasks is opened again from Recents: the tap that
     * started the task is old by then, and Android passes its intent
     * again, with `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`.
     */
    private fun tappedTaskOf(savedInstanceState: Bundle?): String? {
        if (savedInstanceState != null) return null
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
        return intent.identifier
    }

    override fun onStart() {
        super.onStart()
        // Every screen shows what is overdue and due today now, also if the clock changed while the app was away, and the
        // line about notifications shows their state now.
        models.check()
    }
}
