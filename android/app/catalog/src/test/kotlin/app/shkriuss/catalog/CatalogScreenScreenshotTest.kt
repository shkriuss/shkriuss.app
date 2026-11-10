package app.shkriuss.catalog

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of the Catalog screen in the eight standard configurations.
 * The reference images are in `src/test/screenshots/`.
 *
 * The test starts the real activity, so the images show the window theme
 * and the system bar insets too. The screen is set up before the activity
 * starts, and the Compose rule waits until drawing is done.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CatalogScreenScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<CatalogActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun catalogScreen() {
        compose.onRoot().captureRoboImage("src/test/screenshots/CatalogScreen_${config.name}.png")
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<Array<Any>> = ScreenshotConfig.all().map { arrayOf(it) }
    }
}
