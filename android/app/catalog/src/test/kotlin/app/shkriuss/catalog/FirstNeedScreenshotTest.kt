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
 * Screenshots of the dialog for the moment the recovery key is first
 * needed (ADR 0035), in each of its four forms, as the page "Recovery key
 * when first needed" shows them: on a phone and a tablet, light and dark,
 * at font scale 1.0 and 2.0.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FirstNeedScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<CatalogActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun everyForm() {
        compose.onNode(hasText(text(CatalogPage.RecoveryKeyFirstNeed.title))).performScrollTo().performClick()
        FirstNeedSample.entries.forEach { sample ->
            compose.onNode(hasText(text(sample.title))).performScrollTo().performClick()
            compose.captureWholeScreen("FirstNeed${sample.name}", config)
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
