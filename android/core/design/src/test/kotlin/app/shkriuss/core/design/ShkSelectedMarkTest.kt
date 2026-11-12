package app.shkriuss.core.design

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PixelMap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks the mark of a selected [ShkListItem] (owner decision on pull
 * request 16): it must show with more than a change of colour. Besides the
 * fill, it has a bar in the accent colour along the start edge of the
 * highlight, 4dp wide, inside the 8dp before the text, clear of the
 * rounded corners. In right-to-left languages the bar is on the right.
 *
 * The mark is drawn onto a plain image, at a density of 1, so 1dp is one
 * pixel. Graphics run natively, so the pixels are real.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkSelectedMarkTest {
    @Test
    fun aBarInTheAccentColourRunsAlongTheStartEdge() {
        val mark = draw(LayoutDirection.Ltr)

        assertColour("the bar", BAR, mark[1, MIDDLE])
        assertColour("the bar", BAR, mark[3, MIDDLE])
        assertColour("the fill after the bar, before the text", FILL, mark[5, MIDDLE])
        assertColour("the fill under the text", FILL, mark[50, MIDDLE])
        // The bar stops the corner radius, 12dp, short of the top and the bottom.
        assertColour("the fill above the bar", FILL, mark[1, 6])
        assertColour("the fill below the bar", FILL, mark[1, HEIGHT - 7])
        assertColour("the bar near its top", BAR, mark[1, 14])
    }

    @Test
    fun theBarIsOnTheRightInRightToLeftLanguages() {
        val mark = draw(LayoutDirection.Rtl)

        assertColour("the bar", BAR, mark[WIDTH - 2, MIDDLE])
        assertColour("the fill at the left edge", FILL, mark[1, MIDDLE])
    }

    private fun draw(direction: LayoutDirection): PixelMap {
        val image = ImageBitmap(WIDTH, HEIGHT)
        CanvasDrawScope().draw(Density(1f), direction, Canvas(image), Size(WIDTH.toFloat(), HEIGHT.toFloat())) {
            drawSelectedMark(fill = FILL, bar = BAR)
        }
        return image.toPixelMap()
    }

    /** [actual] is [expected], give or take a little for rounding. */
    private fun assertColour(what: String, expected: Color, actual: Color) {
        val close = listOf(
            expected.red to actual.red,
            expected.green to actual.green,
            expected.blue to actual.blue,
        ).all { (e, a) -> kotlin.math.abs(e - a) <= TOLERANCE }
        assertTrue("$what should be $expected, but is $actual", close)
    }

    private companion object {
        /** A row 48dp tall, the smallest, with room either side of the text. */
        const val WIDTH = 100
        const val HEIGHT = 48
        const val MIDDLE = HEIGHT / 2

        /** How far a colour may be from the expected one, per channel. */
        const val TOLERANCE = 2f / 255f

        val FILL = LightShkColors.surfaceHigh
        val BAR = LightShkColors.accent
    }
}
