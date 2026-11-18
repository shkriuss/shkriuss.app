package app.shkriuss.catalog

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.ComposeFoundationFlags
import androidx.compose.foundation.ExperimentalFoundationApi
import app.shkriuss.core.design.ShkTheme

/**
 * The Catalog app's only activity. It shows the design gallery: the start
 * screen and a page for each group of design tokens.
 *
 * Before anything is drawn it turns off Compose's smart selection, as the
 * apps do at their start (`AppLockWatcher.start`): a long press in a text
 * field would otherwise hand the field's text to Android's text
 * classifier, also in the samples of the recovery-word fields ("Screens
 * that show or take the words" in crypto-design.md).
 */
class CatalogActivity : ComponentActivity() {
    @OptIn(ExperimentalFoundationApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        ComposeFoundationFlags.isSmartSelectionEnabled = false
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                CatalogApp()
            }
        }
    }
}
