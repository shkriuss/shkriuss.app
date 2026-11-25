package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight
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
 * Checks the two parts of [ShkText] for Notes' list (docs/apps/notes/spec.md,
 * "Changes to shared modules"), at font scale 1.0 and 2.0:
 *
 * - with `maxLines`, a long text stops at that many lines and ends with
 *   "…"; without it, the same text wraps on and is not cut,
 * - `bold` draws its ranges bold, leaves out a range that does not fit,
 *   and TalkBack reads the text as it is.
 *
 * Graphics run natively, so text is laid out with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkTextPartsTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun aPreviewStopsAtItsLinesWithAnEllipsisAndOtherTextWrapsOn() {
        var cut by mutableStateOf(true)
        compose.setContent {
            ShkTheme {
                Column(Modifier.width(WIDTH)) {
                    if (cut) ShkText(text = LONG, maxLines = 2) else ShkText(text = LONG)
                }
            }
        }
        val preview = layoutOf(LONG)
        assertEquals(2, preview.lineCount)
        assertTrue("The last line ends with an ellipsis", preview.isLineEllipsized(1))

        cut = false
        val whole = layoutOf(LONG)
        assertTrue("Without maxLines the text wraps on: ${whole.lineCount} lines", whole.lineCount > 2)
        assertTrue(!whole.isLineEllipsized(whole.lineCount - 1))
    }

    @Test
    fun boldRangesAreBoldAndTalkBackReadsTheTextAsItIs() {
        compose.setContent {
            ShkTheme { ShkText(text = MATCH, bold = listOf(6..9, 40..60)) }
        }

        val node = compose.onNode(hasText(MATCH)).fetchSemanticsNode()
        val read = node.config[SemanticsProperties.Text].single()
        assertEquals(MATCH, read.text)
        val layout = layoutOf(MATCH)
        val spans = layout.layoutInput.text.spanStyles
        assertEquals("One range in bold; the one past the end is left out", 1, spans.size)
        assertEquals(6, spans.single().start)
        assertEquals(10, spans.single().end)
        assertEquals(FontWeight.Bold, spans.single().item.fontWeight)
    }

    private fun layoutOf(text: String): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        compose.runOnIdle {
            compose.onNode(hasText(text)).fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        }
        return results.single()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private val WIDTH = 240.dp
        private const val LONG =
            "Bread, milk and eggs for the week, and something for dinner on Friday, when the guests come over to see the new flat."
        private const val MATCH = "- [ ] Passport"
    }
}
