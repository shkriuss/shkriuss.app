package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks where rows put their content, at font scale 1.0 and 2.0 (owner
 * decision on pull request 15):
 *
 * - the text of a list item, a section header and a switch row starts at
 *   the edge of the space it is given, where the page title and all other
 *   text start,
 * - the touch target of every row that can be tapped, a list item and the
 *   row of a checkbox, switch or radio button, reaches 8dp past both edges
 *   of that space, and no further.
 *
 * The space has a margin around it, as a screen has, so nothing reaches
 * past the window.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkRowEdgeTest(private val case: RowCase, private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun textStartsAtTheEdgeOfItsSpace() {
        assumeTrue("$case puts a control before its text", case.textFirst)
        showInSpace()

        val space = compose.onNodeWithTag(SPACE).fetchSemanticsNode().boundsInRoot
        val text = compose.onNode(hasText(LABEL), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals("$case: the text should start at the edge of its space", space.left, text.left, 0.5f)
    }

    @Test
    fun onlyTheTouchTargetReachesPastTheEdges() {
        assumeTrue("$case cannot be tapped", case.tappable)
        showInSpace()

        val space = compose.onNodeWithTag(SPACE).fetchSemanticsNode().boundsInRoot
        val target = compose.onNode(hasClickAction()).fetchSemanticsNode().boundsInRoot
        val reach = with(compose.density) { REACH.toPx() }
        assertEquals("$case: the touch target should start 8dp before the space", space.left - reach, target.left, 0.5f)
        assertEquals("$case: the touch target should end 8dp after the space", space.right + reach, target.right, 0.5f)
    }

    private fun showInSpace() {
        compose.setContent {
            ShkTheme {
                Box(Modifier.padding(horizontal = MARGIN).testTag(SPACE)) { case.content(LABEL) }
            }
        }
    }

    /** One kind of row, drawn with a label. */
    class RowCase(
        private val name: String,
        /** True when the label is the first thing in the row. */
        val textFirst: Boolean,
        /** True when the whole row is one touch target. */
        val tappable: Boolean,
        val content: @Composable (label: String) -> Unit,
    ) {
        override fun toString(): String = name
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}, font {1}")
        fun parameters(): List<Array<Any>> =
            CASES.flatMap { case -> listOf(1.0f, 2.0f).map { arrayOf(case, it) } }

        private const val SPACE = "space"
        private const val LABEL = "Daily reminder"

        /** A screen margin around the space, wider than the reach. */
        private val MARGIN = 16.dp

        /** How far a row's touch target reaches past its space. */
        private val REACH = 8.dp

        private val CASES = listOf(
            RowCase("ListItem", textFirst = true, tappable = false) { label ->
                ShkListItem(headline = label, trailingText = "9:00")
            },
            RowCase("TappableListItem", textFirst = true, tappable = true) { label ->
                ShkListItem(headline = label, trailingText = "9:00", onClick = {})
            },
            RowCase("SectionHeader", textFirst = true, tappable = false) { label ->
                ShkSectionHeader(text = label)
            },
            RowCase("Switch", textFirst = true, tappable = true) { label ->
                ShkSwitch(text = label, checked = true, onCheckedChange = {})
            },
            RowCase("Checkbox", textFirst = false, tappable = true) { label ->
                ShkCheckbox(text = label, checked = true, onCheckedChange = {})
            },
            RowCase("RadioButton", textFirst = false, tappable = true) { label ->
                ShkRadioButton(text = label, selected = true, onClick = {})
            },
        )
    }
}
