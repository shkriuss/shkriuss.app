package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
 * Checks [ShkNavigationScaffold] at font scale 1.0 and 2.0:
 *
 * - In a compact window the destinations are a bar along the bottom,
 *   under the content, side by side, each as wide and as tall as the
 *   others. In a medium or an expanded window they are a rail along the
 *   start, beside the content, one under the other.
 * - The rail is 80dp wide at font scale 1.0, and grows as 14sp text does.
 * - Every destination is one touch target of at least 48dp that TalkBack
 *   reads as its label, once, as a tab that is selected or not, in a
 *   group. Its icon is not read. A tap calls onSelect with its index.
 * - A long label wraps inside its destination and is not cut.
 * - The content keeps its state when the bar becomes a rail.
 *
 * The screen is the tablet of the screenshot tests, so the scaffold can be
 * given a phone-sized space too. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w1280dp-h800dp")
class ShkNavigationScaffoldTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun aCompactWindowGetsABarAlongTheBottom() {
        show(ShkWindowWidth.Compact)

        val frame = bounds(FRAME)
        val content = bounds(CONTENT)
        val tabs = tabs()
        assertEquals(LABELS.size, tabs.size)
        tabs.forEach { tab ->
            assertTrue("A destination should sit under the content", tab.top >= content.bottom - 0.5f)
            assertEquals("The bar should end at the bottom", frame.bottom, tab.bottom, 1f)
            assertEquals("The destinations should be as tall as each other", tabs.first().height, tab.height, 1f)
            assertEquals("The destinations should be as wide as each other", tabs.first().width, tab.width, 1f)
        }
        assertEquals("The bar should start at the start edge", frame.left, tabs.first().left, 1f)
        assertEquals("The bar should end at the end edge", frame.right, tabs.last().right, 1f)
        assertEquals("The content should fill the width", frame.width, content.width, 1f)
    }

    @Test
    fun mediumAndExpandedWindowsGetARailAlongTheStart() {
        var width by mutableStateOf(ShkWindowWidth.Medium)
        compose.setContent { ShkTheme { Frame(width) } }

        listOf(ShkWindowWidth.Medium, ShkWindowWidth.Expanded).forEach { windowWidth ->
            compose.runOnIdle { width = windowWidth }
            val frame = bounds(FRAME)
            val content = bounds(CONTENT)
            val tabs = tabs()
            tabs.zipWithNext().forEach { (above, below) ->
                assertTrue("$windowWidth: destinations should sit one under the other", below.top >= above.bottom)
            }
            tabs.forEach { tab ->
                assertTrue("$windowWidth: a destination should sit before the content", tab.right <= content.left + 0.5f)
            }
            assertEquals("$windowWidth: the rail should start at the start edge", frame.left, tabs.first().left, 1f)
            assertEquals("$windowWidth: the content should fill the height", frame.height, content.height, 1f)

            // 80dp at the default font size, growing as 14sp text does.
            val growth = with(compose.density) { 14.sp.toDp() / 14.dp }
            val railWidth = px(RAIL_WIDTH) * maxOf(1f, growth)
            assertEquals("$windowWidth: the rail's width", railWidth, content.left - frame.left, 1f)
            if (fontScale > 1f) assertTrue("The rail should grow with the font size", railWidth > px(RAIL_WIDTH))
        }
    }

    @Test
    fun everyDestinationIsALabelledTabThatSaysWhetherItIsSelected() {
        var width by mutableStateOf(ShkWindowWidth.Compact)
        val selections = mutableListOf<Int>()
        compose.setContent { ShkTheme { Frame(width, onSelect = { selections += it }) } }

        listOf(ShkWindowWidth.Compact, ShkWindowWidth.Expanded).forEach { windowWidth ->
            compose.runOnIdle { width = windowWidth }
            compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup)).assertCountEquals(1)
            LABELS.forEachIndexed { index, label ->
                val node = compose.onNode(hasText(label)).fetchSemanticsNode()
                assertEquals("$windowWidth: TalkBack reads the label once", listOf(label), texts(node))
                assertEquals(Role.Tab, node.config[SemanticsProperties.Role])
                assertEquals("$windowWidth: $label is selected or not", index == SELECTED, node.config[SemanticsProperties.Selected])
                assertTrue("$windowWidth: $label is narrower than 48dp", node.size.width >= px(ShkSpacing.MinTouchTarget))
                assertTrue("$windowWidth: $label is lower than 48dp", node.size.height >= px(ShkSpacing.MinTouchTarget))
            }
            // Icons are decorative: nothing in the bar or rail has a description.
            compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription), useUnmergedTree = true)
                .assertCountEquals(0)
            compose.onNode(hasText(LABELS[2])).performClick()
        }
        compose.runOnIdle { assertEquals("A tap selects the destination's index", listOf(2, 2), selections) }
    }

    @Test
    fun aLongLabelWrapsInsideItsDestination() {
        var width by mutableStateOf(ShkWindowWidth.Compact)
        compose.setContent { ShkTheme { Frame(width, labels = LONG_LABELS) } }

        listOf(ShkWindowWidth.Compact, ShkWindowWidth.Medium).forEach { windowWidth ->
            compose.runOnIdle { width = windowWidth }
            val tab = compose.onNode(hasText(LONG_LABEL)).fetchSemanticsNode().boundsInRoot
            val text = compose.onNode(hasText(LONG_LABEL), useUnmergedTree = true).fetchSemanticsNode()
            val layout = layoutOf(text)
            assertTrue("$windowWidth: the long label should wrap in this test", layout.lineCount > 1)
            assertFalse("$windowWidth: the label is cut off by its own layout", layout.hasVisualOverflow)
            assertTrue(
                "$windowWidth: the label, ${text.boundsInRoot}, is outside its destination, $tab",
                tab.containsOrTouches(text.boundsInRoot),
            )
        }
    }

    @Test
    fun theContentKeepsItsStateWhenTheBarBecomesARail() {
        var width by mutableStateOf(ShkWindowWidth.Compact)
        val seen = mutableSetOf<Any>()
        compose.setContent {
            ShkTheme {
                ShkNavigationScaffold(
                    destinations = destinations(LABELS),
                    selectedIndex = SELECTED,
                    onSelect = {},
                    windowWidth = width,
                ) {
                    val state = remember { Any() }
                    SideEffect { seen += state }
                }
            }
        }

        compose.runOnIdle { width = ShkWindowWidth.Medium }
        compose.runOnIdle { width = ShkWindowWidth.Compact }
        compose.runOnIdle { assertEquals("The content's remembered state should survive", 1, seen.size) }
    }

    private fun show(windowWidth: ShkWindowWidth) {
        compose.setContent { ShkTheme { Frame(windowWidth) } }
    }

    /** The scaffold in a space the size of the screenshot phone, with content that fills it. */
    @Composable
    private fun Frame(windowWidth: ShkWindowWidth, labels: List<String> = LABELS, onSelect: (Int) -> Unit = {}) {
        Box(Modifier.size(PHONE_WIDTH, PHONE_HEIGHT).testTag(FRAME)) {
            ShkNavigationScaffold(
                destinations = destinations(labels),
                selectedIndex = SELECTED,
                onSelect = onSelect,
                windowWidth = windowWidth,
            ) {
                Box(Modifier.fillMaxSize().testTag(CONTENT))
            }
        }
    }

    private fun destinations(labels: List<String>): List<ShkDestination> =
        labels.map { ShkDestination(label = it, icon = BlankIcon()) }

    /** The bounds of every destination, in order. */
    private fun tabs(): List<Rect> =
        compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab))
            .fetchSemanticsNodes()
            .map { it.boundsInRoot }

    private fun px(dp: Dp): Float = with(compose.density) { dp.toPx() }

    private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot

    private fun texts(node: SemanticsNode): List<String> =
        node.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
            node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val FRAME = "frame"
        private const val CONTENT = "content"
        private const val SELECTED = 1
        private const val LONG_LABEL = "Water by week and month"
        private val LABELS = listOf("Today", "History", "Goals")
        private val LONG_LABELS = listOf("Today", LONG_LABEL, "Goals")

        /** The screenshot phone. */
        private val PHONE_WIDTH = 411.dp
        private val PHONE_HEIGHT = 600.dp

        /** The rail's width at the default font size. */
        private val RAIL_WIDTH = 80.dp
    }
}

/** Like [Rect.contains] for a whole rectangle, but touching an edge, give or take half a pixel, counts as inside. */
private fun Rect.containsOrTouches(other: Rect): Boolean =
    other.left >= left - 0.5f && other.top >= top - 0.5f && other.right <= right + 0.5f && other.bottom <= bottom + 0.5f
