package app.shkriuss.core.design

import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsConfiguration
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
 * Checks [ShkTextField] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - it is at least 48 by 48 dp,
 * - TalkBack hears its label and its help once, and an error once, as the
 *   error,
 * - typing reaches the caller, and turned off it is read as disabled,
 * - a long label and long help wrap, are not cut, and stay inside the
 *   field, above and below a box at least 48dp tall. A label in the
 *   border, as Material 3 draws it, would stick out above the field,
 * - asked to, it tells the keyboard not to learn what is typed, and
 *   otherwise not.
 *
 * Graphics run natively, so text is measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkTextFieldTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun takesA48dpTouchTargetAndTalkBackHearsTheLabelAndTheHelpOnce() {
        compose.setContent {
            ShkTheme { ShkTextField(value = VALUE, onValueChange = {}, label = LABEL, supportingText = HELP) }
        }

        val field = compose.onNode(IS_TEXT_FIELD)
            .assertWidthIsAtLeast(ShkSpacing.MinTouchTarget)
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
            .assertIsEnabled()
        val config = field.fetchSemanticsNode().config
        assertEquals(listOf(LABEL, HELP), heard(config))
        assertEquals(VALUE, config[SemanticsProperties.EditableText].text)
        assertFalse("A field without an error should not be read as one", SemanticsProperties.Error in config)
    }

    @Test
    fun typingReachesTheCaller() {
        var value by mutableStateOf("")
        compose.setContent {
            ShkTheme { ShkTextField(value = value, onValueChange = { value = it }, label = LABEL) }
        }

        compose.onNode(IS_TEXT_FIELD).performTextInput(VALUE)
        compose.runOnIdle { assertEquals(VALUE, value) }
    }

    @Test
    fun turnedOffItTellsTalkBack() {
        compose.setContent {
            ShkTheme { ShkTextField(value = VALUE, onValueChange = {}, label = LABEL, enabled = false) }
        }

        compose.onNode(IS_TEXT_FIELD).assertIsNotEnabled()
    }

    @Test
    fun anErrorIsReadOnceAsTheErrorAndReplacesTheHelp() {
        compose.setContent {
            ShkTheme {
                ShkTextField(value = "", onValueChange = {}, label = LABEL, supportingText = HELP, errorText = ERROR)
            }
        }

        val config = compose.onNode(IS_TEXT_FIELD).fetchSemanticsNode().config
        assertEquals(ERROR, config[SemanticsProperties.Error])
        assertEquals("The error is read as the error, not also as text", listOf(LABEL), heard(config))
        compose.onAllNodes(hasText(HELP), useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun aSuffixShowsInTheBoxAndTalkBackHearsItsWordsWithTheLabel() {
        compose.setContent {
            ShkTheme {
                ShkTextField(
                    value = AMOUNT,
                    onValueChange = {},
                    label = AMOUNT_LABEL,
                    suffix = SUFFIX,
                    suffixDescription = SUFFIX_WORDS,
                )
            }
        }

        val field = compose.onNode(IS_TEXT_FIELD)
        val config = field.fetchSemanticsNode().config
        assertEquals(listOf(AMOUNT_LABEL, SUFFIX_WORDS), heard(config))
        assertEquals(AMOUNT, config[SemanticsProperties.EditableText].text)
        // The short unit is drawn inside the box, after the text, but is not read as well.
        compose.onAllNodes(hasText(SUFFIX), useUnmergedTree = true).assertCountEquals(0)
        val suffix = compose.onNode(hasText(SUFFIX_WORDS), useUnmergedTree = true).fetchSemanticsNode()
        val box = field.fetchSemanticsNode().boundsInRoot
        assertTrue("The suffix is inside the field", box.contains(suffix.boundsInRoot.center))
    }

    @Test
    fun withASuffixAnErrorIsStillReadOnceAsTheError() {
        compose.setContent {
            ShkTheme {
                ShkTextField(
                    value = "",
                    onValueChange = {},
                    label = AMOUNT_LABEL,
                    errorText = ERROR,
                    suffix = SUFFIX,
                    suffixDescription = SUFFIX_WORDS,
                )
            }
        }

        val config = compose.onNode(IS_TEXT_FIELD).fetchSemanticsNode().config
        assertEquals(ERROR, config[SemanticsProperties.Error])
        assertEquals(listOf(AMOUNT_LABEL, SUFFIX_WORDS), heard(config))
    }

    @Test
    fun withoutASuffixDescriptionTalkBackHearsTheSuffix() {
        compose.setContent {
            ShkTheme { ShkTextField(value = AMOUNT, onValueChange = {}, label = AMOUNT_LABEL, suffix = SUFFIX) }
        }

        assertEquals(listOf(AMOUNT_LABEL, SUFFIX), heard(compose.onNode(IS_TEXT_FIELD).fetchSemanticsNode().config))
    }

    @Test
    fun longLabelAndHelpWrapInsideTheFieldAroundTheBox() {
        compose.setContent {
            ShkTheme {
                Box(Modifier.width(NARROW_WIDTH)) {
                    ShkTextField(value = VALUE, onValueChange = {}, label = LONG_LABEL, supportingText = LONG_HELP)
                }
            }
        }

        val field = compose.onNode(IS_TEXT_FIELD).fetchSemanticsNode().boundsInRoot
        val label = textNode(LONG_LABEL)
        val help = textNode(LONG_HELP)
        listOf(label, help).forEach { node -> assertWrapsUncut(node, field) }
        val box = help.boundsInRoot.top - label.boundsInRoot.bottom
        assertTrue(
            "The space between the label and the help, $box px, should hold a box at least 48dp tall",
            box >= with(compose.density) { ShkSpacing.MinTouchTarget.toPx() },
        )
    }

    @Test
    fun askedNotToLearnTheFieldTellsTheKeyboardSoAndKeepsItsSuggestions() {
        compose.setContent {
            ShkTheme { ShkTextField(value = "", onValueChange = {}, label = LABEL, keyboardLearns = false) }
        }

        val info = keyboardRequest()
        assertTrue("no learning", info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        assertEquals("suggestions stay", 0, info.inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
    }

    @Test
    fun byDefaultTheFieldDoesNotAskTheKeyboardNotToLearn() {
        compose.setContent {
            ShkTheme { ShkTextField(value = "", onValueChange = {}, label = LABEL) }
        }

        assertEquals(0, keyboardRequest().imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING)
    }

    /** What the field tells the keyboard once it has the focus. */
    private fun keyboardRequest(): EditorInfo {
        compose.onNode(IS_TEXT_FIELD).performClick()
        compose.waitForIdle()
        val info = EditorInfo()
        compose.runOnUiThread { checkNotNull(textEditor(compose.activity.window.decorView)).onCreateInputConnection(info) }
        return info
    }

    /** The view that takes the keyboard's input: the Compose view, once a field has the focus. */
    private fun textEditor(view: View): View? {
        if (view.onCheckIsTextEditor()) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) textEditor(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    private fun textNode(text: String): SemanticsNode =
        compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode()

    /** The text of [node] wraps, is not cut by its own layout, and lies inside [field]. */
    private fun assertWrapsUncut(node: SemanticsNode, field: Rect) {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val layout = layouts.single()
        val text = layout.layoutInput.text
        assertTrue("\"$text\" should wrap in this test", layout.lineCount > 1)
        assertFalse("\"$text\" is cut off by its own layout", layout.hasVisualOverflow)
        node.boundsInRoot.corners().forEach { corner ->
            assertTrue("The corner $corner of \"$text\" is outside the field, $field", field.containsOrTouches(corner))
        }
    }

    /** What TalkBack reads as the field's label: its descriptions and its text, not the typed value. */
    private fun heard(config: SemanticsConfiguration): List<String> =
        config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
            config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private val IS_TEXT_FIELD = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)

        private const val LABEL = "Name"
        private const val VALUE = "Ana"
        private const val HELP = "Shown on your notes"
        private const val AMOUNT = "250"
        private const val AMOUNT_LABEL = "Amount"
        private const val SUFFIX = "ml"
        private const val SUFFIX_WORDS = "millilitres"
        private const val ERROR = "Enter a name"
        private const val LONG_LABEL = "The name that shows on every note you write"
        private const val LONG_HELP = "Other people never see it, it stays on this phone"

        /** Narrower than any phone, so long text wraps at every font scale. */
        private val NARROW_WIDTH = 200.dp
    }
}

private fun Rect.corners(): List<Offset> = listOf(topLeft, topRight, bottomLeft, bottomRight)

/** Like [Rect.contains], but a point on the right or bottom edge counts as inside. */
private fun Rect.containsOrTouches(point: Offset): Boolean =
    point.x in left..right && point.y in top..bottom
