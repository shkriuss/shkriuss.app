package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks the small image at the start of a [ShkListItem]
 * (docs/apps/notes/spec.md, "Changes to shared modules"), at font scale
 * 1.0 and 2.0:
 *
 * - it is at least 40dp square, before the text, and grows with the font
 *   size,
 * - TalkBack reads the row as one item, its text only: the image has no
 *   label of its own.
 *
 * Graphics run natively, so text is measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkListItemImageTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun theImageComesBeforeTheTextGrowsWithItAndHasNoLabel() {
        val red = ImageBitmap(IMAGE_PX, IMAGE_PX).also { image ->
            Canvas(image).drawRect(0f, 0f, IMAGE_PX.toFloat(), IMAGE_PX.toFloat(), Paint().apply { color = Color.Red })
        }
        compose.setContent {
            ShkTheme { ShkListItem(headline = NAME, supportingText = SIZE, image = BitmapPainter(red), onClick = {}) }
        }

        val row = compose.onNode(hasText(NAME)).fetchSemanticsNode()
        assertEquals(listOf(NAME, SIZE), row.config[SemanticsProperties.Text].map { it.text })
        assertEquals("The image has no label", null, row.config.getOrNull(SemanticsProperties.ContentDescription))
        val images = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription), useUnmergedTree = true)
        assertTrue("No part of the row has a label", images.fetchSemanticsNodes().isEmpty())

        // The text starts after the image and the gap: 40dp and 12dp from where the row's content starts, 8dp in from
        // the edge of its touch target. At font scale 2.0 the image is larger.
        val rowLeft = row.boundsInRoot.left
        val textLeft = compose.onNode(hasText(NAME), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left
        val imageAndGap = with(compose.density) { (textLeft - rowLeft).toDp() } - 8.dp
        assertTrue("The image and the gap after it take $imageAndGap", imageAndGap >= 52.dp)
        if (fontScale > 1f) assertTrue("The image grows with the text: $imageAndGap", imageAndGap > 52.dp + 1.dp)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val NAME = "ticket.jpg"
        private const val SIZE = "2.4 MB"
        private const val IMAGE_PX = 64
    }
}
