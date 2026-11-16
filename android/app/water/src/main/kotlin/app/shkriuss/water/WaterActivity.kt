package app.shkriuss.water

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.security.AppLockGate
import app.shkriuss.feature.water.ui.WaterModels
import app.shkriuss.feature.water.ui.WaterScreens
import app.shkriuss.feature.water.waterServices

/**
 * The one activity of Water (docs/apps/water/spec.md, "Navigation"). All
 * of its content, with every sheet and dialog, is inside [AppLockGate],
 * inside [ShkTheme]: while the app is locked, nothing of it is drawn.
 * `EveryScreenIsBehindTheAppLockTest` checks it.
 */
class WaterActivity : ComponentActivity() {
    private lateinit var models: WaterModels

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        models = WaterModels(this, waterServices)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            ShkTheme {
                AppLockGate { WaterScreens(models, versionName) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Every screen moves to the new day if midnight passed, or the clock changed, while the app was away.
        models.checkTheDay()
    }
}
