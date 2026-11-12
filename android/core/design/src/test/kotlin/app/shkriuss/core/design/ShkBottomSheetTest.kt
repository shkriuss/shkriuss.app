package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.Dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkBottomSheet] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - Its title is a heading. Its handle is read as "Drag handle", at
 *   least 48dp tall, and TalkBack's "Dismiss" on it closes the sheet.
 * - The title and the rows in it line up at the screen margin, as on a
 *   screen.
 * - A row in it is tapped as anywhere else.
 * - Content taller than the window scrolls, so the last row can be
 *   reached at font scale 2.0.
 * - When a row sets it not visible, it slides down before it goes, as for
 *   a swipe (owner decision on pull request 17). Shown again on the way
 *   down, it comes back up.
 *
 * The screen is the screenshot phone. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkBottomSheetTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun theTitleIsAHeadingAndTheHandleOffersDismiss() {
        var dismissed = 0
        show {
            ShkBottomSheet(visible = true, title = TITLE, onDismissRequest = { dismissed++ }) {
                ShkListItem(headline = DUPLICATE, onClick = {})
            }
        }

        compose.onNode(hasText(TITLE)).assert(isHeading())
        compose.onAllNodes(hasContentDescription(HANDLE)).assertCountEquals(1)
        compose.onNode(hasContentDescription(HANDLE))
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss))
            .performSemanticsAction(SemanticsActions.Dismiss)
        compose.runOnIdle { assertEquals("Dismiss on the handle closes the sheet", 1, dismissed) }
    }

    @Test
    fun theTitleAndTheRowsLineUpAtTheScreenMargin() {
        var taps = 0
        show {
            ShkBottomSheet(visible = true, title = TITLE, onDismissRequest = {}) {
                ShkListItem(headline = DUPLICATE, onClick = { taps++ })
            }
        }

        // The handle fills the width of the sheet.
        val sheet = compose.onNode(hasContentDescription(HANDLE)).fetchSemanticsNode().boundsInRoot
        val title = compose.onNode(hasText(TITLE), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val row = compose.onNode(hasText(DUPLICATE), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals("The title should start at the margin", sheet.left + px(ShkSpacing.ScreenMargin), title.left, 1f)
        assertEquals("The row's text should start at the margin", sheet.left + px(ShkSpacing.ScreenMargin), row.left, 1f)

        compose.onNode(hasText(DUPLICATE)).performClick()
        compose.runOnIdle { assertEquals("A row in a sheet is tapped as anywhere else", 1, taps) }
    }

    @Test
    fun contentTallerThanTheWindowScrolls() {
        show {
            ShkBottomSheet(visible = true, title = TITLE, onDismissRequest = {}) {
                repeat(ROWS) { index -> ShkListItem(headline = "$ROW ${index + 1}", supportingText = DUPLICATE, onClick = {}) }
            }
        }

        compose.onNode(hasScrollAction()).assertExists()
        compose.onNode(hasText("$ROW $ROWS")).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun aRowThatClosesTheSheetSlidesItDown() {
        var visible by mutableStateOf(true)
        var dismissed = 0
        show {
            ShkBottomSheet(visible = visible, title = TITLE, onDismissRequest = { dismissed++ }) {
                ShkListItem(headline = DUPLICATE, onClick = { visible = false })
            }
        }
        val open = handleTop()

        // The clock stands still, so the slide can be seen part of the way.
        compose.mainClock.autoAdvance = false
        compose.onNode(hasText(DUPLICATE)).performSemanticsAction(SemanticsActions.OnClick)
        // Where the handle is, frame by frame, for as long as it is there.
        val tops = mutableListOf<Float>()
        repeat(SLIDE_FRAMES) {
            compose.mainClock.advanceTimeByFrame()
            compose.onAllNodes(hasContentDescription(HANDLE)).fetchSemanticsNodes().forEach { tops += it.boundsInRoot.top }
        }
        assertTrue("The sheet should be seen part of the way down, not just gone: $tops", tops.any { it > open + 1f })

        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        compose.onAllNodes(hasContentDescription(HANDLE)).assertCountEquals(0)
        assertEquals("Closing it from its state is not a dismiss request", 0, dismissed)
    }

    @Test
    fun aSheetShownAgainWhileItSlidesDownComesBack() {
        var visible by mutableStateOf(true)
        show {
            ShkBottomSheet(visible = visible, title = TITLE, onDismissRequest = {}) {
                ShkListItem(headline = DUPLICATE, onClick = {})
            }
        }
        val open = handleTop()

        compose.mainClock.autoAdvance = false
        compose.runOnIdle { visible = false }
        compose.mainClock.advanceTimeBy(PART_OF_THE_SLIDE_MILLIS)
        compose.runOnIdle { visible = true }
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        assertEquals("The sheet should be open again", open, handleTop(), 1f)
    }

    private fun handleTop(): Float =
        compose.onNode(hasContentDescription(HANDLE)).fetchSemanticsNode().boundsInRoot.top

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun px(dp: Dp): Float = with(compose.density) { dp.toPx() }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TITLE = "Shopping list"
        private const val DUPLICATE = "Duplicate"
        private const val HANDLE = "Drag handle"
        private const val ROW = "Row"

        /** More rows than fit in the window at any font scale. */
        private const val ROWS = 30

        /** Long enough for the sheet to start sliding, shorter than the whole slide. */
        private const val PART_OF_THE_SLIDE_MILLIS = 100L

        /** About half a second of frames, longer than Material 3's slide. */
        private const val SLIDE_FRAMES = 30
    }
}
