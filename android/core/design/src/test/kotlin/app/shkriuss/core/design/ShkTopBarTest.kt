package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
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
 * Checks [ShkTopBar] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - TalkBack reads the title as a heading, the Back button as "Back" and
 *   each action by its label, each once, as buttons. A tap calls each one,
 *   and an action turned off is read as disabled.
 * - The title starts at the screen margin, and the icons of the Back
 *   button and the last action sit on the margins, at the narrow and the
 *   wide margin.
 * - A long title wraps between the buttons, is not cut, and makes the bar
 *   taller. The buttons stay centred on it.
 *
 * The screen is the tablet of the screenshot tests, so bars can be given
 * a narrow and a wide space at once. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w1280dp-h800dp")
class ShkTopBarTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun talkBackHearsTheTitleAsAHeadingAndEveryButtonByItsLabel() {
        var backs = 0
        var searches = 0
        show {
            Box(Modifier.width(PHONE_WIDTH)) {
                ShkTopBar(
                    title = TITLE,
                    onBack = { backs++ },
                    actions = listOf(
                        ShkTopBarAction(icon = BlankIcon(), label = SEARCH, onClick = { searches++ }),
                        ShkTopBarAction(icon = BlankIcon(), label = ADD, onClick = {}, enabled = false),
                    ),
                )
            }
        }

        compose.onNode(hasText(TITLE)).assert(isHeading())
        listOf(BACK, SEARCH, ADD).forEach { label ->
            compose.onAllNodes(hasContentDescription(label), useUnmergedTree = true).assertCountEquals(1)
            compose.onNode(hasContentDescription(label))
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
        }
        compose.onNode(hasContentDescription(BACK)).assertIsEnabled().performClick()
        compose.onNode(hasContentDescription(SEARCH)).assertIsEnabled().performClick()
        compose.onNode(hasContentDescription(ADD)).assertIsNotEnabled()
        compose.runOnIdle {
            assertEquals("A tap on Back calls onBack", 1, backs)
            assertEquals("A tap on an action calls it", 1, searches)
        }
    }

    @Test
    fun theTitleStartsAtTheMarginWithoutButtonsAndTheBarIsAtLeast64DpTall() {
        show {
            Column {
                SPACES.forEach { space -> Box(Modifier.width(space.width).testTag(space.tag)) { ShkTopBar(title = TITLE) } }
            }
        }

        SPACES.forEach { space ->
            compose.onNodeWithTag(space.tag).assertHeightIsAtLeast(64.dp)
            assertEquals(
                "In ${space.width} the title should start at the margin",
                bounds(space.tag).left + px(space.margin),
                title(space.tag).boundsInRoot.left,
                1f,
            )
        }
    }

    @Test
    fun theIconsOfTheButtonsSitOnTheMargins() {
        show {
            Column {
                SPACES.forEach { space ->
                    Box(Modifier.width(space.width).testTag(space.tag)) {
                        ShkTopBar(
                            title = TITLE,
                            onBack = {},
                            actions = listOf(
                                ShkTopBarAction(icon = BlankIcon(), label = SEARCH, onClick = {}),
                                ShkTopBarAction(icon = BlankIcon(), label = ADD, onClick = {}),
                            ),
                        )
                    }
                }
            }
        }

        val halfIcon = px(ICON_SIZE) / 2
        SPACES.forEach { space ->
            val bar = bounds(space.tag)
            val back = button(BACK, space.tag)
            val add = button(ADD, space.tag)
            // A button's 24dp icon is centred on it.
            assertEquals("In ${space.width} the Back icon should start at the margin", bar.left + px(space.margin), back.center.x - halfIcon, 1f)
            assertEquals("In ${space.width} the last icon should end at the margin", bar.right - px(space.margin), add.center.x + halfIcon, 1f)
            assertEquals(
                "In ${space.width} the title should start where Back's touch target ends",
                back.center.x + px(ShkSpacing.MinTouchTarget) / 2,
                title(space.tag).boundsInRoot.left,
                1f,
            )
        }
    }

    @Test
    fun aLongTitleWrapsBetweenTheButtonsAndTheBarGrows() {
        show {
            Box(Modifier.width(NARROW_WIDTH).testTag(NARROW)) {
                ShkTopBar(
                    title = LONG_TITLE,
                    onBack = {},
                    actions = listOf(
                        ShkTopBarAction(icon = BlankIcon(), label = SEARCH, onClick = {}),
                        ShkTopBarAction(icon = BlankIcon(), label = ADD, onClick = {}),
                    ),
                )
            }
        }

        val bar = bounds(NARROW)
        val title = title(NARROW)
        val layout = layoutOf(title)
        assertTrue("The long title should wrap in this test", layout.lineCount > 1)
        assertFalse("The title is cut off by its own layout", layout.hasVisualOverflow)
        assertTrue("The bar should grow past 64dp", bar.height > px(64.dp))
        assertTrue("The title, ${title.boundsInRoot}, is outside the bar, $bar", bar.containsOrTouches(title.boundsInRoot))

        val halfTarget = px(ShkSpacing.MinTouchTarget) / 2
        val back = button(BACK, NARROW)
        val search = button(SEARCH, NARROW)
        assertTrue("The title should start after Back's touch target", title.boundsInRoot.left >= back.center.x + halfTarget - 1f)
        assertTrue("The title should end before the actions' touch targets", title.boundsInRoot.right <= search.center.x - halfTarget + 1f)
        listOf(back, search).forEach { button ->
            assertEquals("The buttons should stay centred on the title", title.boundsInRoot.center.y, button.center.y, 1f)
        }
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun px(dp: Dp): Float = with(compose.density) { dp.toPx() }

    private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot

    private fun button(label: String, tag: String): Rect =
        compose.onNode(hasContentDescription(label) and hasAnyAncestor(hasTestTag(tag))).fetchSemanticsNode().boundsInRoot

    private fun title(tag: String): SemanticsNode =
        compose.onNode(isHeading() and hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).fetchSemanticsNode()

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    /** A space a bar is drawn in, and the screen margin it should use there. */
    private class Space(val tag: String, val width: Dp, val margin: Dp)

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val NARROW = "narrow"
        private const val TITLE = "Notes"
        private const val LONG_TITLE = "Ideas for the week in the mountains next summer"
        private const val BACK = "Back"
        private const val SEARCH = "Search"
        private const val ADD = "New note"

        /** The width of the screenshot phone. */
        private val PHONE_WIDTH = 411.dp

        /** Narrower than any phone, so a long title wraps at every font scale. */
        private val NARROW_WIDTH = 300.dp

        /** The size of an icon in an icon button. */
        private val ICON_SIZE = 24.dp

        /** The phone, under 600dp, with the narrow margin, and a space from 600dp, with the wide one. */
        private val SPACES = listOf(
            Space("phone", PHONE_WIDTH, ShkSpacing.ScreenMargin),
            Space("wide", 700.dp, ShkSpacing.ScreenMarginWide),
        )
    }
}

/** Like [Rect.contains] for a whole rectangle, but touching an edge, give or take half a pixel, counts as inside. */
private fun Rect.containsOrTouches(other: Rect): Boolean =
    other.left >= left - 0.5f && other.top >= top - 0.5f && other.right <= right + 0.5f && other.bottom <= bottom + 0.5f
