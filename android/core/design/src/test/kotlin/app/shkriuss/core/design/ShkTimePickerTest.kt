package app.shkriuss.core.design

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkTimePicker] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility", and the owner's decision on it:
 *
 * - In its window it is a pane that TalkBack announces by its title, and
 *   the title is a heading.
 * - TalkBack reads each field with its label, its number and the range it
 *   takes. Each field, AM and PM are at least 48dp tall. "OK" and
 *   "Cancel" are text buttons, checked by ShkComponentsTest.
 * - With the 12-hour clock, AM and PM are radio buttons in one group.
 *   With the 24-hour clock there are none.
 * - An impossible hour is refused with an error that TalkBack reads as the
 *   field's error, and "OK" is turned off until it is fixed. Letters and a
 *   third digit cannot be typed.
 * - "OK" closes the dialog, then gives the time typed.
 *
 * Robolectric uses the 12-hour clock unless a test sets the phone's
 * "Use 24-hour format". Graphics run natively, so text is measured with
 * the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkTimePickerTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun talkBackHearsTheTitleTheFieldsAndAmAndPm() {
        show { ShkTimePicker(title = TITLE, initialTime = LocalTime.of(21, 5), onTimeChosen = {}, onDismissRequest = {}) }

        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, TITLE)).assertExists()
        compose.onNode(hasText(TITLE)).assert(isHeading())
        // Each field holds its label, its number and its range, once.
        compose.onNode(IS_FIELD and hasText(HOUR) and hasText("09") and hasText(HOUR_RANGE_12))
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        compose.onNode(IS_FIELD and hasText(MINUTE) and hasText("05") and hasText(MINUTE_RANGE))
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        compose.onAllNodes(hasText(HOUR), useUnmergedTree = true).assertCountEquals(1)

        listOf("AM", "PM").forEach { word ->
            compose.onNode(hasText(word) and hasClickAction())
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
                .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
        compose.onNode(hasText("PM") and hasClickAction()).assertIsSelected()
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup)).assertExists()
    }

    @Test
    fun anImpossibleHourIsRefusedWithAnErrorAndOkTurnsOff() {
        show { ShkTimePicker(title = TITLE, initialTime = LocalTime.of(9, 30), onTimeChosen = {}, onDismissRequest = {}) }
        val hour = compose.onNode(IS_FIELD and hasText(HOUR))
        val ok = compose.onNode(hasText(OK) and hasClickAction())

        hour.performTextReplacement("13")
        hour.assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, "Enter an hour from 1 to 12."))
        ok.assertIsNotEnabled()

        // Letters and a third digit are refused as they are typed.
        hour.performTextReplacement("ab")
        hour.assert(hasText("13"))
        hour.performTextReplacement("123")
        hour.assert(hasText("13"))

        hour.performTextReplacement("")
        hour.assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Error))
        ok.assertIsNotEnabled()

        hour.performTextReplacement("12")
        hour.assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Error))
        ok.assertIsEnabled()
    }

    @Test
    fun okClosesTheDialogThenGivesTheTimeTyped() {
        val calls = mutableListOf<String>()
        var chosen: LocalTime? = null
        show {
            ShkTimePicker(
                title = TITLE,
                initialTime = LocalTime.of(9, 30),
                onTimeChosen = {
                    calls += "chosen"
                    chosen = it
                },
                onDismissRequest = { calls += CLOSED },
            )
        }

        compose.onNode(IS_FIELD and hasText(HOUR)).performTextReplacement("7")
        compose.onNode(IS_FIELD and hasText(MINUTE)).performTextReplacement("05")
        compose.onNode(hasText("PM") and hasClickAction()).performClick()
        compose.onNode(hasText(OK) and hasClickAction()).performClick()
        compose.runOnIdle {
            assertEquals(listOf(CLOSED, "chosen"), calls)
            assertEquals(LocalTime.of(19, 5), chosen)
        }
    }

    @Test
    fun theTwentyFourHourClockHasNoAmOrPm() {
        Settings.System.putString(RuntimeEnvironment.getApplication().contentResolver, Settings.System.TIME_12_24, "24")
        var chosen: LocalTime? = null
        show { ShkTimePicker(title = TITLE, initialTime = LocalTime.of(21, 5), onTimeChosen = { chosen = it }, onDismissRequest = {}) }

        compose.onAllNodes(hasText("AM")).assertCountEquals(0)
        compose.onAllNodes(hasText("PM")).assertCountEquals(0)
        val hour = compose.onNode(IS_FIELD and hasText(HOUR))
        hour.assert(hasText("21")).assert(hasText(HOUR_RANGE_24))
        hour.performTextReplacement("24")
        hour.assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, "Enter an hour from 0 to 23."))
        hour.performTextReplacement("0")
        compose.onNode(hasText(OK) and hasClickAction()).performClick()
        compose.runOnIdle { assertEquals(LocalTime.of(0, 5), chosen) }
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TITLE = "Reminder"
        private const val HOUR = "Hour"
        private const val MINUTE = "Minute"
        private const val OK = "OK"
        private const val CANCEL = "Cancel"
        private const val CLOSED = "closed"
        private const val HOUR_RANGE_12 = "From 1 to 12"
        private const val HOUR_RANGE_24 = "From 0 to 23"
        private const val MINUTE_RANGE = "From 0 to 59"

        private val IS_FIELD = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)
    }
}
