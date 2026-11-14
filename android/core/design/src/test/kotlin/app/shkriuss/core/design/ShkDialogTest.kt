package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.activity.ComponentDialog
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
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
import org.robolectric.shadows.ShadowDialog

/**
 * Checks [ShkDialog] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - In its window it is a pane that TalkBack announces by its title, and
 *   the title is a heading. Each button is read once, by its text, as a
 *   button, with a 48dp touch target. Drawn in place it is no pane.
 * - A tap on a button calls it, then `onDismissRequest`. A button turned
 *   off is read as disabled and ignores taps.
 * - The buttons sit side by side when they fit, and one above the other,
 *   the confirm button on top, when they do not. Text wraps and is not cut.
 * - A dialog taller than the window scrolls, and its buttons stay in it.
 * - A third button sits between the way out and the confirm button, side
 *   by side or one above the other, is read once and closes the dialog.
 * - [ShkProgressDialog] is one item that TalkBack reads with "in progress"
 *   and announces once, has no button, and stays open after Back.
 *
 * The screen is the screenshot phone. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkDialogTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun talkBackAnnouncesTheTitleAndReadsEveryButtonOnce() {
        show {
            ShkDialog(
                title = TITLE,
                text = TEXT,
                confirmAction = ShkDialogAction(text = DELETE, onClick = {}, destructive = true),
                dismissAction = ShkDialogAction(text = CANCEL, onClick = {}),
                onDismissRequest = {},
            )
        }

        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, TITLE)).assertExists()
        compose.onNode(hasText(TITLE)).assert(isHeading())
        compose.onNode(hasText(TEXT)).assertExists()
        listOf(DELETE, CANCEL).forEach { label ->
            compose.onAllNodes(hasText(label), useUnmergedTree = true).assertCountEquals(1)
            compose.onNode(hasText(label)).assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
        }
        // Each is a ShkTextButton, which reserves 48dp around itself (see
        // ShkComponentsTest). Side by side, their 48dp do not overlap.
        assertTrue(
            "The buttons' touch targets overlap",
            bounds(DELETE).center.x - bounds(CANCEL).center.x >= px(ShkSpacing.MinTouchTarget),
        )
    }

    @Test
    fun aTapOnAButtonCallsItThenClosesTheDialog() {
        val calls = mutableListOf<String>()
        show {
            ShkDialog(
                title = TITLE,
                confirmAction = ShkDialogAction(text = DELETE, onClick = { calls += DELETE }),
                dismissAction = ShkDialogAction(text = CANCEL, onClick = { calls += CANCEL }),
                onDismissRequest = { calls += CLOSED },
            )
        }

        compose.onNode(hasText(DELETE)).performClick()
        compose.onNode(hasText(CANCEL)).performClick()
        compose.runOnIdle { assertEquals(listOf(DELETE, CLOSED, CANCEL, CLOSED), calls) }
    }

    @Test
    fun aButtonThatChecksFirstKeepsTheDialogOpenAndTalkBackHearsTheError() {
        val calls = mutableListOf<String>()
        show {
            var value by remember { mutableStateOf("12") }
            var error by remember { mutableStateOf<String?>(null) }
            var open by remember { mutableStateOf(true) }
            if (open) {
                ShkDialog(
                    title = GOAL,
                    confirmAction = ShkDialogAction(
                        text = SAVE,
                        onClick = {
                            calls += SAVE
                            if (value.toInt() < 500) error = GOAL_ERROR else open = false
                        },
                        closesDialog = false,
                    ),
                    dismissAction = ShkDialogAction(text = CANCEL, onClick = { calls += CANCEL }),
                    onDismissRequest = {
                        calls += CLOSED
                        open = false
                    },
                ) {
                    ShkTextField(value = value, onValueChange = { value = it }, label = "Goal", errorText = error)
                }
            }
        }
        val field = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText))

        compose.onNode(hasText(SAVE)).performClick()
        compose.runOnIdle { assertEquals("A tap only calls the action", listOf(SAVE), calls) }
        field.assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, GOAL_ERROR))

        field.performTextReplacement("2000")
        compose.onNode(hasText(SAVE)).performClick()
        compose.onNode(hasText(GOAL)).assertDoesNotExist()
        compose.runOnIdle { assertEquals("The caller closed it; the dialog did not", listOf(SAVE, SAVE), calls) }
    }

    @Test
    fun byDefaultEveryButtonClosesTheDialog() {
        assertTrue(ShkDialogAction(text = SAVE, onClick = {}).closesDialog)
    }

    @Test
    fun aButtonTurnedOffIsReadAsDisabledAndIgnoresTaps() {
        val calls = mutableListOf<String>()
        show {
            ShkDialog(
                title = TITLE,
                confirmAction = ShkDialogAction(text = DELETE, onClick = { calls += DELETE }, enabled = false),
                onDismissRequest = { calls += CLOSED },
            )
        }

        compose.onNode(hasText(DELETE)).assertIsNotEnabled().performClick()
        compose.runOnIdle { assertTrue("A button turned off does nothing", calls.isEmpty()) }
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun shortButtonsSitSideBySideAtTheEnd() {
        show {
            Box(Modifier.width(DIALOG_WIDTH)) {
                ShkDialogInPlace(
                    title = TITLE,
                    confirmAction = ShkDialogAction(text = DELETE, onClick = {}),
                    dismissAction = ShkDialogAction(text = CANCEL, onClick = {}),
                )
            }
        }

        // Drawn in place, it is no pane, so a page of samples is not announced.
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.PaneTitle)).assertCountEquals(0)
        val confirm = bounds(DELETE)
        val dismiss = bounds(CANCEL)
        assertEquals("The buttons should be in one row", confirm.center.y, dismiss.center.y, 1f)
        assertTrue("The confirm button should come last", confirm.left >= dismiss.right)
        assertEquals("The buttons should end at the dialog's padding", px(DIALOG_WIDTH) - px(DialogPadding), confirm.right, 1f)
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun longButtonsGoOneAboveTheOtherWithTheConfirmButtonOnTop() {
        show {
            Box(Modifier.width(DIALOG_WIDTH)) {
                ShkDialogInPlace(
                    title = LONG_TITLE,
                    text = LONG_TEXT,
                    confirmAction = ShkDialogAction(text = LONG_DELETE, onClick = {}),
                    dismissAction = ShkDialogAction(text = LONG_CANCEL, onClick = {}),
                )
            }
        }

        val confirm = bounds(LONG_DELETE)
        val dismiss = bounds(LONG_CANCEL)
        assertTrue("The confirm button should be above the other", confirm.bottom <= dismiss.top)
        assertTrue(
            "One above the other, the buttons' touch targets overlap",
            dismiss.center.y - confirm.center.y >= px(ShkSpacing.MinTouchTarget),
        )
        assertEquals("Both buttons should end at the same edge", confirm.right, dismiss.right, 1f)
        listOf(LONG_TITLE, LONG_TEXT).forEach { text ->
            assertFalse("\"$text\" is cut off by its own layout", layoutOf(textNode(text)).hasVisualOverflow)
        }
        // Compose narrows a centred label of one line to its text, and then
        // reports the width it was laid out in as overflow. So for the
        // labels, check that each lies inside its button and is not cut
        // at the bottom.
        listOf(LONG_DELETE to confirm, LONG_CANCEL to dismiss).forEach { (text, button) ->
            val label = textNode(text)
            assertFalse("\"$text\" is cut off at the bottom", layoutOf(label).didOverflowHeight)
            assertTrue("\"$text\" sticks out of its button", button.containsOrTouches(label.boundsInRoot))
        }
        assertTrue("The long title should wrap in this test", layoutOf(textNode(LONG_TITLE)).lineCount > 1)
    }

    @Test
    fun aDialogTallerThanTheWindowScrollsAndKeepsItsButtons() {
        show {
            ShkDialog(
                title = TITLE,
                text = List(VERY_LONG_REPEATS) { LONG_TEXT }.joinToString(" "),
                confirmAction = ShkDialogAction(text = DELETE, onClick = {}),
                dismissAction = ShkDialogAction(text = CANCEL, onClick = {}),
                onDismissRequest = {},
            )
        }

        compose.onNode(hasScrollAction()).assertExists()
        compose.onNode(hasText(DELETE)).assertIsDisplayed()
        compose.onNode(hasText(CANCEL)).assertIsDisplayed()
    }

    @Test
    fun aThirdButtonIsReadOnceAndATapCallsItThenClosesTheDialog() {
        val calls = mutableListOf<String>()
        show {
            ShkDialog(
                title = TITLE,
                confirmAction = ShkDialogAction(text = DELETE, onClick = { calls += DELETE }),
                dismissAction = ShkDialogAction(text = CANCEL, onClick = { calls += CANCEL }),
                otherAction = ShkDialogAction(text = HIDE, onClick = { calls += HIDE }),
                onDismissRequest = { calls += CLOSED },
            )
        }

        listOf(DELETE, HIDE, CANCEL).forEach { label ->
            compose.onAllNodes(hasText(label), useUnmergedTree = true).assertCountEquals(1)
            compose.onNode(hasText(label)).assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
        }
        compose.onNode(hasText(HIDE)).performClick()
        compose.runOnIdle { assertEquals(listOf(HIDE, CLOSED), calls) }
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun threeShortButtonsSitSideBySideWithTheThirdInTheMiddle() {
        show {
            Box(Modifier.width(WIDE_DIALOG_WIDTH)) {
                ShkDialogInPlace(
                    title = TITLE,
                    confirmAction = ShkDialogAction(text = YES, onClick = {}),
                    dismissAction = ShkDialogAction(text = NO, onClick = {}),
                    otherAction = ShkDialogAction(text = ASK, onClick = {}),
                )
            }
        }

        val confirm = bounds(YES)
        val other = bounds(ASK)
        val dismiss = bounds(NO)
        assertEquals("The three buttons should be in one row", confirm.center.y, dismiss.center.y, 1f)
        assertEquals("The three buttons should be in one row", confirm.center.y, other.center.y, 1f)
        assertTrue("The way out should come first", dismiss.right <= other.left)
        assertTrue("The confirm button should come last", other.right <= confirm.left)
        listOf(dismiss to other, other to confirm).forEach { (first, second) ->
            assertTrue("The buttons' touch targets overlap", second.center.x - first.center.x >= px(ShkSpacing.MinTouchTarget))
        }
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun threeLongButtonsGoOneAboveTheOtherWithTheWayOutLowest() {
        show {
            Box(Modifier.width(DIALOG_WIDTH)) {
                ShkDialogInPlace(
                    title = LONG_TITLE,
                    confirmAction = ShkDialogAction(text = LONG_DELETE, onClick = {}),
                    dismissAction = ShkDialogAction(text = LONG_CANCEL, onClick = {}),
                    otherAction = ShkDialogAction(text = LONG_HIDE, onClick = {}),
                )
            }
        }

        val confirm = bounds(LONG_DELETE)
        val other = bounds(LONG_HIDE)
        val dismiss = bounds(LONG_CANCEL)
        assertTrue("The confirm button should be on top", confirm.bottom <= other.top)
        assertTrue("The way out should be lowest", other.bottom <= dismiss.top)
        listOf(confirm to other, other to dismiss).forEach { (upper, lower) ->
            assertTrue("One above the other, the buttons' touch targets overlap", lower.center.y - upper.center.y >= px(ShkSpacing.MinTouchTarget))
            assertEquals("The buttons should end at the same edge", upper.right, lower.right, 1f)
        }
        listOf(LONG_DELETE to confirm, LONG_HIDE to other, LONG_CANCEL to dismiss).forEach { (text, button) ->
            val label = textNode(text)
            assertFalse("\"$text\" is cut off at the bottom", layoutOf(label).didOverflowHeight)
            assertTrue("\"$text\" sticks out of its button", button.containsOrTouches(label.boundsInRoot))
        }
    }

    @Test
    fun aProgressDialogIsOneItemInProgressAnnouncedOnceWithNoButton() {
        show { ShkProgressDialog(text = WRITING) }

        val config = compose.onNode(hasText(WRITING)).fetchSemanticsNode().config
        assertEquals(ProgressBarRangeInfo.Indeterminate, config[SemanticsProperties.ProgressBarRangeInfo])
        assertEquals("TalkBack announces the words when the dialog opens", LiveRegionMode.Polite, config[SemanticsProperties.LiveRegion])
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertCountEquals(1)
        // No title beside the words: a pane title would be announced as well, so the words would be heard twice.
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.PaneTitle)).assertCountEquals(0)
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun aProgressDialogStaysOpenAfterBack() {
        show { ShkProgressDialog(text = WRITING) }
        compose.onNode(hasText(WRITING)).assertIsDisplayed()

        val window = ShadowDialog.getLatestDialog() as ComponentDialog
        compose.runOnUiThread { window.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()

        assertTrue("Back must not close a progress dialog", window.isShowing)
        compose.onNode(hasText(WRITING)).assertIsDisplayed()
    }

    @Test
    fun aLongProgressTextWrapsAndIsNotCut() {
        show { ShkProgressDialog(text = LONG_TEXT) }

        val label = textNode(LONG_TEXT)
        assertFalse("The words are cut off", layoutOf(label).hasVisualOverflow)
        compose.onNode(hasText(LONG_TEXT)).assertIsDisplayed()
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun px(dp: androidx.compose.ui.unit.Dp): Float = with(compose.density) { dp.toPx() }

    private fun bounds(text: String): Rect = compose.onNode(hasText(text)).fetchSemanticsNode().boundsInRoot

    private fun textNode(text: String): SemanticsNode =
        compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode()

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TITLE = "Delete this note?"
        private const val TEXT = "It is deleted from this phone and cannot be brought back."
        private const val DELETE = "Delete"
        private const val CANCEL = "Cancel"
        private const val CLOSED = "closed"
        private const val HIDE = "Hide"
        private const val YES = "Yes"
        private const val NO = "No"
        private const val ASK = "Ask"
        private const val LONG_HIDE = "Hide them for a week"
        private const val WRITING = "Writing the backup"
        private const val GOAL = "Daily goal"
        private const val SAVE = "Save"
        private const val GOAL_ERROR = "Enter a goal from 500 to 10,000 ml."
        private const val LONG_TITLE = "Delete all the notes in this folder, and the folder itself?"
        private const val LONG_TEXT = "They are deleted from this phone and from every phone you sync with."
        private const val LONG_DELETE = "Delete them all for good"
        private const val LONG_CANCEL = "Keep every note"

        /** Enough copies of the long text to make the dialog taller than the window at any font scale. */
        private const val VERY_LONG_REPEATS = 40

        /** The narrowest a dialog gets, so long buttons do not fit side by side. */
        private val DIALOG_WIDTH = 280.dp

        /** Room for a dialog as wide as a phone lets it be, so three short buttons fit side by side at font scale 2.0 too. */
        private val WIDE_DIALOG_WIDTH = 380.dp
    }
}

/** Like [Rect.contains] for a whole rectangle, but touching an edge, give or take half a pixel, counts as inside. */
private fun Rect.containsOrTouches(other: Rect): Boolean =
    other.left >= left - 0.5f && other.top >= top - 0.5f && other.right <= right + 0.5f && other.bottom <= bottom + 0.5f
