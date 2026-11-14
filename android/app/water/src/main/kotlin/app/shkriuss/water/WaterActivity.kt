package app.shkriuss.water

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
 * The one activity of Water (docs/apps/water/spec.md, "Navigation"). All
 * of its content is inside [AppLockGate], inside [ShkTheme]: while the app
 * is locked, nothing of it is drawn. `EveryScreenIsBehindTheAppLockTest`
 * checks it.
 */
class WaterActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate { WaterPlaceholder() }
            }
        }
    }
}

/**
 * Stands in for Water's screens until step 2.3, which builds Today,
 * History and Settings in their place and deletes this, with its two
 * strings and its screenshots.
 */
@Composable
internal fun WaterPlaceholder() {
    ShkScreen(scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.placeholder_title)) }) {
        ShkText(stringResource(R.string.placeholder_line))
    }
}
