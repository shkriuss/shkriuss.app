package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.toSize
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkDatePicker] at font scale 1.0 and 2.0, for the rules in
 * CLAUDE.md, "UI and accessibility":
 *
 * - In its window it is a pane that TalkBack announces by its title, and
 *   the title is a heading. The chosen date is a polite live region read
 *   in full, or "No date chosen".
 * - "OK" is turned off until a date is chosen. It closes the dialog, then
 *   gives the date. A day tapped is the date given.
 * - Days outside the earliest and latest date are turned off.
 * - Every day has a touch target of its own, 48 by 48 dp.
 * - In a window narrower than the month, the picker offers typing the
 *   date, and nothing is cut off.
 *
 * The screen is the screenshot phone, unless a test makes it narrower.
 * Graphics run natively, so text is measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkDatePickerTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun nothingChosenAnnouncesItsTitleAndOkIsTurnedOff() {
        val calls = mutableListOf<String>()
        show {
            ShkDatePicker(
                title = TITLE,
                onDateChosen = { calls += "chosen" },
                onDismissRequest = { calls += CLOSED },
            )
        }

        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, TITLE)).assertExists()
        compose.onNode(hasText(TITLE)).assert(isHeading())
        compose.onNode(hasText(NO_DATE)).assert(POLITE)
        compose.onNode(hasText(OK) and hasClickAction()).assertIsNotEnabled()
        compose.onNode(hasText(CANCEL) and hasClickAction()).performClick()
        compose.runOnIdle { assertEquals(listOf(CLOSED), calls) }
    }

    @Test
    fun aDayTappedIsTheDateGivenAfterTheDialogCloses() {
        val calls = mutableListOf<String>()
        var chosen: LocalDate? = null
        show {
            ShkDatePicker(
                title = TITLE,
                selectedDate = SELECTED,
                onDateChosen = {
                    calls += "chosen"
                    chosen = it
                },
                onDismissRequest = { calls += CLOSED },
            )
        }

        // The chosen date is read in full, and announced when it changes.
        compose.onNode(hasContentDescription(SELECTED_IN_FULL)).assert(POLITE)
        compose.onNode(hasText(TAPPED_DAY, substring = true) and hasClickAction()).performClick()
        compose.onNode(hasContentDescription(TAPPED_IN_FULL)).assert(POLITE)
        compose.onNode(hasText(OK) and hasClickAction()).assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(listOf(CLOSED, "chosen"), calls)
            assertEquals(LocalDate.of(2026, 3, 20), chosen)
        }
    }

    @Test
    fun daysOutsideTheEarliestAndLatestDateAreTurnedOff() {
        show {
            ShkDatePicker(
                title = TITLE,
                selectedDate = SELECTED,
                earliestDate = SELECTED.minusDays(3),
                latestDate = SELECTED.plusDays(8),
                onDateChosen = {},
                onDismissRequest = {},
            )
        }

        compose.onNode(hasText(TOO_EARLY, substring = true) and hasClickAction()).assertIsNotEnabled()
        compose.onNode(hasText(TAPPED_DAY, substring = true) and hasClickAction()).assertIsEnabled()
        compose.onNode(hasText(TOO_LATE, substring = true) and hasClickAction()).assertIsNotEnabled()
    }

    @Test
    fun everyDayHasATouchTargetOfItsOwn() {
        show { ShkDatePicker(title = TITLE, selectedDate = SELECTED, onDateChosen = {}, onDismissRequest = {}) }

        val days = compose.onAllNodes(IS_DAY)
            .fetchSemanticsNodes()
        assertEquals("March has 31 days", 31, days.size)
        val minimum = with(compose.density) { ShkSpacing.MinTouchTarget.toPx() }
        val targets = days.map { Rect(it.positionInRoot, it.size.toSize()) }
        targets.forEachIndexed { index, target ->
            assertTrue("A day is ${target.width} by ${target.height} px", target.width >= minimum - 1f && target.height >= minimum - 1f)
            targets.drop(index + 1).forEach { other ->
                assertFalse("Two days overlap, $target and $other", target.deflate(0.5f).overlaps(other.deflate(0.5f)))
            }
        }
    }

    @Test
    @Config(qualifiers = "w320dp-h700dp")
    fun aWindowTooNarrowForTheMonthOffersTyping() {
        var chosen: LocalDate? = null
        show { ShkDatePicker(title = TITLE, onDateChosen = { chosen = it }, onDismissRequest = {}) }

        // No day of a month is shown, and there is no way to switch to one.
        compose.onAllNodes(IS_DAY).assertCountEquals(0)
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)).performTextReplacement("03202026")
        compose.onNode(hasText(OK) and hasClickAction()).performClick()
        compose.runOnIdle { assertEquals(LocalDate.of(2026, 3, 20), chosen) }
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TITLE = "Due date"
        private const val OK = "OK"
        private const val CANCEL = "Cancel"
        private const val CLOSED = "closed"
        private const val NO_DATE = "No date chosen"

        /** A date in the past, so the month shown does not change with today's date. */
        private val SELECTED = LocalDate.of(2026, 3, 12)

        /** How TalkBack reads [SELECTED] and the day tapped, in the test's language, English. */
        private const val SELECTED_IN_FULL = "Thursday, March 12, 2026"
        private const val TAPPED_IN_FULL = "Friday, March 20, 2026"

        /**
         * A day of March 2026, as Material 3 gives it to TalkBack, such as
         * "Friday, March 20, 2026". The month's own title, "March 2026",
         * has no comma.
         */
        private val IS_DAY = hasText("March", substring = true) and hasText(", 2026", substring = true) and hasClickAction()

        /** Part of how Material 3 reads days of March 2026. */
        private const val TAPPED_DAY = "March 20, 2026"
        private const val TOO_EARLY = "March 8, 2026"
        private const val TOO_LATE = "March 21, 2026"

        private val POLITE = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
    }
}
