package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
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
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkSlider] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - the slider takes at least 48dp under its text, so its touch target
 *   is that tall,
 * - TalkBack hears its label and its value in words, once, from the
 *   slider itself, and not a percentage,
 * - moving it reaches the caller at a step, and turned off it is read as
 *   disabled,
 * - a long label wraps and is not cut.
 *
 * Graphics run natively, so text is measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkSliderTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun takesA48dpTouchTargetAndTalkBackHearsTheLabelAndTheValueOnce() {
        compose.setContent {
            ShkTheme { Box(Modifier.testTag(TARGET)) { GoalSlider(value = 8f, onValueChange = {}) } }
        }

        // The slider is drawn 44dp tall. Material 3 reserves at least 48dp
        // around it, under the text, and a touch anywhere in it counts.
        val bottom = compose.onNodeWithTag(TARGET).fetchSemanticsNode().boundsInRoot.bottom
        val textBottom = maxOf(textNode(LABEL).boundsInRoot.bottom, textNode(VALUE).boundsInRoot.bottom)
        val space = with(compose.density) { (bottom - textBottom).toDp() }
        assertTrue("The slider takes $space under its text, less than 48dp", space >= ShkSpacing.MinTouchTarget)
        val slider = compose.onNode(IS_SLIDER).assertIsEnabled()
        val config = slider.fetchSemanticsNode().config
        assertEquals(listOf(LABEL), config[SemanticsProperties.ContentDescription])
        assertEquals(VALUE, config[SemanticsProperties.StateDescription])
        assertEquals(ProgressBarRangeInfo(8f, RANGE, STEPS), config[SemanticsProperties.ProgressBarRangeInfo])
        // The same words, shown above the slider, are hidden from TalkBack.
        listOf(LABEL, VALUE).forEach { text ->
            assertTrue(
                "\"$text\" above the slider should be hidden from TalkBack",
                SemanticsProperties.HideFromAccessibility in textNode(text).config,
            )
        }
    }

    @Test
    fun movingItReachesTheCallerAtAStep() {
        var value by mutableFloatStateOf(8f)
        compose.setContent {
            ShkTheme { GoalSlider(value = value, onValueChange = { value = it }) }
        }

        compose.onNode(IS_SLIDER).performSemanticsAction(SemanticsActions.SetProgress) { setProgress ->
            setProgress(10.4f)
        }
        compose.runOnIdle { assertEquals(10f, value, 0.001f) }
    }

    @Test
    fun turnedOffItTellsTalkBack() {
        compose.setContent {
            ShkTheme { GoalSlider(value = 8f, onValueChange = {}, enabled = false) }
        }

        compose.onNode(IS_SLIDER).assertIsNotEnabled()
    }

    @Test
    fun longLabelWrapsAndIsNotCut() {
        compose.setContent {
            ShkTheme {
                Box(Modifier.width(NARROW_WIDTH).testTag(TARGET)) {
                    GoalSlider(value = 8f, onValueChange = {}, label = LONG_LABEL)
                }
            }
        }

        val bounds = compose.onNodeWithTag(TARGET).fetchSemanticsNode().boundsInRoot
        val label = textNode(LONG_LABEL)
        val layouts = mutableListOf<TextLayoutResult>()
        label.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val layout = layouts.single()
        assertTrue("The long label should wrap in this test", layout.lineCount > 1)
        assertFalse("The label is cut off by its own layout", layout.hasVisualOverflow)
        val value = textNode(VALUE).boundsInRoot
        assertTrue("The value should sit next to the label, not on it", value.left >= label.boundsInRoot.right)
        assertTrue("The value is outside the slider's space", value.right <= bounds.right)
    }

    private fun textNode(text: String): SemanticsNode =
        compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode()

    /** The sample slider: a daily goal of one to twelve glasses, now at eight. */
    @Composable
    private fun GoalSlider(
        value: Float,
        onValueChange: (Float) -> Unit,
        enabled: Boolean = true,
        label: String = LABEL,
    ) {
        ShkSlider(
            label = label,
            value = value,
            onValueChange = onValueChange,
            valueText = VALUE,
            enabled = enabled,
            valueRange = RANGE,
            steps = STEPS,
        )
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private val IS_SLIDER = SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress)

        private const val TARGET = "slider"
        private const val LABEL = "Daily goal"
        private const val LONG_LABEL = "How many glasses you want to drink every day"
        private const val VALUE = "8 glasses"

        /** One to twelve glasses, in whole glasses: ten steps between the ends. */
        private val RANGE = 1f..12f
        private const val STEPS = 10

        /** Narrower than any phone, so long text wraps at every font scale. */
        private val NARROW_WIDTH = 200.dp
    }
}
