package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner

/**
 * Checks [iconSizeNextToText] at a smaller, the default and a larger font
 * size: an icon next to text keeps its size up to the default, never
 * shrinks, and grows above it, but never more than the font scale.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
class ShkIconSizeTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun anIconNextToTextGrowsWithLargerTextOnly() {
        var size = Dp.Unspecified
        compose.setContent { size = iconSizeNextToText(ICON) }
        compose.waitForIdle()

        if (fontScale <= 1f) {
            assertEquals("at font scale $fontScale", ICON, size)
        } else {
            assertTrue("at font scale $fontScale the icon is $size", size > ICON && size <= ICON * fontScale)
        }
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(0.85f, 1.0f, 1.3f, 2.0f).map { arrayOf(it) }

        private val ICON = 18.dp
    }
}
