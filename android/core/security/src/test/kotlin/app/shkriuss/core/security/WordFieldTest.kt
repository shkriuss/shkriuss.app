package app.shkriuss.core.security

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuComponent
import androidx.compose.foundation.text.contextmenu.provider.LocalTextContextMenuToolbarProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuDataProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuProvider
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.rightClick
import androidx.compose.ui.text.TextRange
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/**
 * The field for one recovery word and the clipboard: nothing is copied or
 * cut from it and nothing is pasted into it, whatever asks for it, and
 * its text menu offers nothing. The field is the real one, with the
 * phone's clipboard as Robolectric has it.
 */
@RunWith(RobolectricTestRunner::class)
@OptIn(ExperimentalTestApi::class)
class WordFieldTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    /** The plain activity is in no manifest, so it is added to Robolectric's package manager first. */
    private val plainActivity = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(plainActivity).around(compose)

    private val field = hasSetTextAction()
    private val clipboard get() = compose.activity.getSystemService(ClipboardManager::class.java)
    private val menu = RecordingMenu()

    /** What the phone's clipboard holds, as text. */
    private fun onClipboard(): String? = clipboard.primaryClip?.getItemAt(0)?.text?.toString()

    private fun typed(): String =
        compose.onNode(field).fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /** The field on a screen, with [letters] typed one by one and [before] on the clipboard. */
    private fun fieldWith(letters: String, before: String = BEFORE) {
        compose.setContent {
            ShkTheme {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides menu) {
                    var word by remember { mutableStateOf("") }
                    WordField(value = word, onValueChange = { word = it }, onWord = {}, label = "Word 1")
                }
            }
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("before", before))
        compose.onNode(field).performClick()
        letters.forEach { letter -> compose.onNode(field).performTextInput(letter.toString()) }
        assertEquals(letters, typed())
    }

    /** Presses and lets go of the key [code], with the keys of [held] held, on the screen as a keyboard does. */
    private fun press(code: Int, held: Int = 0) {
        compose.runOnUiThread {
            listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP).forEach { action ->
                compose.activity.dispatchKeyEvent(NoCharacterKey(action, code, held))
            }
        }
        compose.waitForIdle()
    }

    private fun pressWithControl(code: Int) = press(code, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)

    private fun selection(): TextRange = compose.onNode(field).fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]

    private fun selectAllByKeys() {
        pressWithControl(KeyEvent.KEYCODE_A)
        assertEquals("Ctrl+A selects the whole word", TextRange(0, typed().length), selection())
    }

    @Test
    fun selectAllAndCopyByKeysLeavesTheClipboardAsItWas() {
        fieldWith("abandon")
        selectAllByKeys()

        pressWithControl(KeyEvent.KEYCODE_C)
        assertEquals("Ctrl+C", BEFORE, onClipboard())
        pressWithControl(KeyEvent.KEYCODE_INSERT)
        assertEquals("Ctrl+Insert", BEFORE, onClipboard())
        press(KeyEvent.KEYCODE_COPY)
        assertEquals("the Copy key, which is also how a keyboard app copies", BEFORE, onClipboard())

        assertEquals("abandon", typed())
    }

    @Test
    fun cutByKeysTakesNothingFromTheField() {
        fieldWith("abandon")
        selectAllByKeys()

        pressWithControl(KeyEvent.KEYCODE_X)
        press(KeyEvent.KEYCODE_CUT)

        assertEquals(BEFORE, onClipboard())
        assertEquals("abandon", typed())
    }

    @Test
    fun pasteByKeysBringsNothingIntoTheField() {
        // One letter: a change that the rule of one letter at a time would let through.
        fieldWith("abando", before = "n")

        pressWithControl(KeyEvent.KEYCODE_V)
        press(KeyEvent.KEYCODE_INSERT, held = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)
        press(KeyEvent.KEYCODE_PASTE)

        assertEquals("abando", typed())
    }

    @Test
    fun theAccessibilityActionsCopyCutAndPasteMoveNothing() {
        fieldWith("abando", before = "n")
        compose.onNode(field).performSemanticsAction(SemanticsActions.SetSelection) { it(0, 6, true) }
        compose.waitForIdle()
        assertEquals(TextRange(0, 6), selection())

        compose.onNode(field).performSemanticsAction(SemanticsActions.CopyText)
        compose.waitForIdle()
        assertEquals("copy", "n", onClipboard())

        compose.onNode(field).performSemanticsAction(SemanticsActions.CutText)
        compose.waitForIdle()
        assertEquals("cut", "n", onClipboard())
        assertEquals("cut", "abando", typed())

        compose.onNode(field).performSemanticsAction(SemanticsActions.PasteText)
        compose.waitForIdle()
        assertEquals("paste", "abando", typed())
    }

    @Test
    fun theMenuOverSelectedTextOffersNothing() {
        fieldWith("abandon")

        compose.onNode(field).performSemanticsAction(SemanticsActions.OnLongClick)
        compose.waitForIdle()

        assertTrue("the field asked for its menu", menu.asked > 0)
        assertEquals("nothing to copy, cut, paste, share or look up", emptyList<TextContextMenuComponent>(), menu.offered)
    }

    @Test
    fun aClickOfTheRightMouseButtonOpensNoMenu() {
        fieldWith("abandon")

        compose.onNode(field).performMouseInput { rightClick() }
        compose.waitForIdle()

        compose.onAllNodes(isPopup()).assertCountEquals(0)
    }

    /**
     * A key that types no character, as Android reports a key that is
     * pressed with Ctrl held. Robolectric's key map reports the letter
     * instead, and the field would type it.
     */
    private class NoCharacterKey(action: Int, code: Int, held: Int) : KeyEvent(0L, 0L, action, code, 0, held) {
        override fun getUnicodeChar(): Int = 0

        override fun getUnicodeChar(metaState: Int): Int = 0
    }

    /** Stands where Android's menu over selected text stands, and records what the field offers in it. */
    private class RecordingMenu : TextContextMenuProvider {
        var asked = 0
        var offered: List<TextContextMenuComponent> = emptyList()

        override suspend fun showTextContextMenu(dataProvider: TextContextMenuDataProvider) {
            asked++
            offered = dataProvider.data().components
        }
    }

    private companion object {
        const val BEFORE = "what was there before"
    }
}
