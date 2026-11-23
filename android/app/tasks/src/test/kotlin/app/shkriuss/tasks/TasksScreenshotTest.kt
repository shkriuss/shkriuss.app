package app.shkriuss.tasks

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskRepeat
import app.shkriuss.feature.tasks.Weekdays
import app.shkriuss.feature.tasks.data.TaskEntity
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import java.time.DayOfWeek
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR

/**
 * Screenshots of every screen, sheet, dialog and menu of Tasks
 * (docs/apps/tasks/spec.md, "Screens"), in the four standard
 * configurations: phone light at font scale 1.0, phone dark at 2.0,
 * tablet light at 2.0 and tablet dark at 1.0. Each starts the real
 * activity with the app lock off, on a database written as the user
 * would have, on Monday 16 November 2026 at 09:30, with the 24-hour clock
 * of the spec's examples.
 *
 * A screen that scrolls is captured to its end, in parts, and so is the
 * form, a bottom sheet at every width. On the phone an open list is in
 * place of Lists; on the tablet it is beside Lists. A dialog or a menu is
 * captured with the screen dimmed behind it, and a snackbar over the
 * screen, once.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedTasksApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TasksScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private var scenario: ActivityScenario<TasksActivity>? = null

    @After
    fun closeTheScreen() {
        scenario?.close()
    }

    // Today.

    @Test
    fun todayEmpty() {
        start()
        compose.captureWholeScreen("TodayEmpty", config)
    }

    /** Overdue and Today, each kind of row: a reminder, a repeat, another list, Inbox, and a title that wraps. */
    @Test
    fun todayWithTasks() {
        seedTasks()
        start(ready = "Pills")
        compose.captureWholeScreen("TodayTasks", config, LIST)
    }

    /** Today right after a tick, with "Task done" and Undo at the bottom. */
    @Test
    fun todayWithTheSnackbarOfATick() {
        seedTasks()
        start(ready = "Pills")
        compose.tick("Call the bank", R.string.tasks_mark_done)
        compose.waitForText(words(R.string.tasks_task_done))
        compose.waitForGone(hasText("Call the bank"))
        captureWindows("TodaySnackbar")
    }

    /** While notifications cannot show and a reminder is to come: the line at the top, before the sections, with **Allow**. */
    @Test
    fun todayWithTheLineAboutNotifications() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seedTasks()
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_not_asked))
        compose.captureWholeScreen("TodayNotificationsLine", config, LIST)
    }

    /** The question before Android's own, after **Allow**. */
    @Test
    fun theQuestionForNotifications() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seedTasks()
        start(ready = "Pills")
        compose.tap(R.string.tasks_allow)
        compose.waitForText(words(R.string.tasks_question_text))
        captureWindows("NotificationsQuestion")
    }

    /** What every screen shows when the database cannot be read. */
    @Test
    fun todayWhenTheDatabaseCannotBeRead() {
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${TaskEntity.TABLE}") } }
        start(ready = words(R.string.tasks_could_not_open))
        compose.captureWholeScreen("TodayCouldNotOpen", config)
    }

    // The task form.

    /** A new task from Today: due today, in Inbox, Once, with the keyboard on the title. */
    @Test
    fun aNewTask() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))
        compose.captureWholeWindows("NewTask", config, FORM)
    }

    /** "Gym", every Monday, Wednesday and Friday, at 18:30, in Home: the days, the dates and the time. */
    @Test
    fun aTaskOpenToEdit() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(rowMatcher("Gym"))
        compose.waitForText(words(R.string.tasks_edit_task))
        compose.captureWholeWindows("EditTask", config, FORM)
    }

    /** A done task, with "Done on Mon, Nov 16." in its form. */
    @Test
    fun theFormOfADoneTask() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(rowMatcher("Water the plants"))
        compose.waitForText(words(R.string.tasks_edit_task))
        compose.captureWholeWindows("DoneTask", config, FORM)
    }

    /** Save with no title and Every week with no day: both say why. The time that has passed says so too. */
    @Test
    fun theFormWithItsErrors() {
        start()
        compose.tap(R.string.tasks_add)
        compose.tap(R.string.tasks_every_week)
        compose.onNode(hasContentDescription("Monday") and hasClickAction()).tapAsTalkBack()
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_choose_a_day))
        compose.captureWholeWindows("FormErrors", config, FORM)
    }

    /** A save that the database refused: the words above the buttons, and what was typed. */
    @Test
    fun theFormAfterASaveThatFailed() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Call the bank")
        runBlocking {
            testApp.test.database.useWriterConnection {
                it.executeSQL("CREATE TRIGGER refuse BEFORE INSERT ON ${TaskEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_task_not_saved))
        compose.captureWholeWindows("FormNotSaved", config, FORM)
    }

    /** The dialog of the field List: Inbox and every list, Inbox chosen. */
    @Test
    fun theListDialog() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(R.string.tasks_add)
        compose.tap(hasContentDescription("${words(R.string.tasks_list)}, ${words(R.string.tasks_inbox)}"))
        compose.waitFor(hasText("Home") and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected))
        captureWindows("ListDialog")
    }

    /** The time picker after a time that has passed: "That time has passed.", and it stays open. */
    @Test
    fun theTimePickerRefusesATimeThatHasPassed() {
        start()
        compose.tap(R.string.tasks_add)
        compose.tap(R.string.tasks_remind_me)
        compose.tap(hasContentDescription("${words(R.string.tasks_time)}, 10:00"))
        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("09")
        compose.field(words(DesignR.string.shk_minute)).performTextReplacement("15")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText(words(R.string.tasks_time_passed))
        captureWindows("TimePassed")
    }

    /**
     * The date picker of the form. Material's picker marks the real today,
     * which the test's clock does not set, in the month it shows. So it
     * shows a task due in June 2100, a month that is never today when the
     * tests run, and the image is the same on every day.
     */
    @Test
    fun theDatePicker() {
        seed { addTask("Open the time capsule", Due(LocalDate.of(2100, 6, 15))) }
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher(words(R.string.tasks_inbox)))
        compose.tap(rowMatcher("Open the time capsule"))
        compose.tap(hasContentDescription("${words(R.string.tasks_due_date)}, Tue, Jun 15, 2100"))
        compose.waitFor(hasText(words(DesignR.string.shk_ok)) and hasClickAction())
        captureWindows("DatePicker")
    }

    // Lists and one list.

    /** Inbox first, then each list by name, with its count of open tasks. On the tablet, "Choose a list." beside them. */
    @Test
    fun lists() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(R.string.tasks_lists)
        compose.waitFor(rowMatcher("Work"))
        compose.captureWholeScreen("Lists", config, LISTS)
    }

    /** Home: its open tasks with their due days, then Done. On the tablet, beside Lists, with Home marked. */
    @Test
    fun aListWithItsTasks() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.waitForText("Water the plants")
        compose.captureWholeScreen("ListTasks", config, hasScrollAction() and IS_A_LIST and hasAnyDescendant(hasText("Water the plants")))
    }

    @Test
    fun anEmptyList() {
        seedTasks()
        start(ready = "Pills")
        openList("Errands")
        compose.waitForText(words(R.string.tasks_list_empty_title))
        compose.captureWholeScreen("ListEmpty", config, LISTS.takeIf { config.device == ScreenshotConfig.Device.Tablet })
    }

    /** The menu of a list with done tasks: Rename, Delete list and Delete done tasks. */
    @Test
    fun theMenuOfAList() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.waitForText(words(R.string.tasks_delete_done))
        captureWindows("ListMenu")
    }

    /** New list after Save with no name: "Enter a name." under the field. */
    @Test
    fun theDialogOfNewList() {
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))
        compose.waitFor(hasError(words(R.string.tasks_name_empty)))
        captureWindows("NewList")
    }

    /** Rename, with the list's name in the field. */
    @Test
    fun theDialogOfRename() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_rename)
        compose.waitForText(words(R.string.tasks_rename_list))
        captureWindows("RenameList")
    }

    @Test
    fun theQuestionOfDeleteList() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_delete_list)
        compose.waitForText("Delete the list Home?")
        captureWindows("DeleteListQuestion")
    }

    @Test
    fun theQuestionOfDeleteDoneTasks() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_delete_done)
        compose.waitForText("Delete 1 done task?")
        captureWindows("DeleteDoneQuestion")
    }

    // Settings.

    @Test
    fun settings() {
        start()
        compose.tap(R.string.tasks_settings)
        compose.waitForText(words(R.string.tasks_version))
        compose.captureWholeScreen("Settings", config)
    }

    /** Opens Lists, then the list [name], and waits for its top bar. */
    private fun openList(name: String) {
        compose.tap(R.string.tasks_lists)
        compose.tap(rowMatcher(name))
        compose.waitFor(hasText(name) and isHeading())
    }

    /** Every window once, as they are: a sheet, a dialog, a menu or a snackbar over the screen. Roborazzi marks this as experimental. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun captureWindows(name: String) {
        compose.waitForIdle()
        captureScreenRoboImage("src/test/screenshots/${name}_${config.name}.png")
    }

    /** Starts Tasks on Today, and waits until it shows [ready]: a row, or the line for none. */
    private fun start(ready: String = words(R.string.tasks_nothing_due_today)) {
        use24HourClock()
        scenario = ActivityScenario.launch(TasksActivity::class.java)
        compose.waitForText(ready)
    }

    /**
     * Three lists and Inbox. On Today: "Report", overdue since Friday, in
     * Work, and the "Tax return" from last year; due today "Pills" at
     * 09:00 every day, "Gym" at 18:30 every Monday, Wednesday and Friday in
     * Home, "Call the bank", and a title that wraps. In Home also "Fix the
     * tap" with no due day, "Pay rent" due on Tuesday 1 December every
     * month, and "Water the plants", done. Errands is empty.
     */
    private fun seedTasks() = seed {
        val home = addAList("Home")
        val work = addAList("Work")
        addAList("Errands")
        addTask("Tax return", Due(LocalDate.of(2025, 12, 30)), work.id)
        addTask("Report", Due(TODAY.minusDays(3)), work.id)
        addTask("Pills", Due(TODAY, TaskRepeat(Repeat.DAILY, TODAY), 9 * 60))
        val gym = TaskRepeat(Repeat.WEEKLY, TODAY, Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
        addTask("Gym", Due(TODAY, gym, 18 * 60 + 30), home.id)
        addTask("Call the bank", Due(TODAY))
        addTask("Take the winter tyres to the garage before the first snow comes", Due(TODAY), home.id)
        addTask("Fix the tap", listId = home.id)
        addTask("Pay rent", Due(LocalDate.of(2026, 12, 1), TaskRepeat(Repeat.MONTHLY, LocalDate.of(2026, 12, 1)), 10 * 60), home.id)
        val plants = addTask("Water the plants", listId = home.id)
        checkNotNull(tick(plants.id, null, Repeat.ONCE))
    }

    companion object {
        /** The day the tests start on: Monday 16 November 2026. */
        private val TODAY: LocalDate = THE_TIME.toLocalDate()

        /** The form, in its sheet: the part that scrolls and holds Save. */
        private val FORM
            get() = hasScrollAction() and hasAnyDescendant(hasText(words(R.string.tasks_save)))

        /** A list of rows, not the navigation rail, which scrolls too on a tablet at font scale 2.0. */
        private val IS_A_LIST = SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)

        /** The list of Today: the part that scrolls and is a list. */
        private val LIST = hasScrollAction() and IS_A_LIST

        /** The rows of Lists: the part that scrolls, is a list and holds Inbox. */
        private val LISTS
            get() = hasScrollAction() and IS_A_LIST and hasAnyDescendant(hasText(words(R.string.tasks_inbox)))

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}
