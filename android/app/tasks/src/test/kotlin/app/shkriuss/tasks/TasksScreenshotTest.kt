package app.shkriuss.tasks

import android.content.Intent
import android.net.Uri
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
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.security.R as SecurityR
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskLimits
import app.shkriuss.feature.tasks.TaskRepeat
import app.shkriuss.feature.tasks.TasksAlarms
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.Weekdays
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import java.io.File
import java.io.FileNotFoundException
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
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

    /** Holds a backup that is being written, so that its progress dialog stays. Opened again at the end of the test. */
    private val held = CountDownLatch(1)

    @After
    fun closeTheScreen() {
        held.countDown()
        TestDocuments.onOpen = {}
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

    /** After a No to Android's question: the line says notifications are off, with **Open settings**. */
    @Test
    fun todayWithTheLineWhenNotificationsAreOff() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        testApp.test.notify.permissionAnswered()
        seedTasks()
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_denied))
        compose.captureWholeScreen("TodayLineDenied", config, LIST)
    }

    /** With the channel turned off in Android's settings: the line names it, "Task reminders" (the owner's decision 11). */
    @Test
    fun todayWithTheLineWhenTheChannelIsOff() {
        seedTasks()
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).turnOff(TasksAlarms.CHANNEL)
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_channel_off))
        compose.captureWholeScreen("TodayLineChannelOff", config, LIST)
    }

    /** Today right after a tick on "Pills", every day: "Next:" and the next day, and Undo. */
    @Test
    fun todayWithTheSnackbarOfATickOnARepeatingTask() {
        seedTasks()
        start(ready = "Pills")
        compose.tick("Pills", R.string.tasks_mark_done)
        compose.waitForText(words(R.string.tasks_next, ""), substring = true)
        compose.waitForGone(hasText("Pills"))
        captureWindows("TodayNextSnackbar")
    }

    /** Today right after a Save of a new task: "Task added", with no Undo, once the sheet is gone. */
    @Test
    fun todayWithTheSnackbarOfANewTask() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Buy stamps")
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_task_added))
        compose.waitForGone(hasText(words(R.string.tasks_new_task)))
        captureWindows("TodayAddedSnackbar")
    }

    /** Today right after Delete in the form: "Task deleted" and Undo, once the sheet is gone. */
    @Test
    fun todayWithTheSnackbarOfADelete() {
        seedTasks()
        start(ready = "Pills")
        compose.tap(rowMatcher("Call the bank"))
        compose.waitForText(words(R.string.tasks_edit_task))
        compose.tap(R.string.tasks_delete)
        compose.waitForText(words(R.string.tasks_task_deleted))
        compose.waitForGone(hasText("Call the bank"))
        compose.waitForGone(hasText(words(R.string.tasks_edit_task)))
        captureWindows("TodayDeletedSnackbar")
    }

    /** A tick that the database refused: the row stays, and the snackbar says so, with no Undo. */
    @Test
    fun todayWithTheSnackbarOfATickThatFailed() {
        seedTasks()
        start(ready = "Pills")
        runBlocking {
            testApp.test.database.useWriterConnection {
                it.executeSQL("CREATE TRIGGER refuse BEFORE UPDATE ON ${TaskEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
        compose.tick("Call the bank", R.string.tasks_mark_done)
        compose.waitForText(words(R.string.tasks_could_not_change))
        captureWindows("TodayCouldNotChangeSnackbar")
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

    /** Save with no title and Every week with no day: both say why. */
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

    /**
     * Save with a title of 201 characters, and a reminder at 10:00 that
     * passed while the form was open: "A title has at most 200
     * characters." under the title, and "That time has passed." under
     * Time.
     */
    @Test
    fun theFormWithATitleTooLongAndATimeThatPassed() {
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput(LONG_TITLE)
        compose.tap(R.string.tasks_remind_me)
        compose.waitFor(hasContentDescription("${words(R.string.tasks_time)}, 10:00"))
        // The form was opened at 09:30. At 10:01 its reminder at 10:00 has passed.
        testApp.test.clock.advanceBy(31 * 60_000L)
        compose.tap(R.string.tasks_save)
        compose.waitForText(words(R.string.tasks_time_passed))
        compose.waitFor(hasError("A title has at most 200 characters."))
        compose.captureWholeWindows("FormTitleAndTimeErrors", config, FORM)
    }

    /** A new task while 5,000 are kept: the words above the buttons, and the form stays with what was typed. */
    @Test
    fun theFormWhen5000TasksAreKept() {
        seed { repeat(TaskLimits.MOST_TASKS) { addTask("Task ${it + 1}") } }
        start()
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("One more")
        compose.tap(R.string.tasks_save)
        compose.waitForText("Tasks keeps 5,000 tasks. Delete some to add more.")
        compose.captureWholeWindows("FormTasksLimit", config, FORM)
    }

    /** The form while the lists cannot be read: "Could not open your tasks.", with Cancel. */
    @Test
    fun theFormWhenTheDatabaseCannotBeRead() {
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${TaskListEntity.TABLE}") } }
        start(ready = words(R.string.tasks_could_not_open))
        compose.tap(R.string.tasks_add)
        compose.waitForText(words(R.string.tasks_new_task))
        captureWindows("FormCouldNotOpen")
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

    /** Delete list on Errands, which has no task: "The list is empty." */
    @Test
    fun theQuestionOfDeleteListOfAnEmptyList() {
        seedTasks()
        start(ready = "Pills")
        openList("Errands")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_delete_list)
        compose.waitForText(words(R.string.tasks_delete_list_empty))
        captureWindows("DeleteEmptyListQuestion")
    }

    /** New list after Save with a name of 61 characters: "A name has at most 60 characters." */
    @Test
    fun theDialogOfNewListWithANameTooLong() {
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.field(words(R.string.tasks_name)).performTextInput(LONG_TITLE.take(TaskLimits.MOST_NAME_CODE_POINTS + 1))
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))
        compose.waitFor(hasError("A name has at most 60 characters."))
        captureWindows("NewListNameTooLong")
    }

    /** New list while 100 lists are kept: "Tasks keeps 100 lists. Delete one to add another." */
    @Test
    fun theDialogOfNewListWhen100ListsAreKept() {
        seed { repeat(TaskLimits.MOST_LISTS) { addAList("List ${it + 1}") } }
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.field(words(R.string.tasks_name)).performTextInput("Garden")
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))
        compose.waitFor(hasError("Tasks keeps 100 lists. Delete one to add another."))
        captureWindows("NewListListsLimit")
    }

    /** New list when the database refuses the write: "Could not save the list. Try again.", and the name stays. */
    @Test
    fun theDialogOfNewListAfterASaveThatFailed() {
        start()
        compose.tap(R.string.tasks_lists)
        compose.tap(R.string.tasks_new_list)
        compose.field(words(R.string.tasks_name)).performTextInput("Garden")
        runBlocking {
            testApp.test.database.useWriterConnection {
                it.executeSQL("CREATE TRIGGER refuse BEFORE INSERT ON ${TaskListEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
        compose.tap(hasText(words(R.string.tasks_save)) and hasAnyAncestor(isDialog()))
        compose.waitFor(hasError(words(R.string.tasks_list_not_saved)))
        captureWindows("NewListNotSaved")
    }

    /** Lists right after Delete list on Home: "List deleted" and Undo. On the tablet, beside "Choose a list." */
    @Test
    fun listsWithTheSnackbarOfDeleteList() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_delete_list)
        compose.tap(hasText(words(R.string.tasks_delete)) and hasAnyAncestor(isDialog()))
        compose.waitForText(words(R.string.tasks_list_deleted))
        compose.waitForGone(rowMatcher("Home"))
        captureWindows("ListDeletedSnackbar")
    }

    /** Home right after Delete done tasks, with two done: "2 tasks deleted" and Undo. */
    @Test
    fun aListWithTheSnackbarOfDeleteDoneTasks() {
        seedTasks()
        seed {
            val tap = tasks().first().single { it.title == "Fix the tap" }
            checkNotNull(tick(tap.id, null, Repeat.ONCE))
        }
        start(ready = "Pills")
        openList("Home")
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        compose.tap(R.string.tasks_delete_done)
        compose.tap(hasText(words(R.string.tasks_delete)) and hasAnyAncestor(isDialog()))
        compose.waitForText("2 tasks deleted")
        compose.waitForGone(hasText("Water the plants"))
        captureWindows("DoneDeletedSnackbar")
    }

    /** Lists when the database cannot be read: "Could not open your tasks." On the tablet, beside "Choose a list." */
    @Test
    fun listsWhenTheDatabaseCannotBeRead() {
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${TaskListEntity.TABLE}") } }
        start(ready = words(R.string.tasks_could_not_open))
        compose.tap(R.string.tasks_lists)
        compose.waitFor(hasText(words(R.string.tasks_lists)) and isHeading())
        compose.waitForText(words(R.string.tasks_could_not_open))
        compose.captureWholeScreen("ListsCouldNotOpen", config)
    }

    /**
     * An open list when the database can no longer be read: "Could not
     * open your tasks.", and the top bar keeps the list's name. The
     * column of the deletion marker is renamed, so every read of the tasks
     * fails, and a write tells the screens to read again.
     */
    @Test
    fun aListWhenTheDatabaseCannotBeRead() {
        seedTasks()
        start(ready = "Pills")
        openList("Home")
        compose.waitForText("Water the plants")
        runBlocking {
            testApp.test.database.useWriterConnection {
                it.executeSQL("ALTER TABLE ${TaskEntity.TABLE} RENAME COLUMN deletedAt TO gone")
                it.executeSQL("UPDATE ${TaskEntity.TABLE} SET title = title")
            }
        }
        compose.waitForText(words(R.string.tasks_could_not_open))
        compose.captureWholeScreen("ListCouldNotOpen", config)
    }

    // Settings, Backup, Security and Licences.

    @Test
    fun settings() {
        openSettings()
        compose.captureWholeScreen("Settings", config)
    }

    @Test
    @Config(application = NewTasksApp::class)
    fun settingsWithNoRecoveryKey() {
        openSettings()
        compose.captureWholeScreen("SettingsNoRecoveryKey", config)
    }

    @Test
    @Config(application = StoppedSetupTasksApp::class)
    fun settingsAfterASetupThatStopped() {
        openSettings()
        compose.captureWholeScreen("SettingsSetupNotFinished", config)
    }

    /** With the owner's sentence about a recovery key made in another app. */
    @Test
    @Config(application = NewTasksApp::class)
    fun theDialogWhenTheRecoveryKeyIsFirstNeededForABackup() {
        openSettings()
        compose.tap(R.string.tasks_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        captureWindows("FirstNeedBackup")
    }

    @Test
    fun theProgressDialogWhileABackupIsWritten() {
        pickerDocuments()
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openSettings()
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_writing))
        captureWindows("BackupWriting")
    }

    @Test
    fun theDialogWhenABackupIsWrittenAndChecked() {
        pickerDocuments()
        seedTasks()
        openSettings(ready = "Pills")
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_written_title))
        captureWindows("BackupWritten")
    }

    @Test
    fun theQuestionBeforeARestore() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_restore_question_title))
        captureWindows("RestoreQuestion")
    }

    @Test
    fun theDialogWhenABackupIsRestored() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.tasks_restore)
        compose.waitForText(words(R.string.tasks_restored_title))
        captureWindows("BackupRestored")
    }

    @Test
    fun theAnswerForAFileThatIsNoBackup() {
        pickerDocuments()
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
        compose.waitForText(words(R.string.tasks_refused_not_a_backup_title))
        captureWindows("RestoreNotABackup")
    }

    @Test
    fun theDialogWhenABackupCannotBeWritten() {
        pickerDocuments()
        seedTasks()
        TestDocuments.onOpen = { mode -> if (mode == "wt") throw FileNotFoundException("the storage app refuses") }
        openSettings(ready = "Pills")
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_not_written_title))
        captureWindows("BackupNotWritten")
    }

    @Test
    fun theDialogWhenABackupIsWrittenButCannotBeReadAgain() {
        pickerDocuments()
        seedTasks()
        TestDocuments.onOpen = { mode -> if (mode == "r") throw FileNotFoundException("the storage app refuses to read") }
        openSettings(ready = "Pills")
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_not_checked_title))
        captureWindows("BackupNotChecked")
    }

    @Test
    fun theDialogWhenABackupIsWrittenButFailsItsCheck() {
        pickerDocuments()
        seedTasks()
        // The storage loses the end of the file between the write and the check.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                val file = TestDocuments.file(BACKUP_NAME)
                file.writeBytes(file.readBytes().dropLast(10).toByteArray())
            }
        }
        openSettings(ready = "Pills")
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_not_usable_title))
        captureWindows("BackupNotUsable")
    }

    @Test
    fun theProgressDialogWhileAFileIsChecked() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        // The storage does not answer, so "Checking the backup" stays on screen. Then the read fails, and nothing changes.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                held.await()
                throw FileNotFoundException("the test has ended")
            }
        }
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_backup_checking))
        captureWindows("BackupChecking")
    }

    @Test
    fun theProgressDialogWhileABackupIsRestored() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        // The first read is the check before the question. The storage does not answer the next one, the restore, so
        // "Restoring the backup" stays on screen. Then the read fails, and nothing changes.
        val reads = AtomicInteger()
        TestDocuments.onOpen = { mode ->
            if (mode == "r" && reads.incrementAndGet() > 1) {
                held.await()
                throw FileNotFoundException("the test has ended")
            }
        }
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.tasks_restore)
        compose.waitForText(words(R.string.tasks_backup_restoring))
        captureWindows("BackupRestoring")
    }

    @Test
    fun theAnswerForABackupOfANewerVersion() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 2))
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_refused_newer_title))
        captureWindows("RestoreNewerVersion")
    }

    @Test
    fun theAnswerForABackupOfAnotherApp() {
        pickerDocuments()
        val notes = AppName.of("notes")
        val backup = writeABackupOf(OtherContent(dataVersion = 1), crypto = keysOfOtherWords(notes), appName = notes)
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_refused_other_app_title))
        captureWindows("RestoreOtherApp")
    }

    /** The longest words of a restore: the short name of the key comes from fixed words, so it is the same in every run. */
    @Test
    fun theAnswerForABackupMadeWithOtherWords() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 1), crypto = keysOfOtherWords(TasksServices.APP_NAME))
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_refused_other_key_title))
        captureWindows("RestoreOtherKey")
    }

    @Test
    fun theAnswerForAFileThatIsCutShort() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        val file = TestDocuments.file(BACKUP_NAME)
        file.writeBytes(file.readBytes().dropLast(1).toByteArray())
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_refused_damaged_title))
        captureWindows("RestoreDamaged")
    }

    @Test
    fun theAnswerForAFileThatCannotBeRead() {
        pickerDocuments()
        TestDocuments.onOpen = { throw FileNotFoundException("the storage app refuses") }
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_not_read_title))
        captureWindows("RestoreNotRead")
    }

    @Test
    fun theAnswerWhenTheBackupCannotBePutAside() {
        pickerDocuments()
        seedTasks()
        val backup = writeABackup()
        openSettings(ready = "Pills")
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.tasks_restore_question_title))
        // The staging folder cannot be made: a file stands in its place.
        File(RuntimeEnvironment.getApplication().noBackupFilesDir, "shk-restore").apply {
            deleteRecursively()
            writeText("in the way")
        }
        compose.tap(R.string.tasks_restore)
        compose.waitForText(words(R.string.tasks_no_room_title))
        captureWindows("RestoreNoRoom")
    }

    @Test
    fun theAnswerForABackupWithSomethingTasksCannotRead() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 1, listOf(otherRecord("note"))))
        openSettings()
        pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.tasks_restore)
        compose.waitForText(words(R.string.tasks_unreadable_title))
        captureWindows("RestoreUnreadable")
    }

    @Test
    fun licences() {
        openSettings()
        compose.tap(R.string.tasks_licences)
        compose.waitForText(words(R.string.tasks_licences_intro))
        compose.captureWholeScreen("Licences", config)
    }

    /** The shortest licence, so that the whole notice fits in a few images. */
    @Test
    fun theNoticeOfOnePartOfLicences() {
        openSettings()
        compose.tap(R.string.tasks_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
        compose.captureWholeScreen("LicenceNotice", config)
    }

    /** Starts Tasks, waits until Today shows [ready], and opens Settings, with all of its sections. */
    private fun openSettings(ready: String = words(R.string.tasks_nothing_due_today)) {
        start(ready)
        compose.tap(R.string.tasks_settings)
        compose.waitForSettings()
    }

    /** Taps the row [row] of Settings and picks [document] in the file picker that Tasks opens with [action]. */
    private fun pick(row: Int, action: String, document: Uri) {
        compose.tap(row)
        val shown = checkNotNull(scenario)
        compose.waitForOpened(shown) { it.action == action }
        compose.theOpenedScreenCloses(shown, picked = document)
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
        /** A title of 201 characters, one more than a title may have, in words, so that it wraps as a real one would. */
        private val LONG_TITLE: String =
            "Take the winter tyres to the garage before the first snow comes, and ask about the noise of the brakes. "
                .repeat(2)
                .take(TaskLimits.MOST_TITLE_CODE_POINTS + 1)

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
