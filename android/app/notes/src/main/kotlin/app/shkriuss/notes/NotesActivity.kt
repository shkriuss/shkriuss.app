package app.shkriuss.notes

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.security.AppLockGate
import app.shkriuss.feature.notes.notesServices
import app.shkriuss.feature.notes.ui.NotesModels
import app.shkriuss.feature.notes.ui.NotesScreens

/**
 * The one activity of Notes (docs/apps/notes/spec.md, "As in Water and
 * Tasks", navigation). All of its content, with every dialog and menu, is
 * inside [AppLockGate], inside [ShkTheme]: while the app is locked,
 * nothing of it is drawn. `EveryScreenIsBehindTheAppLockTest` checks it.
 *
 * It tells `NotesServices` when it is on the screen, because a picked file
 * starts to be added only then. When it leaves the screen, the open note
 * saves what is typed and the **Undo** of a snackbar ends.
 */
class NotesActivity : ComponentActivity() {
    private lateinit var models: NotesModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = NotesModels(this, notesServices)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { NotesScreens(models, versionName) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        notesServices.onScreen(true)
        // A last change shows in the phone's day and zone now, also if the clock changed while Notes was away.
        models.check()
    }

    override fun onStop() {
        notesServices.onScreen(false)
        models.leftScreen()
        super.onStop()
    }
}
