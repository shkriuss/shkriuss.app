package app.shkriuss.core.security

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Every screen of the module, started as Android starts it, with an app class that is a [SecurityHost]. */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class SecurityActivitiesTest {
    @get:Rule
    val compose = createAndroidComposeRule<EnterRecoveryKeyActivity>()

    private val field = hasSetTextAction()

    private fun typed(): String =
        compose.onNode(field).fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    @Test
    fun everyScreenBlocksScreenshotsAndKeepsAutofillAndContentCaptureAway() {
        listOf(
            SecurityActivity::class.java,
            CreateRecoveryKeyActivity::class.java,
            EnterRecoveryKeyActivity::class.java,
            ShowRecoveryKeyActivity::class.java,
        ).forEach { type ->
            val activity: ComponentActivity = Robolectric.buildActivity(type).setup().get()
            val name = type.simpleName
            assertTrue(name, activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            assertEquals(name, View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, activity.window.decorView.importantForAutofill)
            assertEquals(
                name,
                View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS,
                activity.window.decorView.importantForContentCapture,
            )
        }
    }

    @Test
    fun aWordIsTypedLetterByLetterAndPickedFromTheSuggestions() {
        "aban".forEach { letter -> compose.onNode(field).performTextInput(letter.toString()) }
        assertEquals("aban", typed())

        compose.onNode(hasText("abandon") and hasClickAction()).performClick()

        compose.onNodeWithText("1. abandon").performScrollTo().assertIsDisplayed()
        assertEquals("the next word is empty", "", typed())
    }

    @Test
    fun theListShowsOnlyTheWordsEnteredAndTheCurrentOne() {
        compose.onNodeWithText("1. not entered yet").assertIsDisplayed()
        compose.onNode(hasText("2.", substring = true)).assertDoesNotExist()

        "aban".forEach { letter -> compose.onNode(field).performTextInput(letter.toString()) }
        compose.onNode(hasText("abandon") and hasClickAction()).performClick()

        compose.onNodeWithText("1. abandon").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("2. not entered yet").performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("3.", substring = true)).assertDoesNotExist()
    }

    @Test
    fun aPasteNeverLands() {
        compose.onNode(field).performTextInput("abandon ability")
        assertEquals("a phrase at once is refused", "", typed())

        val clipboard = compose.activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("words", "abandon"))
        compose.onNode(field).performSemanticsAction(SemanticsActions.PasteText)
        assertEquals("pasting through TalkBack is refused too", "", typed())
    }

    @Test
    fun theKeyboardIsAskedForAPasswordFieldWithNoSuggestionsAndNoLearning() {
        compose.onNode(field).performClick()
        compose.waitForIdle()
        val info = EditorInfo()
        compose.runOnUiThread { checkNotNull(textEditor(compose.activity.window.decorView)).onCreateInputConnection(info) }

        val variation = info.inputType and InputType.TYPE_MASK_VARIATION
        assertEquals(InputType.TYPE_CLASS_TEXT, info.inputType and InputType.TYPE_MASK_CLASS)
        assertTrue(
            "a password variation: keyboards neither suggest nor learn (inputType ${info.inputType})",
            variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
        )
        assertEquals("no autocorrect", 0, info.inputType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
        assertTrue("no suggestions", info.inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS != 0)
        assertTrue("no learning", info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
    }

    @Test
    fun everyButtonHasALabelAndIsAtLeastATouchTargetTall() {
        compose.onNode(field).performTextInput("a")
        compose.onNode(field).performTextInput("b")
        val buttons = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
        assertTrue(buttons.isNotEmpty())
        buttons.forEach { node ->
            val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString().orEmpty() +
                node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString().orEmpty()
            assertTrue("a label for every button", text.isNotBlank())
            // An icon button draws 40dp and takes touches on 48dp. A button
            // scrolled out of sight has no touch bounds, but its size.
            val tallest = maxOf(node.size.height.toFloat(), node.touchBoundsInRoot.height)
            val height = with(compose.density) { tallest.toDp() }
            assertTrue("$text takes touches on ${height.value}dp", height.value >= MIN_TOUCH_DP)
        }
    }

    /** The view that the keyboard talks to: Compose's own view, while a field has the focus. */
    private fun textEditor(view: View): View? {
        if (view.onCheckIsTextEditor()) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) textEditor(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    private companion object {
        const val MIN_TOUCH_DP = 48f
    }
}
