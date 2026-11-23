package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.LayoutDirection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks the tick box at the start of a [ShkListItem]
 * (docs/apps/tasks/spec.md, "Changes to shared modules"), at font scale
 * 1.0 and 2.0:
 *
 * - it is a touch target of its own, at least 48 by 48 dp, beside the
 *   row's tap: a tap on it ticks, a tap on the text opens the row,
 * - its target starts where the row's own does, on the right in
 *   right-to-left languages, and the text comes after it,
 * - TalkBack reads the row as one item, with the state after its text,
 *   and offers the tick as an action, in the app's words when it gives
 *   them,
 * - a row that is turned off ignores a tap on its box and offers no tick,
 * - a row without `onCheckedChange` has no box.
 *
 * The taps are real touches at the middle of the box or the text, so
 * they show which part takes them. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkListItemTickBoxTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    private val box: SemanticsNodeInteraction
        get() = compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Checkbox))

    private val row: SemanticsNodeInteraction
        get() = compose.onNode(hasText(HEADLINE) and hasClickAction())

    @Test
    fun aTapOnTheBoxTicksItAndATapOnTheTextOpensTheRow() {
        var ticked by mutableStateOf(false)
        var opened = 0
        compose.setContent {
            ShkTheme {
                ShkListItem(headline = HEADLINE, onClick = { opened++ }, checked = ticked, onCheckedChange = { ticked = it })
            }
        }

        box.performClick()
        compose.runOnIdle {
            assertTrue("a tap on the box ticks it", ticked)
            assertEquals("a tap on the box does not open the row", 0, opened)
        }
        box.performClick()
        compose.runOnIdle { assertFalse("a second tap clears the tick", ticked) }
        row.performClick()
        compose.runOnIdle {
            assertEquals("a tap on the text opens the row", 1, opened)
            assertFalse("a tap on the text does not tick", ticked)
        }
    }

    @Test
    fun theBoxIsATouchTargetOfItsOwnFromTheEdgeOfTheRowsOwn() {
        showRow(LayoutDirection.Ltr)

        val target = box.fetchSemanticsNode().boundsInRoot
        val rowBounds = row.fetchSemanticsNode().boundsInRoot
        val text = compose.onNode(hasText(HEADLINE), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val least = with(compose.density) { ShkSpacing.MinTouchTarget.toPx() }
        assertTrue("the box is ${target.width} px wide, less than $least", target.width >= least - 0.5f)
        assertTrue("the box is ${target.height} px tall, less than $least", target.height >= least - 0.5f)
        assertEquals("the box starts where the row's target does", rowBounds.left, target.left, 1f)
        assertEquals("the box ends where the text starts", text.left, target.right, 1f)
    }

    @Test
    fun inRightToLeftLanguagesTheBoxIsOnTheRight() {
        showRow(LayoutDirection.Rtl)

        val target = box.fetchSemanticsNode().boundsInRoot
        val rowBounds = row.fetchSemanticsNode().boundsInRoot
        val text = compose.onNode(hasText(HEADLINE), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals("the box ends where the row's target does", rowBounds.right, target.right, 1f)
        assertTrue("the text ends where the box starts", text.right <= target.left + 1f)
    }

    @Test
    fun talkBackReadsTheRowAsOneItemWithItsStateAndOffersTheTick() {
        var ticked by mutableStateOf(false)
        compose.setContent {
            ShkTheme {
                ShkListItem(headline = HEADLINE, onClick = {}, checked = ticked, onCheckedChange = { ticked = it })
            }
        }

        box.assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.HideFromAccessibility))
        assertEquals("Not ticked", stateOf(row))
        tickAction(row, "Tick").invoke()
        compose.runOnIdle { assertTrue("the action ticks the box", ticked) }
        assertEquals("Ticked", stateOf(row))
        tickAction(row, "Clear the tick").invoke()
        compose.runOnIdle { assertFalse("the action clears the tick", ticked) }
    }

    @Test
    fun theAppGivesTheStateAndTheActionInItsOwnWords() {
        compose.setContent {
            ShkTheme {
                ShkListItem(
                    headline = HEADLINE,
                    onClick = {},
                    checked = false,
                    onCheckedChange = {},
                    checkedDescription = "not done",
                    checkActionLabel = "Mark as done",
                )
            }
        }

        assertEquals("not done", stateOf(row))
        tickAction(row, "Mark as done")
    }

    @Test
    fun aRowThatIsTurnedOffIgnoresATapOnItsBoxAndOffersNoTick() {
        var ticked = false
        compose.setContent {
            ShkTheme {
                ShkListItem(headline = HEADLINE, onClick = {}, enabled = false, checked = false, onCheckedChange = { ticked = it })
            }
        }

        box.performClick()
        compose.runOnIdle { assertFalse("a box that is turned off takes no tap", ticked) }
        val actions = compose.onNode(hasText(HEADLINE)).fetchSemanticsNode().config
            .getOrElse(SemanticsActions.CustomActions) { emptyList() }
        assertEquals("no tick is offered", emptyList<String>(), actions.map { it.label })
    }

    @Test
    fun aRowWithoutOnCheckedChangeHasNoBox() {
        compose.setContent { ShkTheme { ShkListItem(headline = HEADLINE, onClick = {}) } }

        assertEquals(0, compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Checkbox)).fetchSemanticsNodes().size)
        val config = row.fetchSemanticsNode().config
        assertFalse("no state", config.contains(SemanticsProperties.StateDescription))
        assertFalse("no tick", config.contains(SemanticsActions.CustomActions))
    }

    private fun showRow(direction: LayoutDirection) {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides direction) {
                ShkTheme { ShkListItem(headline = HEADLINE, onClick = {}, checked = false, onCheckedChange = {}) }
            }
        }
    }

    private fun stateOf(node: SemanticsNodeInteraction): String = node.fetchSemanticsNode().config[SemanticsProperties.StateDescription]

    /** The one action named [label] that the row offers. */
    private fun tickAction(node: SemanticsNodeInteraction, label: String): () -> Boolean {
        val actions = node.fetchSemanticsNode().config[SemanticsActions.CustomActions]
        assertEquals(listOf(label), actions.map { it.label })
        return actions.single().action
    }

    /** One run per font scale. */
    companion object {
        private const val HEADLINE = "Buy bread"

        /** Font scale 1.0 and 2.0. */
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Float> = listOf(1.0f, 2.0f)
    }
}
