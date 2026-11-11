package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsConfiguration
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Checks the card, the list item, the divider, the section header and the
 * empty, loading and error states at font scale 1.0 and 2.0, for the rules
 * in CLAUDE.md, "UI and accessibility":
 *
 * - TalkBack reads each as the items it is meant to be: a list item and
 *   the words of a state as one item, a section header as a heading, a
 *   divider and decorative icons not at all,
 * - a list item is at least 48dp tall, and a plain card's button keeps a
 *   touch target of its own,
 * - long text wraps, is not cut by its own layout, and stays inside the
 *   component; the text of a state stays centred.
 *
 * How the parts that can be tapped take taps is checked by
 * [ShkComponentsTest]. Graphics run natively, so text is measured with the
 * real font. The screen is the phone of the screenshot tests: at font
 * scale 2.0 the long samples are taller than Robolectric's own small
 * screen, which would squeeze them.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkContentComponentsTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun aListItemIsReadAsOneItemWithAllItsTextInOrder() {
        show {
            ShkListItem(
                headline = HEADLINE,
                supportingText = SUPPORTING,
                trailingText = TRAILING,
                icon = SizeOnlyPainter(),
                modifier = Modifier.testTag(TARGET),
            )
        }

        compose.onNodeWithTag(TARGET).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget).assertIsEnabled()
        val config = compose.onNodeWithTag(TARGET).fetchSemanticsNode().config
        assertEquals(listOf(HEADLINE, SUPPORTING, TRAILING), texts(config))
        assertFalse("The icon is decorative", SemanticsProperties.ContentDescription in config)
        assertFalse("A list item without onClick cannot be tapped", SemanticsActions.OnClick in config)
    }

    @Test
    fun aListItemThatCanBeTappedIsReadWithAllItsTextAsAButton() {
        show { ShkListItem(headline = HEADLINE, supportingText = SUPPORTING, trailingText = TRAILING, onClick = {}) }

        val config = compose.onNode(hasClickAction()).fetchSemanticsNode().config
        assertEquals(listOf(HEADLINE, SUPPORTING, TRAILING), texts(config))
        assertEquals(Role.Button, config[SemanticsProperties.Role])
    }

    @Test
    fun aListItemThatIsTurnedOffIsReadAsDisabled() {
        show {
            Column {
                ShkListItem(headline = HEADLINE, enabled = false, modifier = Modifier.testTag(TARGET))
                ShkListItem(headline = SUPPORTING, enabled = false, onClick = {})
            }
        }

        compose.onNodeWithTag(TARGET).assertIsNotEnabled()
        compose.onNode(hasClickAction()).assertIsNotEnabled()
    }

    @Test
    fun longListItemTextWrapsInsideTheRowAndLeavesRoomForTheTrailingText() {
        show {
            Box(Modifier.width(NARROW_WIDTH)) {
                ShkListItem(
                    headline = LONG_HEADLINE,
                    supportingText = LONG_SUPPORTING,
                    trailingText = TRAILING,
                    icon = SizeOnlyPainter(),
                    modifier = Modifier.testTag(TARGET),
                )
            }
        }

        val row = bounds(TARGET)
        assertWrapsUncutInside(textNode(LONG_HEADLINE), row)
        assertWrapsUncutInside(textNode(LONG_SUPPORTING), row)
        val trailing = textNode(TRAILING).boundsInRoot
        assertTrue("The trailing text is outside the row", row.containsOrTouches(trailing))
        assertTrue(
            "The trailing text should sit after the headline, not on it",
            trailing.left >= textNode(LONG_HEADLINE).boundsInRoot.right,
        )
    }

    @Test
    fun aSectionHeaderIsAHeadingAndLongTextWraps() {
        show {
            Box(Modifier.width(NARROW_WIDTH)) {
                ShkSectionHeader(text = LONG_HEADER, modifier = Modifier.testTag(TARGET))
            }
        }

        compose.onNodeWithTag(TARGET).assert(isHeading())
        assertEquals(listOf(LONG_HEADER), texts(compose.onNodeWithTag(TARGET).fetchSemanticsNode().config))
        assertWrapsUncutInside(textNode(LONG_HEADER), bounds(TARGET))
    }

    @Test
    fun aDividerIsOneDpTallFillsTheWidthAndIsNotRead() {
        show {
            Box(Modifier.width(NARROW_WIDTH)) { ShkDivider(Modifier.testTag(TARGET)) }
        }

        compose.onNodeWithTag(TARGET).assertHeightIsEqualTo(1.dp).assertWidthIsEqualTo(NARROW_WIDTH)
        val config = compose.onNodeWithTag(TARGET).fetchSemanticsNode().config
        assertTrue("TalkBack should hear nothing from a divider", texts(config).isEmpty())
    }

    @Test
    fun aCardHoldsLongTextInsideItsShapeAndAPlainCardsButtonIsItsOwnTarget() {
        show {
            Box(Modifier.width(NARROW_WIDTH)) {
                ShkCard(Modifier.testTag(TARGET)) {
                    ShkText(text = LONG_HEADLINE)
                    ShkTextButton(text = ACTION, onClick = {})
                }
            }
        }

        val card = bounds(TARGET)
        val text = textNode(LONG_HEADLINE)
        assertWrapsUncutInside(text, card)
        val outline = ShkShapes.Card.createOutline(card.size, LayoutDirection.Ltr, compose.density)
        text.boundsInRoot.translate(-card.topLeft).corners().forEach { corner ->
            assertTrue("The corner $corner of the text is outside the card's shape", outline.contains(corner))
        }
        // The button keeps its own touch target, checked in ShkComponentsTest.
        compose.onAllNodes(hasClickAction()).assertCountEquals(1)
        val button = compose.onNode(hasClickAction()).fetchSemanticsNode()
        assertEquals("The card's text is not part of the button", listOf(ACTION), texts(button.config))
    }

    @Test
    fun theWordsOfAnEmptyStateAreReadAsOneItemAndItsButtonOnItsOwn() {
        show {
            ShkEmptyState(title = TITLE, body = BODY, icon = SizeOnlyPainter(), action = SAMPLE_ACTION)
        }

        assertEquals(listOf(TITLE, BODY), texts(compose.onNode(hasText(TITLE)).fetchSemanticsNode().config))
        assertEquals(listOf(ACTION), texts(compose.onNode(hasClickAction()).fetchSemanticsNode().config))
        assertNoContentDescriptions()
    }

    @Test
    fun theWordsOfAnErrorStateAreReadAsOneItemAndItsIconIsDecorative() {
        show { ShkErrorState(title = TITLE, body = BODY, action = SAMPLE_ACTION) }

        assertEquals(listOf(TITLE, BODY), texts(compose.onNode(hasText(TITLE)).fetchSemanticsNode().config))
        assertEquals(listOf(ACTION), texts(compose.onNode(hasClickAction()).fetchSemanticsNode().config))
        assertNoContentDescriptions()
    }

    @Test
    fun aStateWithoutAnActionHasNoButton() {
        show {
            Column {
                ShkEmptyState(title = TITLE, body = BODY)
                ShkErrorState(title = TITLE, body = BODY)
            }
        }

        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun aLoadingStateIsReadAsItsTextInProgress() {
        show { ShkLoadingState(text = LOADING) }

        val config = compose.onNode(hasText(LOADING)).fetchSemanticsNode().config
        assertEquals(listOf(LOADING), texts(config))
        assertEquals(ProgressBarRangeInfo.Indeterminate, config[SemanticsProperties.ProgressBarRangeInfo])
        // Material 3's circle on its own would be a second item, read as
        // "in progress" without the text.
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertCountEquals(1)
    }

    @Test
    fun theLoadingAndTheErrorStateAreAnnouncedPolitelyWithTheirWords() {
        show {
            Column {
                ShkLoadingState(text = LOADING)
                ShkErrorState(title = TITLE, body = BODY, action = SAMPLE_ACTION)
            }
        }

        // The live region is the item that holds the words, so the
        // announcement says them, and there is one per state, so nothing
        // is announced twice.
        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(hasText(LOADING)).assert(polite)
        compose.onNode(hasText(TITLE)).assert(polite)
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion), useUnmergedTree = true)
            .assertCountEquals(2)
    }

    @Test
    fun longTextOfTheStatesWrapsCentredAndTheButtonSitsUnderIt() {
        var shown by mutableStateOf(STATES.first())
        show {
            Box(Modifier.width(NARROW_WIDTH)) { Box(Modifier.testTag(TARGET)) { shown.content() } }
        }

        STATES.forEach { state ->
            compose.runOnIdle { shown = state }
            val bounds = bounds(TARGET)
            state.texts.forEach { text ->
                val node = textNode(text)
                assertWrapsUncutInside(node, bounds)
                assertCentred(node, state.name)
            }
            if (state.hasButton) {
                val button = compose.onNode(hasClickAction()).fetchSemanticsNode().boundsInRoot
                val lastText = textNode(state.texts.last()).boundsInRoot
                assertTrue("${state.name}: the button should sit under the text", button.top >= lastText.bottom)
                assertTrue("${state.name}: the button is outside the state", bounds.containsOrTouches(button))
            }
        }
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot

    private fun textNode(text: String): SemanticsNode =
        compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode()

    /** The text of [node] wraps onto more lines, is not cut by its own layout, and lies inside [bounds]. */
    private fun assertWrapsUncutInside(node: SemanticsNode, bounds: Rect) {
        val layout = layoutOf(node)
        val text = layout.layoutInput.text
        assertTrue("\"$text\" should wrap in this test", layout.lineCount > 1)
        assertFalse("\"$text\" is cut off by its own layout", layout.hasVisualOverflow)
        assertTrue("\"$text\", ${node.boundsInRoot}, is outside $bounds", bounds.containsOrTouches(node.boundsInRoot))
    }

    /** Every line of [node]'s text has as much space on its left as on its right. */
    private fun assertCentred(node: SemanticsNode, name: String) {
        val layout = layoutOf(node)
        val width = layout.size.width
        repeat(layout.lineCount) { line ->
            val left = layout.getLineLeft(line)
            val right = width - layout.getLineRight(line)
            assertEquals("$name: line $line of \"${layout.layoutInput.text}\" is not centred", left, right, 1f)
        }
    }

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    /** No node, merged or not, has a content description: every icon is decorative. */
    private fun assertNoContentDescriptions() {
        val described = SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription)
        compose.onAllNodes(described, useUnmergedTree = true).assertCountEquals(0)
    }

    /** What TalkBack reads from a node: its descriptions and its text. */
    private fun texts(config: SemanticsConfiguration): List<String> =
        config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
            config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }

    /** One state with long text, and the texts it shows, top to bottom. */
    private class StateCase(
        val name: String,
        val texts: List<String>,
        val hasButton: Boolean,
        val content: @Composable () -> Unit,
    )

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TARGET = "component"
        private const val HEADLINE = "Buy bread"
        private const val SUPPORTING = "From the shop on the corner"
        private const val TRAILING = "9:30"
        private const val LONG_HEADLINE = "Call the dentist about the appointment"
        private const val LONG_SUPPORTING = "Ask whether Thursday is still free"
        private const val LONG_HEADER = "Tasks that are due later this week"
        private const val TITLE = "No notes yet"
        private const val BODY = "Notes you write show here."
        private const val ACTION = "New note"
        private const val LOADING = "Loading notes"
        private const val LONG_TITLE = "Could not open the backup you chose"
        private const val LONG_BODY = "The file is damaged, or it is not a backup made by this app."
        private const val LONG_LOADING = "Reading your notes from the backup. This can take a minute."

        /** Narrower than any phone, so long text wraps at every font scale. */
        private val NARROW_WIDTH = 200.dp

        /** The button of the sample states. It does nothing. */
        private val SAMPLE_ACTION = ShkStateAction(text = ACTION, onClick = {})

        private val STATES = listOf(
            StateCase("EmptyState", listOf(LONG_TITLE, LONG_BODY), hasButton = true) {
                ShkEmptyState(title = LONG_TITLE, body = LONG_BODY, icon = SizeOnlyPainter(), action = SAMPLE_ACTION)
            },
            StateCase("ErrorState", listOf(LONG_TITLE, LONG_BODY), hasButton = true) {
                ShkErrorState(title = LONG_TITLE, body = LONG_BODY, action = SAMPLE_ACTION)
            },
            StateCase("LoadingState", listOf(LONG_LOADING), hasButton = false) {
                ShkLoadingState(text = LONG_LOADING)
            },
        )
    }
}

/** An icon that draws nothing and has no size of its own, so the component sets it. */
private class SizeOnlyPainter : Painter() {
    override val intrinsicSize: Size = Size.Unspecified

    override fun DrawScope.onDraw() = Unit
}

private fun Rect.corners(): List<Offset> = listOf(topLeft, topRight, bottomLeft, bottomRight)

private fun Outline.contains(point: Offset): Boolean = when (this) {
    is Outline.Rectangle -> rect.contains(point)
    is Outline.Rounded -> roundRect.contains(point)
    is Outline.Generic -> error("Cards are drawn in rounded rectangles, not paths")
}

/** Like [Rect.contains] for a whole rectangle, but touching an edge counts as inside. */
private fun Rect.containsOrTouches(other: Rect): Boolean =
    other.left >= left && other.top >= top && other.right <= right && other.bottom <= bottom
