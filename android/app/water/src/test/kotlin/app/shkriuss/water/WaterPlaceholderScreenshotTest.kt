package app.shkriuss.water

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of the screen that stands in for Water's screens until step
 * 2.3, in the eight standard configurations, with the app lock off. It
 * starts the real activity, so the images show the window theme and the
 * system bar insets too. Step 2.3 deletes this test and its images.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedWaterApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WaterPlaceholderScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<WaterActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun placeholder() {
        compose.onNodeWithText("Water's screens come in the next step.").assertExists()
        compose.onRoot().captureRoboImage("src/test/screenshots/WaterPlaceholder_${config.name}.png")
    }

    /** The eight configurations. */
    companion object {
        /** One test run per configuration. */
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}
