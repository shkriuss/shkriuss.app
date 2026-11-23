package app.shkriuss.tasks

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
 * Screenshots of the screen that stands in for Tasks' screens until they
 * are built, in the four standard configurations, with the app lock off.
 * It starts the real activity, so the images show the window theme and
 * the system bar insets too. The screens delete this test and its images.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedTasksApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TasksPlaceholderScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<TasksActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun placeholder() {
        compose.onNodeWithText("Tasks' screens are not built yet.").assertExists()
        compose.onRoot().captureRoboImage("src/test/screenshots/TasksPlaceholder_${config.name}.png")
    }

    /** The four configurations. */
    companion object {
        /** One test run per configuration. */
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}
