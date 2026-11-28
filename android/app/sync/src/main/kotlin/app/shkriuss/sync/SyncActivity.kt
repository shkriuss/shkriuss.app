package app.shkriuss.sync

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

/**
 * The one activity of Sync (docs/apps/sync/spec.md, "As in Water",
 * navigation). Nothing of Sync is behind an app lock: it holds no key that
 * opens data.
 */
class SyncActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme { SyncPlaceholder() }
        }
    }
}

/**
 * Stands in for Sync's screens, the join steps, Apps, Devices and
 * Settings, until they are built. They replace it, and delete it with its
 * two strings and its screenshots.
 */
@Composable
internal fun SyncPlaceholder() {
    ShkScreen(scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.placeholder_title)) }) {
        ShkText(stringResource(R.string.placeholder_line))
    }
}
