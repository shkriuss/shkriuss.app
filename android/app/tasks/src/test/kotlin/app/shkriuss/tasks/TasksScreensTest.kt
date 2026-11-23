package app.shkriuss.tasks

import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasParent
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.core.app.ActivityScenario
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskLimits
import app.shkriuss.feature.tasks.TaskList
import app.shkriuss.feature.tasks.TaskRepeat
import app.shkriuss.feature.tasks.Weekdays
import app.shkriuss.feature.tasks.data.TaskEntity
import java.time.DayOfWeek
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR

/**
 * What Tasks' screens do and what TalkBack hears (docs/apps/tasks/spec.md,
 * "Screens" and "TalkBack"), with the real activity and the app lock off,
 * on Monday 16 November 2026 at 09:30 with the 24-hour clock. The phone's
 * language is US English, so dates read "Mon, Nov 16" and the week starts
 * on Sunday. The rules behind the screens have their own tests in
 * feature/tasks; these check what the user sees and does.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedTasksApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TasksScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<TasksActivity>

    @After
    fun closeTheScreen() {
        if (::scenario.isInitialized) scenario.close()
    }

    /** Starts Tasks on Today, and waits until it shows [ready]: a row, or the line for none. */
    private fun start(ready: String = words(R.string.tasks_nothing_due_today)) {
        use24HourClock()
        scenario = ActivityScenario.launch(TasksActivity::class.java)
        compose.waitForText(ready)
    }

    // Today.

    @Test
    fun withNothingDueTodayTodaySaysSo() {
        seed { addTask("Buy milk") }
        start()

        compose.onNode(hasContentDescription(words(R.string.tasks_add)) and hasClickAction()).assertExists()
        assertNoText("Buy milk")
    }

    @Test
    fun todayShowsOverdueOldestFirstThenTodayWithRemindersFirst() {
        seedToday()
        start(ready = "Pills")

        heading(R.string.tasks_overdue).assertExists()
        heading(R.string.tasks_today).assertExists()
        compose.row("Report").assert(hasText("Work · Fri, Nov 13"))
        compose.row("Pills").assert(hasText("Inbox · 09:00 · Every day"))
        compose.row("Pay rent").assert(hasText("Home · 10:00 · Every month"))
        compose.row("Call the bank").assert(hasText("Inbox"))
        val tops = listOf("Report", "Pills", "Pay rent", "Call the bank").map { rowBounds(it).top }
        assertEquals("Overdue, then Today: by time, then those without", tops.sorted(), tops)
        assertTrue("Overdue is above Today", headingBounds(R.string.tasks_overdue).top < headingBounds(R.string.tasks_today).top)
        assertTrue("the heading Today is above its rows", headingBounds(R.string.tasks_today).bottom <= rowBounds("Pills").top)
        // Not due yet, or with no due day: not on Today.
        assertNoText("Buy milk")
        assertNoText("Dentist")
    }

    @Test
    fun aSectionWithNoTaskIsLeftOut() {
        seed { addTask("Report", Due(TODAY.minusDays(3))) }
        start(ready = "Report")

        heading(R.string.tasks_overdue).assertExists()
        assertTrue(compose.onAllNodes(sectionHeading(words(R.string.tasks_today))).fetchSemanticsNodes().isEmpty())
        assertNoText(words(R.string.tasks_nothing_due_today))
    }

    @Test
    fun aRowIsReadAsOneItemWithItsStateAndTwoActions() {
        seedToday()
        start(ready = "Pay rent")

        compose.row("Pay rent")
            .assert(hasContentDescription("Pay rent, due today at 10:00, every month, Home"))
            .assert(hasState("not done"))
            .assert(hasActions(words(R.string.tasks_mark_done)))
            .assert(hasEditAction)
        compose.row("Report").assert(hasContentDescription("Report, due Friday, November 13, Work"))
        compose.row("Call the bank").assert(hasContentDescription("Call the bank, due today, Inbox"))
        // The tick box is a touch target of its own, which TalkBack skips: the row offers the tick.
        tickBox("Pay rent").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.HideFromAccessibility))
    }

    @Test
    fun aTickMarksATaskDoneAndUndoBringsItBack() {
        seedToday()
        start(ready = "Call the bank")
        tickBox("Call the bank").performClick()

        compose.waitForText(words(R.string.tasks_task_done))
        compose.waitForGone(hasText("Call the bank"))
        assertTrue(storedTasks().single { it.title == "Call the bank" }.doneAt != null)
        compose.tap(R.string.tasks_undo)
        compose.waitForText("Call the bank")
        assertNull(storedTasks().single { it.title == "Call the bank" }.doneAt)
    }

    @Test
    fun aTickOnARepeatingTaskMovesItToItsNextDate() {
        seedToday()
        start(ready = "Pills")
        compose.tick("Pills", R.string.tasks_mark_done)

        compose.waitForText(words(R.string.tasks_next, "Tue, Nov 17"))
        compose.waitForGone(hasText("Pills"))
        val pills = storedTasks().single { it.title == "Pills" }
        assertTrue("it stays open", pills.isOpen)
        assertEquals(TODAY.plusDays(1), pills.due?.day)
    }

    @Test
    fun addATaskOnTodayMakesOneDueTodayInInbox() {
        start()
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))

        compose.field(words(R.string.tasks_title)).assertIsFocused()
        field(R.string.tasks_list, words(R.string.tasks_inbox)).assertExists()
        field(R.string.tasks_due_date, "Mon, Nov 16, 2026").assertExists()
        radio(R.string.tasks_once).assertIsSelected()
        // No Delete for a new task.
        assertTrue(compose.onAllNodes(hasText(words(R.string.tasks_delete)) and hasClickAction()).fetchSemanticsNodes().isEmpty())
        compose.field(words(R.string.tasks_title)).performTextInput("Call the bank")
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_task_added))
        compose.waitFor(hasText("Call the bank") and hasText("Inbox"))
        val stored = storedTasks().single()
        assertEquals("Call the bank", stored.title)
        assertEquals(Due(TODAY), stored.due)
    }

    @Test
    fun onAPhoneTheFormIsASheetInAWindowOfItsOwn() {
        start()
        val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))
        assertTrue(compose.onAllNodes(isRoot()).fetchSemanticsNodes().size > windowsBefore)
    }

    // The task form.

    @Test
    fun aWrongTitleShowsItsWordsAndSaveWritesNothing() {
        start()
        compose.tap(R.string.tasks_add)
        compose.tap(R.string.tasks_save)

        compose.waitFor(hasError(words(R.string.tasks_title_empty)))
        compose.onNode(hasText(words(R.string.tasks_new_task))).assertExists()
        assertTrue(storedTasks().isEmpty())

        compose.field(words(R.string.tasks_title)).performTextReplacement("x".repeat(201))
        compose.waitFor(hasError("A title has at most 200 characters."))
    }

    @Test
    fun everyWeekChoosesTheDayOfTheDateShowsTheDatesAndNeedsADay() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Gym")
        compose.tap(R.string.tasks_every_week)

        // A chip reads the whole day. The date is a Monday.
        val monday = compose.onNode(hasContentDescription("Monday") and hasClickAction())
        monday.assertIsSelected()
        compose.waitForText("Dates: Mon, Nov 16, Mon, Nov 23, Mon, Nov 30, …")
        compose.onNode(hasContentDescription("Wednesday") and hasClickAction()).tapAsTalkBack()
        compose.waitForText("Dates: Mon, Nov 16, Wed, Nov 18, Mon, Nov 23, …")
        compose.onNode(hasContentDescription("Wednesday") and hasClickAction()).tapAsTalkBack()
        monday.tapAsTalkBack()
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_choose_a_day))
        assertTrue(storedTasks().isEmpty())
    }

    @Test
    fun removeTakesTheDueDateTheRepeatAndTheReminder() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Pills")
        compose.tap(R.string.tasks_every_day)
        compose.tap(R.string.tasks_remind_me)
        compose.tap(R.string.tasks_remove)

        field(R.string.tasks_due_date, words(R.string.tasks_no_due_date)).assertExists()
        compose.onNode(hasText(words(R.string.tasks_add_due_date)) and hasClickAction()).assertExists()
        assertNoText(words(R.string.tasks_repeat))
        assertNoText(words(R.string.tasks_remind_me))
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_task_added))
        assertNull(storedTasks().single().due)
    }

    @Test
    fun remindMeStartsAtTheNextFullHourTodayAndThePickerRefusesATimeThatHasPassed() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Call the bank")
        compose.tap(R.string.tasks_remind_me)

        // 09:00 has passed at 09:30.
        field(R.string.tasks_time, "10:00").assertExists()
        compose.tap(hasContentDescription("${words(R.string.tasks_time)}, 10:00"))
        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("09")
        compose.field(words(DesignR.string.shk_minute)).performTextReplacement("15")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText(words(R.string.tasks_time_passed))

        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("11")
        compose.tap(DesignR.string.shk_ok)
        compose.waitFor(hasContentDescription("${words(R.string.tasks_time)}, 11:15"))
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_task_added))
        assertEquals(Due(TODAY, remindMinute = 11 * 60 + 15), storedTasks().single().due)
    }

    @Test
    fun aDateChosenInThePickerReachesTheForm() {
        seed { addAList("Home") }
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap("Home")
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))
        field(R.string.tasks_due_date, words(R.string.tasks_no_due_date)).assertExists()
        compose.tap(R.string.tasks_add_due_date)
        compose.tap("November 20, 2026", substring = true)
        compose.tap(DesignR.string.shk_ok)

        compose.waitFor(hasContentDescription("${words(R.string.tasks_due_date)}, Fri, Nov 20, 2026"))
        radio(R.string.tasks_once).assertIsSelected()
    }

    @Test
    fun theListDialogChoosesAListAtATap() {
        seed {
            addAList("Work")
            addAList("Home")
        }
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Call the bank")
        compose.tap(hasContentDescription("${words(R.string.tasks_list)}, ${words(R.string.tasks_inbox)}"))

        // Inbox first, then each list by name.
        val tops = listOf(words(R.string.tasks_inbox), "Home", "Work").map { name -> radioOf(name).fetchSemanticsNode().boundsInRoot.top }
        assertEquals(tops.sorted(), tops)
        radioOf(words(R.string.tasks_inbox)).assertIsSelected()
        compose.tap(hasText("Home") and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected))

        compose.waitForGone(hasText(words(R.string.tasks_inbox)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected))
        field(R.string.tasks_list, "Home").assertExists()
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_task_added))
        assertEquals(storedLists().single { it.name == "Home" }.id, storedTasks().single().listId)
    }

    @Test
    fun aSaveTheDatabaseRefusesSaysSoInTheFormAndTheFormStays() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Call the bank")
        refuseWritesOfTasks()
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_task_not_saved))
        compose.onNode(hasText(words(R.string.tasks_task_not_saved))).assertIsDisplayed()
        compose.onNode(hasText(words(R.string.tasks_new_task))).assertIsDisplayed()
        compose.field(words(R.string.tasks_title)).assert(hasText("Call the bank"))
        assertTrue(storedTasks().isEmpty())
    }

    @Test
    fun with5000TasksSaveSaysWhyAndTheFormStays() {
        seed { repeat(TaskLimits.MOST_TASKS) { addTask("Task ${it + 1}") } }
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("One more")
        compose.tap(R.string.tasks_save)

        compose.waitForText("Tasks keeps 5,000 tasks. Delete some to add more.")
        compose.onNode(hasText(words(R.string.tasks_new_task))).assertIsDisplayed()
        compose.field(words(R.string.tasks_title)).assert(hasText("One more"))
        assertEquals(TaskLimits.MOST_TASKS, storedTasks().size)
    }

    @Test
    fun aRowOpensItsFormWithoutTheKeyboardAndDeleteHasUndo() {
        seedToday()
        start(ready = "Pills")
        compose.tap(rowMatcher("Pills"))

        compose.waitForText(words(R.string.tasks_edit_task))
        compose.field(words(R.string.tasks_title)).assert(hasText("Pills")).assertIsNotFocused()
        radio(R.string.tasks_every_day).assertIsSelected()
        compose.tap(R.string.tasks_delete)

        compose.waitForText(words(R.string.tasks_task_deleted))
        compose.waitForGone(hasText("Pills"))
        compose.tap(R.string.tasks_undo)
        compose.waitForText("Pills")
        assertTrue(storedTasks().any { it.title == "Pills" })
    }

    @Test
    fun cancelClosesTheFormAndWritesNothing() {
        seedToday()
        start(ready = "Pills")
        compose.tap(rowMatcher("Pills"))
        compose.field(words(R.string.tasks_title)).performTextReplacement("Vitamins")
        compose.tap(R.string.tasks_cancel)

        compose.waitForGone(hasText(words(R.string.tasks_edit_task)))
        assertTrue(storedTasks().any { it.title == "Pills" })
        assertFalse(storedTasks().any { it.title == "Vitamins" })
    }

    /**
     * A title and a list's name are the user's own text: the keyboard is
     * asked not to learn them, and may still suggest (spec, "The task
     * form", point 1, and the owner's decision 10). The form is a sheet
     * and the name a dialog, each in a window of its own.
     */
    @Test
    fun theKeyboardIsAskedNotToLearnATitleOrAListName() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).assertIsFocused()
        assertTheKeyboardDoesNotLearn("the title")
        compose.tap(R.string.tasks_cancel)
        compose.waitForGone(hasText(words(R.string.tasks_new_task)))

        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.field(words(R.string.tasks_name)).assertIsFocused()
        assertTheKeyboardDoesNotLearn("a list's name")
    }

    /** The field that has the focus asks the keyboard not to learn what is typed, and still lets it suggest. */
    private fun assertTheKeyboardDoesNotLearn(what: String) {
        compose.waitForIdle()
        val info = EditorInfo()
        compose.runOnUiThread { checkNotNull(rootViews().firstNotNullOfOrNull(::textEditor)) { "no field has the focus" }.onCreateInputConnection(info) }
        assertTrue("$what: no learning", info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        assertEquals("$what: suggestions stay", 0, info.inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
    }

    /**
     * The root view of every window of the app: the screen's, and those of
     * a sheet or a dialog. Android keeps them in `WindowManagerGlobal`,
     * which it does not show to apps, so the test reads it by reflection.
     */
    @Suppress("UNCHECKED_CAST")
    private fun rootViews(): List<View> {
        val global = Class.forName("android.view.WindowManagerGlobal")
        val instance = global.getMethod("getInstance").invoke(null)
        val views = global.getDeclaredField("mViews").apply { isAccessible = true }.get(instance) as List<View>
        return views.toList()
    }

    /** The view that takes the keyboard's input: a Compose view, once one of its fields has the focus. */
    private fun textEditor(view: View): View? {
        if (view.onCheckIsTextEditor()) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) textEditor(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    // Lists.

    @Test
    fun listsShowInboxFirstThenEachListByNameWithItsCountOfOpenTasks() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.waitForText("Work")

        compose.row(words(R.string.tasks_inbox)).assert(hasText("1 open"))
        compose.row("Home").assert(hasText("3 open")).assert(hasContentDescription("Home, 3 open tasks"))
        compose.row("Work").assert(hasText("0 open")).assert(hasContentDescription("Work, 0 open tasks"))
        val tops = listOf(words(R.string.tasks_inbox), "Home", "Work").map { rowBounds(it).top }
        assertEquals(tops.sorted(), tops)
    }

    @Test
    fun newListAddsAListAndAWrongNameSaysWhy() {
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.field(words(R.string.tasks_name)).assertIsFocused()
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))

        compose.waitFor(hasError(words(R.string.tasks_name_empty)))
        compose.field(words(R.string.tasks_name)).performTextReplacement("x".repeat(61))
        compose.waitFor(hasError("A name has at most 60 characters."))
        compose.field(words(R.string.tasks_name)).performTextReplacement("Home")
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))

        compose.waitForGone(hasAnyAncestor(isDialog()))
        compose.waitFor(rowMatcher("Home"))
        assertEquals(listOf("Home"), storedLists().map { it.name })
    }

    @Test
    fun aListOpensInPlaceWithBackOnAPhone() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))

        compose.waitFor(hasText("Home") and isHeading())
        compose.onNode(hasContentDescription(words(DesignR.string.shk_back)) and hasClickAction()).assertExists()
        assertNoText("Work")
        pressBack()
        compose.waitForText("Work")
        destination(R.string.tasks_lists).assertIsSelected()
    }

    @Test
    fun aListShowsItsDueDaysWithoutItsNameAndItsDoneTasksUnderDone() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))
        compose.waitForText("Fix the tap")

        compose.row("Pay rent").assert(hasText("Today · 10:00 · Every month"))
            .assert(hasContentDescription("Pay rent, due today at 10:00, every month"))
        compose.row("Gym").assert(hasText("Fri, Nov 20 · Every week"))
            .assert(hasContentDescription("Gym, due Friday, November 20, every week"))
        // With no due day, nothing under the title.
        compose.row("Fix the tap").assert(hasContentDescription("Fix the tap"))
        assertEquals(listOf("Fix the tap"), compose.row("Fix the tap").fetchSemanticsNode().config[SemanticsProperties.Text].map { it.text })
        heading(R.string.tasks_done).assertExists()
        compose.row("Water the plants").assert(hasText("Done Mon, Nov 16"))
            .assert(hasState("done on Monday, November 16"))
            .assert(hasActions(words(R.string.tasks_mark_not_done)))
        val tops = listOf("Pay rent", "Gym", "Fix the tap", "Water the plants").map { rowBounds(it).top }
        assertEquals("by due day, then those with none, then Done", tops.sorted(), tops)
    }

    @Test
    fun aClearedTickInDoneOpensTheTaskAgainWithNoSnackbar() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))
        compose.waitForText("Water the plants")
        tickBox("Water the plants").performClick()

        compose.waitForGone(sectionHeading(words(R.string.tasks_done)))
        compose.row("Water the plants").assert(hasState("not done"))
        assertTrue(storedTasks().single { it.title == "Water the plants" }.isOpen)
        assertNoText(words(R.string.tasks_undo))
    }

    @Test
    fun addATaskInAListMakesOneInThatListWithNoDueDate() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Work"))
        compose.waitForText(words(R.string.tasks_list_empty_title))
        compose.waitForText(words(R.string.tasks_list_empty_body))
        compose.tap(R.string.tasks_add)

        field(R.string.tasks_list, "Work").assertExists()
        field(R.string.tasks_due_date, words(R.string.tasks_no_due_date)).assertExists()
        compose.field(words(R.string.tasks_title)).performTextInput("Report")
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_task_added))
        compose.waitFor(rowMatcher("Report"))
        val report = storedTasks().single { it.title == "Report" }
        assertEquals(storedLists().single { it.name == "Work" }.id, report.listId)
        assertNull(report.due)
    }

    @Test
    fun renameGivesTheListItsNewName() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Work"))
        openMenu()
        compose.tap(R.string.tasks_rename)

        compose.waitForText(words(R.string.tasks_rename_list))
        compose.field(words(R.string.tasks_name)).assert(hasText("Work")).performTextReplacement("Office")
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))

        compose.waitFor(hasText("Office") and isHeading())
        assertEquals(setOf("Home", "Office"), storedLists().map { it.name }.toSet())
    }

    @Test
    fun deleteListAsksFirstClosesTheListAndHasUndo() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))
        openMenu()
        compose.tap(R.string.tasks_delete_list)

        compose.waitForText("Delete the list Home?")
        compose.waitForText("This deletes 4 tasks.")
        compose.tap(hasText(words(R.string.tasks_delete)) and hasAnyAncestor(isDialog()))

        compose.waitForText(words(R.string.tasks_list_deleted))
        compose.waitFor(rowMatcher("Work"))
        assertNoRow("Home")
        assertEquals(listOf("Work"), storedLists().map { it.name })
        compose.tap(R.string.tasks_undo)
        compose.waitFor(rowMatcher("Home"))
        assertEquals(4, storedTasks().count { it.listId == storedLists().single { list -> list.name == "Home" }.id })
    }

    @Test
    fun deleteListOfAnEmptyListSaysItIsEmpty() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Work"))
        openMenu()
        compose.tap(R.string.tasks_delete_list)

        compose.waitForText("Delete the list Work?")
        compose.waitForText(words(R.string.tasks_delete_list_empty))
        compose.tap(hasText(words(R.string.tasks_cancel)) and hasAnyAncestor(isDialog()))
        compose.waitFor(hasText("Work") and isHeading())
    }

    @Test
    fun deleteDoneTasksAsksFirstAndHasUndo() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))
        openMenu()
        compose.tap(R.string.tasks_delete_done)

        compose.waitForText("Delete 1 done task?")
        compose.tap(hasText(words(R.string.tasks_delete)) and hasAnyAncestor(isDialog()))

        compose.waitForText("1 task deleted")
        compose.waitForGone(hasText("Water the plants"))
        compose.tap(R.string.tasks_undo)
        compose.waitForText("Water the plants")
    }

    @Test
    fun inboxCanBeNeitherRenamedNorDeleted() {
        seed { addTask("Buy milk") }
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher(words(R.string.tasks_inbox)))
        compose.waitForText("Buy milk")

        // With no done task, Inbox has no menu at all.
        assertTrue(compose.onAllNodes(hasContentDescription(words(DesignR.string.shk_more_options))).fetchSemanticsNodes().isEmpty())
        compose.tick("Buy milk", R.string.tasks_mark_done)
        compose.waitForText(words(R.string.tasks_task_done))
        openMenu()
        compose.waitForText(words(R.string.tasks_delete_done))
        assertNoText(words(R.string.tasks_rename))
        assertNoText(words(R.string.tasks_delete_list))
    }

    // From 840dp.

    @Test
    @Config(qualifiers = TABLET)
    fun inAnExpandedWindowTheListOpensBesideLists() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.waitForText(words(R.string.tasks_choose_a_list))
        compose.tap(rowMatcher("Home"))

        compose.waitFor(hasText("Home") and isHeading())
        compose.row("Home").assertIsSelected()
        compose.row("Work").assertExists()
        assertTrue("no Back beside Lists", compose.onAllNodes(hasContentDescription(words(DesignR.string.shk_back))).fetchSemanticsNodes().isEmpty())
        val heading = compose.onNode(hasText("Home") and isHeading()).fetchSemanticsNode().boundsInRoot
        assertTrue("the list is beside Lists", heading.left > rowBounds("Work").right)
    }

    @Test
    @Config(qualifiers = TABLET)
    fun inAnExpandedWindowTheFormIsStillASheet() {
        start()
        val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))
        assertTrue(compose.onAllNodes(isRoot()).fetchSemanticsNodes().size > windowsBefore)
    }

    @Test
    @Config(qualifiers = TABLET)
    fun listsKeepsItsOpenListAcrossDestinations() {
        seedLists()
        start(ready = "Pay rent")
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher("Home"))
        compose.waitFor(hasText("Home") and isHeading())

        compose.tap(R.string.tasks_settings)
        compose.waitForText(words(R.string.tasks_version))
        compose.tap(R.string.tasks_lists)
        compose.waitFor(hasText("Home") and isHeading())
    }

    // Navigation and Settings.

    @Test
    fun backFromListsOrSettingsGoesToTodayAndBackFromTodayLeaves() {
        start()
        compose.tap(R.string.tasks_settings)
        compose.waitForText(words(R.string.tasks_version))
        pressBack()
        destination(R.string.tasks_today).assertIsSelected()

        compose.tap(R.string.tasks_lists)
        pressBack()
        destination(R.string.tasks_today).assertIsSelected()

        // On Today nothing of Tasks takes Back, so Android leaves the app.
        scenario.onActivity { assertFalse(it.onBackPressedDispatcher.hasEnabledCallbacks()) }
    }

    @Test
    fun settingsShowTheVersionOfTheInstalledApp() {
        start()
        compose.tap(R.string.tasks_settings)
        var versionName = ""
        scenario.onActivity { versionName = it.packageManager.getPackageInfo(it.packageName, 0).versionName.orEmpty() }
        assertTrue(versionName.isNotEmpty())
        compose.waitFor(hasText(words(R.string.tasks_version)) and hasText(versionName))
    }

    /**
     * On Today: "Report", overdue since Friday, in Work; due today "Pills"
     * at 09:00 every day, and "Call the bank", in Inbox, and "Pay rent" at
     * 10:00 every month, in Home. "Dentist" is due on Friday and "Buy milk"
     * has no due day: neither is on Today.
     */
    private fun seedToday() = seed {
        val home = addAList("Home")
        val work = addAList("Work")
        addTask("Report", Due(TODAY.minusDays(3)), work.id)
        addTask("Call the bank", Due(TODAY))
        addTask("Pay rent", Due(TODAY, TaskRepeat(Repeat.MONTHLY, LocalDate.of(2026, 10, 16)), 10 * 60), home.id)
        addTask("Pills", Due(TODAY, TaskRepeat(Repeat.DAILY, TODAY), 9 * 60))
        addTask("Dentist", Due(TODAY.plusDays(4)))
        addTask("Buy milk")
    }

    /**
     * Home: "Pay rent", due today at 10:00 every month, "Gym" every
     * Wednesday and Friday from Wednesday, so due on Friday, "Fix the tap"
     * with no due day, and "Water the plants", done today. Work is empty.
     * Inbox has "Buy milk".
     */
    private fun seedLists(): TaskList = seed {
        val home = addAList("Home")
        addAList("Work")
        addTask("Pay rent", Due(TODAY, TaskRepeat(Repeat.MONTHLY, LocalDate.of(2026, 10, 16)), 10 * 60), home.id)
        addTask("Fix the tap", listId = home.id)
        val weekly = TaskRepeat(Repeat.WEEKLY, TODAY.plusDays(3), Weekdays.of(DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
        addTask("Gym", Due(TODAY.plusDays(4), weekly), home.id)
        val plants = addTask("Water the plants", listId = home.id)
        checkNotNull(tick(plants.id, null, Repeat.ONCE))
        addTask("Buy milk")
        home
    }

    /** Makes every write of a task fail from now on, as when the disk is full: a trigger aborts each insert and update. */
    private fun refuseWritesOfTasks() = runBlocking {
        testApp.test.database.useWriterConnection { connection ->
            val table = TaskEntity.TABLE
            connection.executeSQL("CREATE TRIGGER refuse_insert BEFORE INSERT ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
            connection.executeSQL("CREATE TRIGGER refuse_update BEFORE UPDATE ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
        }
    }

    /** The tick box of the row of [title]: its own touch target. A tap on it is a real touch at its middle. */
    private fun tickBox(title: String): SemanticsNodeInteraction {
        compose.waitFor(rowMatcher(title))
        return compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Checkbox) and hasParent(hasText(title)))
    }

    private fun rowBounds(name: String): Rect = compose.row(name).fetchSemanticsNode().boundsInRoot

    /** The section heading [label] in a list, not the top bar's title. */
    private fun heading(label: Int) = compose.onNode(sectionHeading(words(label)))

    private fun sectionHeading(text: String) =
        hasText(text) and isHeading() and hasAnyAncestor(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo))

    private fun headingBounds(label: Int): Rect = heading(label).fetchSemanticsNode().boundsInRoot

    /** The field of the form named [label], with [value] under it, as TalkBack reads it: "List, Home". */
    private fun field(label: Int, value: String) = compose.onNode(hasContentDescription("${words(label)}, $value"))

    private fun radio(label: Int) = radioOf(words(label))

    private fun radioOf(text: String) = compose.onNode(hasText(text) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected))

    private fun destination(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected) and !SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading),
    )

    private fun openMenu() = compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))

    private fun assertNoText(text: String) {
        compose.waitForIdle()
        assertTrue("$text shows", compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty())
    }

    private fun assertNoRow(name: String) {
        compose.waitForIdle()
        assertTrue("$name shows", compose.onAllNodes(rowMatcher(name)).fetchSemanticsNodes().isEmpty())
    }

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /** A row whose state, as TalkBack reads it after its text, is [state]. */
    private fun hasState(state: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, state)

    /** A row that offers TalkBack exactly the actions [labels], besides a tap. */
    private fun hasActions(vararg labels: String) = SemanticsMatcher("offers ${labels.joinToString()}") {
        it.config.getOrNull(SemanticsActions.CustomActions)?.map { action -> action.label } == labels.toList()
    }

    /** A row whose tap, as TalkBack offers it, is "Edit". */
    private val hasEditAction = SemanticsMatcher("has the action Edit") {
        it.config.getOrNull(SemanticsActions.OnClick)?.label == words(R.string.tasks_edit)
    }
}

/** The day the tests start on: Monday 16 November 2026. */
private val TODAY: LocalDate = THE_TIME.toLocalDate()

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
