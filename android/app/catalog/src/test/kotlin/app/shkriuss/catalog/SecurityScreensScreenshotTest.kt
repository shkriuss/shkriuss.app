package app.shkriuss.catalog

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of every state of the recovery key screens of
 * `core/security`, from the Catalog page, in the eight standard
 * configurations: `RecoveryKey<State>_<config>.png`. Each state is opened
 * the way the owner opens it, by tapping it on the page, and Back returns.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SecurityScreensScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<CatalogActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun everyState() {
        compose.onNode(hasText(text(CatalogPage.RecoveryKeyScreens.title))).performScrollTo().performClick()
        SecuritySample.entries.forEach { sample ->
            compose.onNode(hasText(text(sample.title))).performScrollTo().performClick()
            compose.captureWholeScreen("RecoveryKey${sample.name}", config)
            compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
            compose.waitForIdle()
        }
    }

    private fun text(id: Int): String = compose.activity.getString(id)

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<Array<Any>> = ScreenshotConfig.all().map { arrayOf(it) }
    }
}
