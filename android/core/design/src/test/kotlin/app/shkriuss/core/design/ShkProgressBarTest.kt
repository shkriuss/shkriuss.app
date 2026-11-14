package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PixelMap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

/**
 * Checks [ShkProgressBar] at font scale 1.0 and 2.0:
 *
 * - TalkBack hears its label and its value in words, and gets the share
 *   from 0 to 1, as for a slider,
 * - a value below 0 shows empty, and 1 or more shows full,
 * - it fills the width it is given and is 8dp tall at every font size,
 * - the part reached is drawn in proportion from the start edge, on the
 *   right in right-to-left languages, with round ends.
 *
 * The drawing is checked on a plain image, at a density of 1, so 1dp is
 * one pixel. Graphics run natively, so the pixels are real.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkProgressBarTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun talkBackHearsTheLabelAndTheValueInWords() {
        show(0.62f)

        val config = compose.onNode(IS_PROGRESS_BAR).fetchSemanticsNode().config
        assertEquals(listOf(LABEL), config[SemanticsProperties.ContentDescription])
        assertEquals(VALUE_TEXT, config[SemanticsProperties.StateDescription])
        assertEquals(ProgressBarRangeInfo(0.62f, 0f..1f), config[SemanticsProperties.ProgressBarRangeInfo])
    }

    @Test
    fun aValuePastTheEndsShowsEmptyOrFull() {
        assertEquals(0f, shownValue(-0.5f))
        assertEquals(0f, shownValue(Float.NaN))
        assertEquals(1f, shownValue(1f))
        assertEquals(1f, shownValue(1.3f))

        show(1.3f)
        val config = compose.onNode(IS_PROGRESS_BAR).fetchSemanticsNode().config
        assertEquals(1f, config[SemanticsProperties.ProgressBarRangeInfo].current)
        val bar = draw(shownValue(1.3f))
        assertColour("the start", ACCENT, bar[2, MIDDLE])
        assertColour("the end", ACCENT, bar[WIDTH - 3, MIDDLE])
    }

    @Test
    fun itFillsItsWidthAndIsEightDpTall() {
        show(0.5f)

        compose.onNode(IS_PROGRESS_BAR)
            .assertWidthIsEqualTo(WIDTH.dp)
            .assertHeightIsEqualTo(8.dp)
    }

    @Test
    fun thePartReachedIsDrawnInProportionFromTheStart() {
        val bar = draw(0.25f)

        assertColour("10% along", ACCENT, bar[WIDTH / 10, MIDDLE])
        assertColour("just before a quarter", ACCENT, bar[WIDTH / 4 - 2, MIDDLE])
        assertColour("just after a quarter", OUTLINE, bar[WIDTH / 4 + 2, MIDDLE])
        assertColour("90% along", OUTLINE, bar[WIDTH * 9 / 10, MIDDLE])
    }

    @Test
    fun inRightToLeftLanguagesItFillsFromTheRight() {
        val bar = draw(0.25f, LayoutDirection.Rtl)

        assertColour("90% along", ACCENT, bar[WIDTH * 9 / 10, MIDDLE])
        assertColour("10% along", OUTLINE, bar[WIDTH / 10, MIDDLE])
    }

    @Test
    fun atZeroNothingIsFilled() {
        val bar = draw(0f)

        assertColour("10% along", OUTLINE, bar[WIDTH / 10, MIDDLE])
        assertColour("90% along", OUTLINE, bar[WIDTH * 9 / 10, MIDDLE])
    }

    @Test
    fun theEndsAreRound() {
        val bar = draw(1f)

        assertColour("the corner, outside the round end", BLANK, bar[0, 0])
        assertColour("the middle of the start", ACCENT, bar[1, MIDDLE])
    }

    private fun show(value: Float, direction: LayoutDirection = LayoutDirection.Ltr) {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides direction) {
                ShkTheme(darkTheme = false) {
                    Box(Modifier.width(WIDTH.dp)) { ShkProgressBar(value = value, label = LABEL, valueText = VALUE_TEXT) }
                }
            }
        }
    }

    /** The bar at [value] drawn onto a plain image, at a density of 1, so 1dp is one pixel. */
    private fun draw(value: Float, direction: LayoutDirection = LayoutDirection.Ltr): PixelMap {
        val image = ImageBitmap(WIDTH, HEIGHT)
        CanvasDrawScope().draw(Density(1f), direction, Canvas(image), Size(WIDTH.toFloat(), HEIGHT.toFloat())) {
            drawRect(BLANK)
            drawProgressBar(value, track = OUTLINE, reached = ACCENT)
        }
        return image.toPixelMap()
    }

    /** [actual] is [expected], give or take a little for rounding. */
    private fun assertColour(what: String, expected: Color, actual: Color) {
        val close = listOf(
            expected.red to actual.red,
            expected.green to actual.green,
            expected.blue to actual.blue,
        ).all { (e, a) -> abs(e - a) <= TOLERANCE }
        assertTrue("$what should be $expected, but is $actual", close)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private val IS_PROGRESS_BAR = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)

        private const val WIDTH = 200
        private const val HEIGHT = 8
        private const val MIDDLE = HEIGHT / 2
        private const val LABEL = "Water today"
        private const val VALUE_TEXT = "62 percent"

        /** How far a colour may be from the expected one, per channel. */
        private const val TOLERANCE = 2f / 255f

        private val ACCENT = LightShkColors.accent
        private val OUTLINE = LightShkColors.outline
        private val BLANK = Color.White
    }
}
