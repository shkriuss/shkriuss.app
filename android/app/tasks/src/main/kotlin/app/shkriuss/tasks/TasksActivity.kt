package app.shkriuss.tasks

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.security.AppLockGate

/**
 * The one activity of Tasks (docs/apps/tasks/spec.md, "As in Water and
 * Reminders", navigation). All of its content is inside [AppLockGate],
 * inside [ShkTheme]: while the app is locked, nothing of it is drawn.
 * `EveryScreenIsBehindTheAppLockTest` checks it.
 */
class TasksActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate { TasksPlaceholder() }
            }
        }
    }
}

/**
 * Stands in for Tasks' screens, Today, Lists with one list open, Settings
 * and the task form, until they are built. They replace it, and delete it
 * with its two strings and its screenshots.
 */
@Composable
internal fun TasksPlaceholder() {
    ShkScreen(scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.placeholder_title)) }) {
        ShkText(stringResource(R.string.placeholder_line))
    }
}
