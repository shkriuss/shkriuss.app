package app.shkriuss.core.design

import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextLayoutResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkTextEditor] (docs/apps/notes/spec.md, "Changes to shared
 * modules") at font scale 1.0 and 2.0:
 *
 * - it is at least 48 by 48 dp, and TalkBack reads its hint while it is
 *   empty, and its text as it is once it has text,
 * - the styles of its ranges change nothing of the text it holds,
 * - typing reaches the caller with the new selection, and the editor shows
 *   what the caller keeps,
 * - a real touch on a range to tap calls the caller with that range, and
 *   neither focuses the editor nor moves its cursor; a touch elsewhere
 *   focuses it,
 * - TalkBack offers the caller's action, by its label, and an error once,
 *   as the error,
 * - asked to, it tells the keyboard not to learn what is typed.
 *
 * Graphics run natively, so text is laid out with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkTextEditorTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    private val editor get() = compose.onNode(IS_TEXT_FIELD)

    @Test
    fun takesA48dpTouchTargetAndReadsItsHintWhileEmpty() {
        compose.setContent { ShkTheme { ShkTextEditor(text = "", selectionStart = 0, selectionEnd = 0, onChange = { _, _, _ -> }, hint = HINT) } }

        editor.assertWidthIsAtLeast(ShkSpacing.MinTouchTarget).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        val config = editor.fetchSemanticsNode().config
        assertEquals(listOf(HINT), config.getOrNull(SemanticsProperties.Text)?.map { it.text })
        assertEquals("", config[SemanticsProperties.EditableText].text)
    }

    @Test
    fun withTextTalkBackReadsTheTextAsItIsAndNotTheHint() {
        compose.setContent {
            ShkTheme { ShkTextEditor(text = TEXT, selectionStart = 0, selectionEnd = 0, onChange = { _, _, _ -> }, hint = HINT, looks = LOOKS) }
        }

        val config = editor.fetchSemanticsNode().config
        assertEquals("The styles change nothing of the text", TEXT, config[SemanticsProperties.EditableText].text)
        assertNull(config.getOrNull(SemanticsProperties.Text))
        compose.onAllNodes(hasText(HINT), useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue("no hint: $it", it.isEmpty()) }
    }

    @Test
    fun typingReachesTheCallerWithTheSelectionAndTheEditorShowsWhatTheCallerKeeps() {
        var text by mutableStateOf("")
        var cursor by mutableIntStateOf(0)
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = text,
                    selectionStart = cursor,
                    selectionEnd = cursor,
                    onChange = { changed, start, _ ->
                        // The caller keeps at most five characters.
                        if (changed.length <= 5) {
                            text = changed
                            cursor = start
                        }
                    },
                    hint = HINT,
                )
            }
        }

        editor.performTextInput("Trip")
        compose.runOnIdle {
            assertEquals("Trip", text)
            assertEquals(4, cursor)
        }
        editor.performTextInput(" to Tbilisi")
        compose.runOnIdle { assertEquals("Trip", text) }
        assertEquals("Trip", editor.fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
    }

    @Test
    fun aTouchOnARangeToTapCallsTheCallerAndNeitherFocusesNorMovesTheCursor() {
        var tapped: IntRange? = null
        var selection = -1
        var layout: TextLayoutResult? = null
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = TEXT,
                    selectionStart = 0,
                    selectionEnd = 0,
                    onChange = { _, start, _ -> selection = start },
                    hint = HINT,
                    looks = LOOKS,
                    tapRanges = listOf(BOX),
                    onTapRange = { tapped = it },
                )
            }
        }
        compose.runOnIdle {
            val results = mutableListOf<TextLayoutResult>()
            editor.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
            layout = results.single()
        }
        val box = checkNotNull(layout).getBoundingBox(BOX.first + 1).center

        editor.performTouchInput { click(box) }

        compose.runOnIdle { assertEquals(BOX, tapped) }
        editor.assertIsNotFocused()
        assertEquals("The cursor did not move", -1, selection)
    }

    @Test
    fun aRangeToTapIsA48dpTouchTargetAndATapBetweenTwoGoesToTheNearer() {
        val text = "- [ ] Passport\n- [ ] Tickets\nand the train"
        val first = 2..4
        val second = 17..19
        val tapped = mutableListOf<IntRange>()
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = text,
                    selectionStart = 0,
                    selectionEnd = 0,
                    onChange = { _, _, _ -> },
                    hint = HINT,
                    tapRanges = listOf(first, second),
                    onTapRange = { tapped += it },
                )
            }
        }
        val layout = layoutOf()
        val x = layout.getBoundingBox(second.first + 1).center.x
        val middleOfFirst = (layout.getLineTop(0) + layout.getLineBottom(0)) / 2
        val middleOfSecond = (layout.getLineTop(1) + layout.getLineBottom(1)) / 2
        // Just inside half of 48 dp below the middle of the second box: on the plain line under it at font 1.0.
        val reach = with(compose.density) { (ShkSpacing.MinTouchTarget / 2).toPx() } - 2f

        editor.performTouchInput { click(Offset(x, middleOfSecond + reach)) }
        editor.performTouchInput { click(Offset(x, (middleOfFirst + middleOfSecond) / 2 + 2f)) }
        editor.performTouchInput { click(Offset(x, (middleOfFirst + middleOfSecond) / 2 - 2f)) }

        compose.runOnIdle { assertEquals(listOf(second, second, first), tapped) }
        editor.assertIsNotFocused()
    }

    @Test
    fun aDragThatStartsOnARangeToTapScrollsTheScreenAndTapsNothing() {
        var tapped: IntRange? = null
        val scroll = ScrollState(0)
        val long = TEXT + "\n" + List(LINES) { "Line $it" }.joinToString("\n")
        compose.setContent {
            ShkTheme {
                Column(Modifier.height(SCREEN).verticalScroll(scroll)) {
                    ShkTextEditor(
                        text = long,
                        selectionStart = 0,
                        selectionEnd = 0,
                        onChange = { _, _, _ -> },
                        hint = HINT,
                        tapRanges = listOf(BOX),
                        onTapRange = { tapped = it },
                    )
                }
            }
        }
        val box = boxCentre()

        editor.performTouchInput { swipe(start = box, end = box - Offset(0f, height.toFloat())) }

        compose.runOnIdle {
            assertTrue("The screen scrolled", scroll.value > 0)
            assertNull(tapped)
        }
    }

    @Test
    fun aWordBeingTypedKeepsItsComposingRegionOnlyWhileTheTextIsTheCallers() {
        var text by mutableStateOf("")
        var cursor by mutableIntStateOf(0)
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = text,
                    selectionStart = cursor,
                    selectionEnd = cursor,
                    onChange = { changed, start, _ ->
                        text = changed
                        cursor = start
                    },
                    hint = HINT,
                )
            }
        }
        editor.performClick()
        compose.waitForIdle()
        compose.runOnUiThread { checkNotNull(inputConnection()).setComposingText("Milk", 1) }
        compose.runOnIdle { assertEquals("Milk", text) }

        // The caller changes the text, as Bold does, and then back, as Bold pressed again does.
        compose.runOnIdle {
            text = "**Milk**"
            cursor = 6
        }
        compose.runOnIdle {
            text = "Milk"
            cursor = 4
        }
        compose.waitForIdle()
        compose.runOnUiThread { checkNotNull(inputConnection()).commitText(" bread", 1) }

        compose.runOnIdle { assertEquals("The word typed before stays", "Milk bread", text) }
    }

    @Test
    fun aTouchBesideTheRangesFocusesTheEditor() {
        var tapped: IntRange? = null
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = TEXT,
                    selectionStart = 0,
                    selectionEnd = 0,
                    onChange = { _, _, _ -> },
                    hint = HINT,
                    tapRanges = listOf(BOX),
                    onTapRange = { tapped = it },
                )
            }
        }

        editor.performTouchInput { click(centerRight.copy(x = right - 1f)) }

        editor.assertIsFocused()
        assertNull(tapped)
    }

    @Test
    fun talkBackOffersTheCallersActionAndAnnouncesTheErrorOnce() {
        var ticked = 0
        compose.setContent {
            ShkTheme {
                ShkTextEditor(
                    text = TEXT,
                    selectionStart = 3,
                    selectionEnd = 3,
                    onChange = { _, _, _ -> },
                    hint = HINT,
                    action = ShkEditorAction(TICK) { ticked++ },
                    errorText = ERROR,
                )
            }
        }

        val config = editor.fetchSemanticsNode().config
        val action = config[SemanticsActions.CustomActions].single()
        assertEquals(TICK, action.label)
        compose.runOnIdle { assertTrue(action.action()) }
        assertEquals(1, ticked)
        assertEquals(ERROR, config[SemanticsProperties.Error])
        assertFalse("The error is read as the error, not also as text", config.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text == ERROR })
    }

    @Test
    fun askedToTheEditorTellsTheKeyboardNotToLearn() {
        compose.setContent {
            ShkTheme { ShkTextEditor(text = "", onTextChange = {}, hint = HINT, singleLine = true, keyboardLearns = false) }
        }

        val info = keyboardRequest()
        assertTrue("no learning", info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        assertEquals("suggestions stay", 0, info.inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
    }

    @Test
    fun byDefaultTheEditorDoesNotAskTheKeyboardNotToLearn() {
        compose.setContent { ShkTheme { ShkTextEditor(text = "", onTextChange = {}, hint = HINT) } }

        assertEquals(0, keyboardRequest().imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING)
    }

    /** The middle of the box `[ ]` in the editor. */
    private fun boxCentre(): Offset {
        val results = mutableListOf<TextLayoutResult>()
        compose.runOnIdle { editor.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results) }
        return results.single().getBoundingBox(BOX.first + 1).center
    }

    /** How the editor lays out its text now. */
    private fun layoutOf(): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        compose.runOnIdle { editor.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results) }
        return results.single()
    }

    /** The connection the keyboard gets from the editor that has the focus. */
    private fun inputConnection(): android.view.inputmethod.InputConnection? =
        textEditor(compose.activity.window.decorView)?.onCreateInputConnection(EditorInfo())

    /** What the editor tells the keyboard once it has the focus. */
    private fun keyboardRequest(): EditorInfo {
        editor.performClick()
        compose.waitForIdle()
        val info = EditorInfo()
        compose.runOnUiThread { checkNotNull(textEditor(compose.activity.window.decorView)).onCreateInputConnection(info) }
        return info
    }

    /** The view that takes the keyboard's input: the Compose view, once an editor has the focus. */
    private fun textEditor(view: View): View? {
        if (view.onCheckIsTextEditor()) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) textEditor(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private val IS_TEXT_FIELD = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)

        private const val HINT = "Note"
        private const val LINES = 40
        private val SCREEN = 120.dp
        private const val TEXT = "- [ ] Passport and the tickets for the train"
        private const val TICK = "Tick"
        private const val ERROR = "A note has at most 100,000 characters."

        /** The box `[ ]` of the checklist item. */
        private val BOX = 2..4

        private val LOOKS = listOf(
            ShkTextRange(ShkTextLook.Quiet, 0, 6),
            ShkTextRange(ShkTextLook.Bold, 6, 14),
            ShkTextRange(ShkTextLook.Heading, 0, TEXT.length),
            // A range past the end of the text is left out.
            ShkTextRange(ShkTextLook.Italic, 30, 400),
        )
    }
}
