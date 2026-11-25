package app.shkriuss.notes

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
import app.shkriuss.feature.notes.notesServices

/**
 * The one activity of Notes (docs/apps/notes/spec.md, "As in Water and
 * Tasks", navigation). All of its content is inside [AppLockGate], inside
 * [ShkTheme]: while the app is locked, nothing of it is drawn.
 * `EveryScreenIsBehindTheAppLockTest` checks it. It tells `NotesServices`
 * when it is on the screen, because a picked file starts to be added only
 * then.
 */
class NotesActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate { NotesPlaceholder() }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        notesServices.onScreen(true)
    }

    override fun onStop() {
        notesServices.onScreen(false)
        super.onStop()
    }
}

/**
 * Stands in for Notes' screens, the list with one note open, the image
 * view and Settings, until they are built. They replace it, and delete it
 * with its two strings and its screenshots.
 */
@Composable
internal fun NotesPlaceholder() {
    ShkScreen(scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.placeholder_title)) }) {
        ShkText(stringResource(R.string.placeholder_line))
    }
}
