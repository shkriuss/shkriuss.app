package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
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
 * Checks snackbars, [ShkSnackbarHostState] shown on a [ShkScreen], at font
 * scale 1.0 and 2.0, for the rules in CLAUDE.md, "UI and accessibility":
 *
 * - A snackbar is a polite live region, so TalkBack announces it. It goes
 *   away by itself, and says it was dismissed.
 * - Its action is read as a button, has a 48dp touch target, and a tap on
 *   it says the action was performed.
 * - The action sits beside a message of one line, and under a longer one,
 *   at the end. The message wraps and is not cut.
 * - On a screen, the floating action button sits in the bottom end corner,
 *   on the margins, and a snackbar appears above it without moving it. A
 *   scrolling screen leaves room under its content for the button.
 *
 * The screen is the screenshot phone. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkSnackbarTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun aSnackbarIsAnnouncedAndGoesAwayByItself() {
        val state = ShkSnackbarHostState()
        var result: ShkSnackbarResult? = null
        lateinit var scope: CoroutineScope
        show {
            scope = rememberCoroutineScope()
            ShkScreen(snackbarHostState = state) { ShkText(CONTENT) }
        }

        compose.mainClock.autoAdvance = false
        compose.runOnIdle { scope.launch { result = state.show(SAVED) } }
        compose.mainClock.advanceTimeBy(APPEARS_MILLIS)
        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(polite and hasAnyDescendant(hasText(SAVED))).assertExists()

        // Without an action it shows for 4 seconds.
        compose.mainClock.advanceTimeBy(SHORT_MILLIS)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        compose.onAllNodes(hasText(SAVED)).assertCountEquals(0)
        assertEquals(ShkSnackbarResult.Dismissed, result)
    }

    @Test
    fun aTapOnTheActionSaysItWasPerformed() {
        val state = ShkSnackbarHostState()
        var result: ShkSnackbarResult? = null
        lateinit var scope: CoroutineScope
        show {
            scope = rememberCoroutineScope()
            ShkScreen(snackbarHostState = state) { ShkText(CONTENT) }
        }

        compose.runOnIdle { scope.launch { result = state.show(DELETED, actionText = UNDO) } }
        compose.onAllNodes(hasText(UNDO), useUnmergedTree = true).assertCountEquals(1)
        // The snackbar holds the button's 48dp touch target.
        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(polite).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        compose.onNode(hasText(UNDO))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .performClick()
        compose.waitForIdle()
        assertEquals(ShkSnackbarResult.ActionPerformed, result)
        compose.onAllNodes(hasText(DELETED)).assertCountEquals(0)
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun theActionSitsBesideOneLineAndUnderALongerMessage() {
        show {
            Box(Modifier.width(NARROW_WIDTH)) {
                Column {
                    ShkSnackbarInPlace(message = DELETED, actionText = UNDO, modifier = Modifier.testTag(SHORT))
                    ShkSnackbarInPlace(message = LONG_MESSAGE, actionText = UNDO, modifier = Modifier.testTag(LONG))
                }
            }
        }

        val shortMessage = textBounds(DELETED)
        val shortAction = actionBounds(SHORT)
        assertEquals("The action should be centred on a short message", shortMessage.center.y, shortAction.center.y, 1f)
        assertTrue("The action should be beside a short message", shortAction.left >= shortMessage.right)

        val longMessage = compose.onNode(hasText(LONG_MESSAGE), useUnmergedTree = true).fetchSemanticsNode()
        val layout = layoutOf(longMessage)
        assertTrue("The long message should wrap in this test", layout.lineCount > 1)
        assertFalse("The long message is cut off by its own layout", layout.hasVisualOverflow)
        val longAction = actionBounds(LONG)
        val panel = compose.onNodeWithTag(LONG).fetchSemanticsNode().boundsInRoot
        assertTrue("The action should be under a long message", longAction.top >= longMessage.boundsInRoot.bottom - 1f)
        assertTrue("The action should sit at the end", longAction.right > panel.center.x)
        assertTrue("The action should be inside the snackbar", panel.bottom >= longAction.bottom - 1f)
    }

    @Test
    fun theButtonSitsOnTheMarginsAndTheSnackbarAboveItWithoutMovingIt() {
        val state = ShkSnackbarHostState()
        lateinit var scope: CoroutineScope
        show {
            scope = rememberCoroutineScope()
            ShkScreen(
                modifier = Modifier.testTag(SCREEN),
                floatingActionButton = {
                    ShkFloatingActionButton(icon = BlankIcon(), contentDescription = NEW_NOTE, onClick = {})
                },
                snackbarHostState = state,
            ) { ShkText(CONTENT) }
        }

        val screen = compose.onNodeWithTag(SCREEN).fetchSemanticsNode().boundsInRoot
        val before = buttonBounds()
        assertEquals("The button should end at the margin", screen.right - px(ShkSpacing.ScreenMargin), before.right, 1f)
        assertEquals("The button should sit on the bottom margin", screen.bottom - px(ShkSpacing.ScreenMargin), before.bottom, 1f)

        compose.runOnIdle { scope.launch { state.show(DELETED, actionText = UNDO) } }
        compose.waitUntil { compose.onAllNodes(hasText(DELETED)).fetchSemanticsNodes().isNotEmpty() }
        val after = buttonBounds()
        assertEquals("The button should not move", before, after)
        val snackbar = compose.onNode(hasText(DELETED), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("The snackbar should be above the button", snackbar.bottom <= after.top)
        assertTrue("The snackbar should be inside the margins", snackbar.left >= screen.left + px(ShkSpacing.ScreenMargin))
    }

    @Test
    fun aScrollingScreenLeavesRoomForTheButton() {
        show {
            ShkScreen(
                scrollable = true,
                floatingActionButton = {
                    ShkFloatingActionButton(icon = BlankIcon(), contentDescription = NEW_NOTE, onClick = {})
                },
            ) {
                repeat(LINES) { ShkText("$LINE $it") }
            }
        }

        val page = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollBy))
        page.performScrollToEnd()
        val last = compose.onNode(hasText("$LINE ${LINES - 1}"), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("The last line should scroll clear of the button", last.bottom <= buttonBounds().top)
    }

    private fun SemanticsNodeInteraction.performScrollToEnd() {
        performSemanticsAction(SemanticsActions.ScrollBy) { scrollBy -> scrollBy(0f, Float.MAX_VALUE) }
        compose.waitForIdle()
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun px(dp: Dp): Float = with(compose.density) { dp.toPx() }

    private fun buttonBounds(): Rect = compose.onNode(hasContentDescription(NEW_NOTE)).fetchSemanticsNode().boundsInRoot

    private fun textBounds(text: String): Rect =
        compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot

    private fun actionBounds(tag: String): Rect =
        compose.onNode(hasText(UNDO) and hasAnyAncestor(hasTestTag(tag)))
            .fetchSemanticsNode()
            .boundsInRoot

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val CONTENT = "Notes"
        private const val SAVED = "Note saved"
        private const val DELETED = "Note deleted"
        private const val UNDO = "Undo"
        private const val NEW_NOTE = "New note"
        private const val LONG_MESSAGE = "The note was moved to the folder Home, and its reminder was turned off"
        private const val SCREEN = "screen"
        private const val SHORT = "short"
        private const val LONG = "long"
        private const val LINE = "Line"

        /** More lines than fit in the window at any font scale. */
        private const val LINES = 80

        /** Long enough for a snackbar to fade in. */
        private const val APPEARS_MILLIS = 1_000L

        /** How long a snackbar without an action shows, and a little more. */
        private const val SHORT_MILLIS = 4_500L

        /** A phone narrower than most, so a long message wraps. */
        private val NARROW_WIDTH = 320.dp
    }
}
