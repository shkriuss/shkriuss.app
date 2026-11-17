package app.shkriuss.reminders

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.ReminderLimits
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import app.shkriuss.feature.reminders.Weekdays
import java.time.DayOfWeek
import java.time.LocalDate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR

/**
 * What Reminders' screens do and what TalkBack hears
 * (docs/apps/reminders/spec.md, "Screens" and "TalkBack"), with the real
 * activity and the app lock off, on Monday 16 November 2026 at 09:30 with
 * the 24-hour clock. The phone's language is US English, so dates read
 * "Mon, Nov 16" and the week starts on Sunday. The rules behind the
 * screens have their own tests in feature/reminders; these check what the
 * user sees and does.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedRemindersApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemindersScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<RemindersActivity>

    @After
    fun closeTheScreen() {
        if (::scenario.isInitialized) scenario.close()
    }

    /** Starts Reminders on Upcoming, and waits until it shows [ready]: a row, or the line for none. */
    private fun start(ready: String = words(R.string.reminders_upcoming_empty_title)) {
        use24HourClock()
        scenario = ActivityScenario.launch(RemindersActivity::class.java)
        compose.waitForText(ready)
    }

    // Upcoming.

    @Test
    fun withNoReminderUpcomingSaysHowToMakeOne() {
        start()
        compose.waitForText(words(R.string.reminders_upcoming_empty_body))
        compose.onNode(hasContentDescription(words(R.string.reminders_add)) and hasClickAction()).assertExists()
    }

    @Test
    fun theRowsAreSoonestFirstWithWhenTheyShowAndTheirRepeat() {
        seed {
            addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60))
            addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 14 * 60))
            addSaved("Gym", Schedule(Repeat.WEEKLY, TODAY, 18 * 60 + 30, MONDAY_WEDNESDAY_FRIDAY))
        }
        start(ready = "Pills")

        compose.onNode(hasText("Call the bank") and hasText("Today, 14:00")).assertExists()
        compose.onNode(hasText("Gym") and hasText("Today, 18:30 · Mon, Wed, Fri")).assertExists()
        compose.onNode(hasText("Pills") and hasText("Tomorrow, 09:00 · Every day")).assertExists()
        val tops = listOf("Call the bank", "Gym", "Pills").map { rowBounds(it).top }
        assertEquals("soonest first", tops.sorted(), tops)
    }

    @Test
    fun aRowIsReadAsOneItemWithTheActionEdit() {
        seed {
            addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60))
            addSaved("Gym", Schedule(Repeat.WEEKLY, TODAY, 18 * 60 + 30, MONDAY_WEDNESDAY_FRIDAY))
        }
        start(ready = "Pills")

        row("Pills").assert(hasContentDescription("Pills, tomorrow at 09:00, every day")).assert(hasEditAction)
        row("Gym").assert(hasContentDescription("Gym, today at 18:30, Monday, Wednesday, Friday"))
    }

    @Test
    fun aReminderThatIsDueAndNotShownSaysNow() {
        seed { addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 9 * 60), savedAt = TODAY.atTime(8, 0)) }
        start(ready = "Call the bank")

        row("Call the bank").assert(hasText(words(R.string.reminders_now))).assert(hasContentDescription("Call the bank, now"))
    }

    @Test
    fun theYearShowsWhenItIsNotThisYear() {
        seed { addSaved("Birthday", Schedule(Repeat.YEARLY, LocalDate.of(2027, 2, 2), 8 * 60)) }
        start(ready = "Birthday")

        row("Birthday").assert(hasText("Tue, Feb 2, 2027, 08:00 · Every year"))
            .assert(hasContentDescription("Birthday, Tuesday, February 2, 2027 at 08:00, every year"))
    }

    // The reminder form.

    @Test
    fun aNewReminderIsOnceTodayAtTheNextFullHourWithTheKeyboardOnTheTitle() {
        start()
        compose.tap(R.string.reminders_add)
        compose.waitForText(words(R.string.reminders_new_reminder))

        compose.field(words(R.string.reminders_title)).assertIsFocused()
        radio(R.string.reminders_once).assertIsSelected()
        compose.onNode(hasText(words(R.string.reminders_date)) and hasText("Mon, Nov 16, 2026")).assertExists()
        compose.onNode(hasText(words(R.string.reminders_time)) and hasText("10:00")).assertExists()
        compose.waitForText("Next: Mon, Nov 16, 10:00")
        // No Delete for a new reminder.
        assertTrue(compose.onAllNodes(hasText(words(R.string.reminders_delete)) and hasClickAction()).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun onAPhoneTheFormIsASheetInAWindowOfItsOwn() {
        start()
        val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
        compose.tap(R.string.reminders_add)
        compose.waitForText(words(R.string.reminders_new_reminder))
        assertTrue(compose.onAllNodes(isRoot()).fetchSemanticsNodes().size > windowsBefore)
    }

    @Test
    fun saveAddsTheReminderAndSaysWhenItShows() {
        start()
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("Pills")
        compose.tap(R.string.reminders_every_day)
        compose.tap(R.string.reminders_save)

        compose.waitForText(words(R.string.reminders_saved, "Mon, Nov 16, 10:00"))
        compose.waitFor(hasText("Pills") and hasText("Today, 10:00 · Every day"))
        val stored = storedReminders().single()
        assertEquals("Pills", stored.title)
        assertEquals(Schedule(Repeat.DAILY, TODAY, 10 * 60), stored.schedule)
    }

    @Test
    fun aWrongFieldShowsItsWordsAndSaveWritesNothing() {
        start()
        compose.tap(R.string.reminders_add)
        compose.tap(R.string.reminders_save)

        compose.waitFor(hasError(words(R.string.reminders_title_empty)))
        compose.onNode(hasText(words(R.string.reminders_new_reminder))).assertExists()
        assertTrue(storedReminders().isEmpty())

        compose.field(words(R.string.reminders_title)).performTextReplacement("x".repeat(201))
        compose.waitFor(hasError("A title has at most 200 characters."))
    }

    @Test
    fun withFiveHundredRemindersSaveSaysWhyAndTheFormStays() {
        seed { repeat(ReminderLimits.MOST_REMINDERS) { addSaved("Reminder ${it + 1}", Schedule(Repeat.DAILY, TODAY, 12 * 60)) } }
        start(ready = "Reminder 1")
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("One more")
        compose.tap(R.string.reminders_save)

        compose.waitForText("Reminders keeps 500 reminders. Delete one to add another.")
        compose.onNode(hasText("Reminders keeps 500 reminders. Delete one to add another.")).assertIsDisplayed()
        compose.onNode(hasText(words(R.string.reminders_new_reminder))).assertIsDisplayed()
        compose.field(words(R.string.reminders_title)).assert(hasText("One more"))
        assertEquals(ReminderLimits.MOST_REMINDERS, storedReminders().size)
    }

    @Test
    fun everyWeekChoosesTheDayOfTheDateAndNeedsAtLeastOneDay() {
        start()
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("Gym")
        compose.tap(R.string.reminders_every_week)

        // A chip reads the whole day. The date was Monday.
        val monday = compose.onNode(hasContentDescription("Monday") and hasClickAction())
        monday.assertIsSelected()
        monday.tapAsTalkBack()
        compose.tap(R.string.reminders_save)

        compose.waitForText(words(R.string.reminders_choose_a_day))
        assertTrue(storedReminders().isEmpty())
    }

    @Test
    fun theTimePickerRefusesATimeThatHasPassed() {
        start()
        compose.tap(R.string.reminders_add)
        compose.tap(R.string.reminders_time)
        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("09")
        compose.field(words(DesignR.string.shk_minute)).performTextReplacement("15")
        compose.tap(DesignR.string.shk_ok)

        compose.waitForText(words(R.string.reminders_time_passed))
        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("11")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText("Next: Mon, Nov 16, 11:15")
    }

    /**
     * A date before today cannot be chosen again, so the date picker opens
     * on this month with no date chosen, and OK stays off until one is.
     * The stored date stays until then. On the tablet the form is a pane,
     * so the only Cancel in a dialog is the picker's.
     */
    @Test
    @Config(qualifiers = TABLET)
    fun theDatePickerOfADateBeforeTodayOpensOnThisMonthWithNoDateChosen() {
        seed {
            // Earlier this year: Material would open on it, chosen, though it cannot be chosen.
            addSaved("Dentist", Schedule(Repeat.ONCE, TODAY.minusDays(3), 10 * 60))
            // An earlier year: Material leaves it out of its years, and opens on the real today's month.
            addSaved("Rent", Schedule(Repeat.MONTHLY, LocalDate.of(2025, 10, 31), 10 * 60))
        }
        start(ready = "Rent")

        compose.tap(R.string.reminders_past)
        compose.tap("Dentist")
        pickerOnThisMonthWithNoDateChosen(stored = "Fri, Nov 13, 2026")

        compose.tap(R.string.reminders_upcoming)
        compose.tap("Rent")
        pickerOnThisMonthWithNoDateChosen(stored = "Fri, Oct 31, 2025")
    }

    @Test
    fun aDateChosenInThePickerReachesTheForm() {
        start()
        compose.tap(R.string.reminders_add)
        compose.tap(R.string.reminders_date)
        compose.tap("November 20, 2026", substring = true)
        compose.tap(DesignR.string.shk_ok)

        compose.waitFor(hasText(words(R.string.reminders_date)) and hasText("Fri, Nov 20, 2026"))
        compose.waitForText("Next: Fri, Nov 20, 10:00")
    }

    /** Opens the date picker of the open form, checks that it shows this month with OK off, cancels it, and checks the form still shows [stored]. */
    private fun pickerOnThisMonthWithNoDateChosen(stored: String) {
        compose.tap(R.string.reminders_date)
        compose.waitForText("November 2026", substring = true)
        compose.onNode(hasText(words(DesignR.string.shk_ok)) and hasClickAction()).assertIsNotEnabled()
        compose.tap(hasText(words(DesignR.string.shk_cancel)) and hasAnyAncestor(isDialog()))
        compose.onNode(hasText(words(R.string.reminders_date)) and hasText(stored)).assertExists()
    }

    @Test
    fun aRowOpensItsFormAndDeleteHasUndo() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60)) }
        start(ready = "Pills")
        compose.tap("Pills")

        compose.waitForText(words(R.string.reminders_edit_reminder))
        // The form of an existing reminder opens without the keyboard.
        compose.field(words(R.string.reminders_title)).assert(hasText("Pills")).assertIsNotFocused()
        radio(R.string.reminders_every_day).assertIsSelected()
        compose.tap(R.string.reminders_delete)

        compose.waitForText(words(R.string.reminders_deleted))
        compose.waitForText(words(R.string.reminders_upcoming_empty_title))
        compose.tap(R.string.reminders_undo)
        compose.waitForText("Pills")
        assertEquals(listOf("Pills"), storedReminders().map { it.title })
    }

    @Test
    fun cancelClosesTheFormAndWritesNothing() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60)) }
        start(ready = "Pills")
        compose.tap("Pills")
        compose.field(words(R.string.reminders_title)).performTextReplacement("Vitamins")
        compose.tap(R.string.reminders_cancel)

        compose.waitForGone(hasText(words(R.string.reminders_edit_reminder)))
        assertEquals(listOf("Pills"), storedReminders().map { it.title })
    }

    // Past.

    @Test
    fun pastIsNewestFirstAndReadAsOneItem() {
        seed {
            addSaved("Dentist", Schedule(Repeat.ONCE, TODAY.minusDays(3), 10 * 60))
            addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 8 * 60))
        }
        start()
        compose.tap(R.string.reminders_past)
        compose.waitForText("Dentist")

        row("Call the bank").assert(hasText("Mon, Nov 16, 08:00"))
            .assert(hasContentDescription("Call the bank, Monday, November 16 at 08:00"))
            .assert(hasEditAction)
        row("Dentist").assert(hasText("Fri, Nov 13, 10:00"))
        assertTrue("newest first", rowBounds("Call the bank").top < rowBounds("Dentist").top)
    }

    @Test
    fun deleteAllAsksFirstAndHasUndo() {
        seed {
            addSaved("Dentist", Schedule(Repeat.ONCE, TODAY.minusDays(3), 10 * 60))
            addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 8 * 60))
            addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60))
        }
        start(ready = "Pills")
        compose.tap(R.string.reminders_past)
        compose.tap(R.string.reminders_delete_all)

        compose.waitForText(words(R.string.reminders_delete_all_question))
        compose.waitForText("This deletes 2 reminders.")
        compose.tap(R.string.reminders_delete)

        compose.waitForText("2 reminders deleted")
        compose.waitForText(words(R.string.reminders_past_empty_title))
        assertEquals(listOf("Pills"), storedReminders().map { it.title })
        compose.tap(R.string.reminders_undo)
        compose.waitForText("Dentist")
        assertEquals(setOf("Pills", "Dentist", "Call the bank"), storedReminders().map { it.title }.toSet())
    }

    @Test
    @Config(qualifiers = TABLET)
    fun deleteAllClosesAFormOpenBesideTheListOnAReminderItDeletes() {
        seed { addSaved("Dentist", Schedule(Repeat.ONCE, TODAY.minusDays(3), 10 * 60)) }
        start()
        compose.tap(R.string.reminders_past)
        compose.tap("Dentist")
        compose.waitForText(words(R.string.reminders_edit_reminder))

        compose.tap(R.string.reminders_delete_all)
        // The question's Delete, not the form's: on the tablet the form is a pane, not a dialog.
        compose.tap(hasText(words(R.string.reminders_delete)) and hasAnyAncestor(isDialog()))

        compose.waitForText(words(R.string.reminders_choose_a_reminder))
        compose.waitForGone(hasText(words(R.string.reminders_edit_reminder)))
    }

    @Test
    fun withNoPastReminderPastSaysSoAndHasNoDeleteAll() {
        start()
        compose.tap(R.string.reminders_past)
        compose.waitForText(words(R.string.reminders_past_empty_title))
        compose.waitForText(words(R.string.reminders_past_empty_body))
        assertTrue(compose.onAllNodes(hasContentDescription(words(R.string.reminders_delete_all))).fetchSemanticsNodes().isEmpty())
    }

    // From 840dp.

    @Test
    @Config(qualifiers = TABLET)
    fun inAnExpandedWindowTheFormOpensBesideTheList() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60)) }
        start(ready = "Pills")
        compose.waitForText(words(R.string.reminders_choose_a_reminder))

        val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
        compose.tap("Pills")
        compose.waitForText(words(R.string.reminders_edit_reminder))
        assertEquals("no window of its own", windowsBefore, compose.onAllNodes(isRoot()).fetchSemanticsNodes().size)
        row("Pills").assertIsSelected()
        val form = compose.onNode(hasText(words(R.string.reminders_edit_reminder))).fetchSemanticsNode().boundsInRoot
        assertTrue("the form is beside the list", form.left > rowBounds("Pills").right)

        compose.tap(R.string.reminders_cancel)
        compose.waitForText(words(R.string.reminders_choose_a_reminder))
    }

    @Test
    @Config(qualifiers = TABLET)
    fun eachListKeepsItsOpenForm() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60)) }
        start(ready = "Pills")
        compose.tap("Pills")
        compose.waitForText(words(R.string.reminders_edit_reminder))

        compose.tap(R.string.reminders_past)
        compose.waitForText(words(R.string.reminders_choose_a_reminder))
        compose.tap(R.string.reminders_upcoming)
        compose.waitForText(words(R.string.reminders_edit_reminder))
    }

    // Navigation and Settings.

    @Test
    fun backFromPastOrSettingsGoesToUpcomingAndBackFromUpcomingLeaves() {
        start()
        compose.tap(R.string.reminders_settings)
        compose.waitForText(words(R.string.reminders_version))
        pressBack()
        destination(R.string.reminders_upcoming).assertIsSelected()

        compose.tap(R.string.reminders_past)
        pressBack()
        destination(R.string.reminders_upcoming).assertIsSelected()

        // On Upcoming nothing of Reminders takes Back, so Android leaves the app.
        scenario.onActivity { assertFalse(it.onBackPressedDispatcher.hasEnabledCallbacks()) }
    }

    @Test
    fun settingsShowTheVersionOfTheInstalledApp() {
        start()
        compose.tap(R.string.reminders_settings)
        var versionName = ""
        scenario.onActivity { versionName = it.packageManager.getPackageInfo(it.packageName, 0).versionName.orEmpty() }
        assertTrue(versionName.isNotEmpty())
        compose.waitFor(hasText(words(R.string.reminders_version)) and hasText(versionName))
    }

    /** The row of the reminder [title]: not the title field of its form. */
    private fun row(title: String) = compose.onNode(
        hasText(title) and hasClickAction() and !SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText),
    )

    private fun rowBounds(title: String): Rect = row(title).fetchSemanticsNode().boundsInRoot

    private fun radio(label: Int) = compose.onNode(hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected))

    private fun destination(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected),
    )

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /** A row whose action, as TalkBack offers it, is "Edit". */
    private val hasEditAction = SemanticsMatcher("has the action Edit") {
        it.config.getOrNull(SemanticsActions.OnClick)?.label == words(R.string.reminders_edit)
    }
}

/** The day the tests start on: Monday 16 November 2026. */
private val TODAY: LocalDate = THE_TIME.toLocalDate()

/** Monday, Wednesday and Friday, as "Gym" in the spec's examples. */
private val MONDAY_WEDNESDAY_FRIDAY: Int = Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
