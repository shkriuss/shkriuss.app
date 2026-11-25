package app.shkriuss.feature.notes.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How far a zoomed image can be dragged in the image view
 * (docs/apps/notes/spec.md, "The image view", point 2): only as far as the
 * fitted image is larger than the pane, each way, so it never moves past
 * its edges.
 */
class PanLimitsTest {
    private val pane = IntSize(100, 200)

    /** A wide image, 200 by 100, fits the pane 100 by 50. */
    private val wide = IntSize(200, 100)

    @Test
    fun atOneTimesTheImageDoesNotMove() {
        assertOffset(Offset.Zero, limited(Offset(30f, 30f), 1f, pane, wide))
    }

    @Test
    fun aWideImageZoomedTwiceMovesSidewaysOnlyAsFarAsItIsWiderThanThePane() {
        // Zoomed twice it is 200 by 100: 50 past each side, and still shorter than the pane.
        assertOffset(Offset(50f, 0f), limited(Offset(80f, 80f), 2f, pane, wide))
        assertOffset(Offset(-50f, 0f), limited(Offset(-80f, -80f), 2f, pane, wide))
    }

    @Test
    fun zoomedFiveTimesItMovesBothWaysOnceItIsTallerThanThePane() {
        // Five times: 500 by 250, so 200 past each side and 25 past the top and the bottom.
        assertOffset(Offset(200f, 25f), limited(Offset(999f, 999f), 5f, pane, wide))
    }

    @Test
    fun anImageWithNoSizeDoesNotMove() {
        assertOffset(Offset.Zero, limited(Offset(10f, 10f), 3f, pane, IntSize.Zero))
    }

    /** [actual] is [expected], to a hundredth of a pixel, so that 0 and -0 are the same. */
    private fun assertOffset(expected: Offset, actual: Offset) {
        assertEquals(expected.x, actual.x, 0.01f)
        assertEquals(expected.y, actual.y, 0.01f)
    }
}
