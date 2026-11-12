package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Checks [ShkListDetailScaffold]:
 *
 * - In a compact or a medium window it shows one pane: the list, or the
 *   detail in its place while it is open. The detail gets a Back action,
 *   and its top bar shows a Back button that closes it. The back gesture
 *   closes it too, and only while it is open.
 * - In an expanded window it shows the list, 360dp wide, beside the
 *   detail, which fills the rest. The detail gets no Back action, so its
 *   top bar has no Back button, and the back gesture is left alone.
 * - The list keeps its saved state while the detail covers it, and when
 *   the window changes between one pane and two. An open detail keeps its
 *   state when the window changes, and starts fresh when opened again.
 *
 * The screen is the tablet of the screenshot tests, wide enough for two
 * panes. Font size does not change any of this.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w1280dp-h800dp")
class ShkListDetailScaffoldTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale = 1f)).around(compose)

    private var width by mutableStateOf(ShkWindowWidth.Compact)
    private var open by mutableStateOf(false)
    private var detailBack: (() -> Unit)? = null

    /** Each state the detail remembered, so a test can tell whether it was kept. */
    private val detailStates = mutableSetOf<Any>()

    @Test
    fun onePaneShowsTheListOrTheDetailInItsPlace() {
        show()

        listOf(ShkWindowWidth.Compact, ShkWindowWidth.Medium).forEach { windowWidth ->
            compose.runOnIdle {
                width = windowWidth
                open = false
            }
            compose.onNodeWithTag(LIST).assertIsDisplayed()
            compose.onAllNodes(hasTestTag(DETAIL)).assertCountEquals(0)

            compose.runOnIdle { open = true }
            compose.onAllNodes(hasTestTag(LIST)).assertCountEquals(0)
            assertEquals("$windowWidth: the detail should fill the pane", bounds(FRAME), bounds(DETAIL))
            compose.runOnIdle { assertNotNull("$windowWidth: the detail should get a Back action", detailBack) }

            compose.onNode(hasContentDescription(BACK)).performClick()
            compose.runOnIdle { assertFalse("$windowWidth: Back in the top bar should close the detail", open) }
            compose.onNodeWithTag(LIST).assertIsDisplayed()
        }
    }

    @Test
    fun theBackGestureClosesTheDetailInOnePaneOnly() {
        show()
        val dispatcher = compose.activity.onBackPressedDispatcher

        compose.runOnIdle { assertFalse("With the list shown, back should leave the screen", dispatcher.hasEnabledCallbacks()) }

        compose.runOnIdle { open = true }
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.runOnIdle { assertFalse("The back gesture should close the detail", open) }
        compose.onNodeWithTag(LIST).assertIsDisplayed()

        compose.runOnIdle {
            width = ShkWindowWidth.Expanded
            open = true
        }
        compose.runOnIdle { assertFalse("In two panes, back should leave the screen", dispatcher.hasEnabledCallbacks()) }
    }

    @Test
    fun twoPanesShowTheListBesideTheDetail() {
        show()
        compose.runOnIdle { width = ShkWindowWidth.Expanded }

        listOf(false, true).forEach { isOpen ->
            compose.runOnIdle { open = isOpen }
            val frame = bounds(FRAME)
            val list = bounds(LIST)
            val detail = bounds(DETAIL)
            assertEquals("The list should start at the start edge", frame.left, list.left, 1f)
            assertEquals("The list pane should be 360dp wide", px(360.dp), list.width, 1f)
            assertEquals("The detail should start where the list ends", list.right, detail.left, 1f)
            assertEquals("The detail should fill the rest", frame.right, detail.right, 1f)
            assertEquals("Both panes should fill the height", frame.height, list.height, 1f)
            assertEquals("Both panes should fill the height", frame.height, detail.height, 1f)
            compose.runOnIdle { assertNull("In two panes the detail gets no Back action", detailBack) }
            compose.onAllNodes(hasContentDescription(BACK)).assertCountEquals(0)
        }
    }

    @Test
    fun theListKeepsItsSavedStateWhileTheDetailCoversIt() {
        show()
        repeat(3) { compose.onNodeWithTag(COUNTER).performClick() }
        compose.onNodeWithText("$COUNT 3").assertIsDisplayed()

        compose.runOnIdle { open = true }
        compose.runOnIdle { open = false }
        compose.onNodeWithText("$COUNT 3").assertIsDisplayed()

        compose.runOnIdle { width = ShkWindowWidth.Expanded }
        compose.onNodeWithText("$COUNT 3").assertIsDisplayed()
        compose.runOnIdle { width = ShkWindowWidth.Medium }
        compose.onNodeWithText("$COUNT 3").assertIsDisplayed()
    }

    @Test
    fun anOpenDetailKeepsItsStateWhenTheWindowChangesAndOpensFreshAfterClosing() {
        show()
        compose.runOnIdle { open = true }
        compose.runOnIdle { width = ShkWindowWidth.Expanded }
        compose.runOnIdle { width = ShkWindowWidth.Compact }
        compose.runOnIdle { assertEquals("The open detail should keep its state", 1, detailStates.size) }

        compose.runOnIdle { open = false }
        compose.runOnIdle { open = true }
        compose.runOnIdle { assertEquals("A detail opened again should start fresh", 2, detailStates.size) }
    }

    /**
     * The scaffold in a space as large as the screen. The list holds a
     * counter kept with rememberSaveable. The detail records the Back
     * action it gets and puts it in a top bar.
     */
    private fun show() {
        compose.setContent {
            ShkTheme {
                Box(Modifier.size(FRAME_WIDTH, FRAME_HEIGHT).testTag(FRAME)) {
                    ShkListDetailScaffold(
                        detailOpen = open,
                        onCloseDetail = { open = false },
                        list = {
                            Box(Modifier.fillMaxSize().testTag(LIST)) {
                                var count by rememberSaveable { mutableIntStateOf(0) }
                                ShkText(text = "$COUNT $count", modifier = Modifier.testTag(COUNTER).clickable { count++ })
                            }
                        },
                        detail = { onBack ->
                            detailBack = onBack
                            val state = remember { Any() }
                            SideEffect { detailStates += state }
                            Box(Modifier.fillMaxSize().testTag(DETAIL)) {
                                ShkTopBar(title = DETAIL_TITLE, onBack = onBack)
                            }
                        },
                        windowWidth = width,
                    )
                }
            }
        }
    }

    private fun px(dp: Dp): Float = with(compose.density) { dp.toPx() }

    private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot

    private companion object {
        const val FRAME = "frame"
        const val LIST = "list"
        const val DETAIL = "detail"
        const val COUNTER = "counter"
        const val COUNT = "Count"
        const val BACK = "Back"
        const val DETAIL_TITLE = "Shopping list"

        /** Wide enough for two panes. */
        val FRAME_WIDTH = 1000.dp
        val FRAME_HEIGHT = 700.dp
    }
}
