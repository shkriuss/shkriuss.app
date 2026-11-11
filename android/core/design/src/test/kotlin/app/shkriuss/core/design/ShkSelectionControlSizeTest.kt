package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks how large the checkbox, the radio button and the switch are drawn
 * at font scale 1.0 and 2.0 (owner decision on pull request 14):
 *
 * - the checkbox and the radio button grow with the font size by the rule
 *   for an icon next to text, as a 20dp icon grows,
 * - the switch keeps its size.
 *
 * The control has no TalkBack node of its own, because its row takes the
 * tap. Its width is what the row leaves beside its text: the row's
 * padding and the gap to the text are [ShkSpacing.Small] and
 * [ShkSpacing.Medium].
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkSelectionControlSizeTest(private val case: ControlCase, private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun theCheckboxAndRadioButtonGrowLikeAnIconAndTheSwitchKeepsItsSize() {
        lateinit var density: Density
        compose.setContent {
            density = LocalDensity.current
            ShkTheme { case.content(LABEL) }
        }

        val drawn = controlWidth()
        val expected = if (case.grows) case.width * grownBy(density) else case.width
        assertEquals("$case at font scale $fontScale should be $expected wide, but is $drawn", expected.value, drawn.value, 1f)
        if (case.grows && fontScale > 1f) {
            assertTrue("$case should grow at font scale $fontScale, but is $drawn", drawn > case.width + 1.dp)
            assertTrue("$case grew more than twice, to $drawn", drawn <= case.width * 2)
        }
    }

    /** The width the row leaves for the control, at the start or the end of the row. */
    private fun controlWidth(): Dp {
        val row = compose.onNode(hasClickAction()).fetchSemanticsNode().boundsInRoot
        val text = compose.onNode(hasText(LABEL), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val padding = with(compose.density) { ShkSpacing.Small.toPx() }
        val gap = with(compose.density) { ShkSpacing.Medium.toPx() }
        val width = if (case.atStart) {
            text.left - gap - (row.left + padding)
        } else {
            row.right - padding - (text.right + gap)
        }
        return with(compose.density) { width.toDp() }
    }

    /** How much a 20dp icon next to text grows at this density's font size. */
    private fun grownBy(density: Density): Float {
        val grown = with(density) { CONTROL_SIZE.value.sp.toDp() }
        return maxOf(CONTROL_SIZE, grown) / CONTROL_SIZE
    }

    /**
     * One control in its row. [width] is the space Material 3 gives it at
     * the default font size, its drawing and its padding.
     */
    class ControlCase(
        private val name: String,
        val width: Dp,
        val atStart: Boolean,
        val grows: Boolean,
        val content: @Composable (label: String) -> Unit,
    ) {
        override fun toString(): String = name
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}, font {1}")
        fun parameters(): List<Array<Any>> =
            CASES.flatMap { case -> listOf(1.0f, 2.0f).map { arrayOf(case, it) } }

        private const val LABEL = "Remind me"

        /** The box of a checkbox and the ring of a radio button, as Material 3 draws them. */
        private val CONTROL_SIZE = 20.dp

        private val CASES = listOf(
            // 20dp, with 2dp of Material 3's padding on each side.
            ControlCase("Checkbox", width = 24.dp, atStart = true, grows = true) { label ->
                ShkCheckbox(text = label, checked = true, onCheckedChange = {})
            },
            ControlCase("RadioButton", width = 24.dp, atStart = true, grows = true) { label ->
                ShkRadioButton(text = label, selected = true, onClick = {})
            },
            ControlCase("Switch", width = 52.dp, atStart = false, grows = false) { label ->
                ShkSwitch(text = label, checked = true, onCheckedChange = {})
            },
        )
    }
}
