package app.shkriuss.reminders

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
 * The one activity of Reminders (docs/apps/reminders/spec.md, "As in
 * Water", navigation). All of its content is inside [AppLockGate], inside
 * [ShkTheme]: while the app is locked, nothing of it is drawn.
 * `EveryScreenIsBehindTheAppLockTest` checks it.
 */
class RemindersActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate { RemindersPlaceholder() }
            }
        }
    }
}

/**
 * Stands in for Reminders' screens, Upcoming, Past, Settings and the
 * reminder form, until they are built. They replace it, and delete it
 * with its two strings and its screenshots.
 */
@Composable
internal fun RemindersPlaceholder() {
    ShkScreen(scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.placeholder_title)) }) {
        ShkText(stringResource(R.string.placeholder_line))
    }
}
