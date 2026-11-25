package app.shkriuss.tasks

import android.content.Intent
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.security.AppLockActivity
import app.shkriuss.core.security.CreateRecoveryKeyActivity
import app.shkriuss.core.security.EnterRecoveryKeyActivity
import app.shkriuss.core.security.SecurityActivity
import app.shkriuss.core.security.R as SecurityR
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Due
import java.time.LocalDate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The sections Backup and Security of Settings, a backup and a restore,
 * the moment the recovery key is first needed, and Licences
 * (docs/apps/tasks/spec.md, "As in Water and Reminders", and Water's
 * spec, "Settings screen", "Backup and restore screens", "The recovery key
 * when first needed" and "Licences"), with the real activity, on Monday
 * 16 November 2026 at 09:30.
 *
 * Robolectric shows no file picker and no screen of core/security. The
 * test reads which screen Tasks opened, and closes it as the user would:
 * with the picked document, or with nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedTasksApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TasksBackupScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<TasksActivity>

    private val document = TestDocuments.uri(BACKUP_NAME)

    @Before
    fun aFilePicker() = pickerDocuments()

    @After
    fun closeTheScreen() {
        TestDocuments.onOpen = {}
        if (::scenario.isInitialized) scenario.close()
    }

    /** Starts Tasks and opens Settings. The two sections show once the keys were read. */
    private fun openSettings() {
        use24HourClock()
        scenario = ActivityScenario.launch(TasksActivity::class.java)
        compose.waitFor(hasText(words(R.string.tasks_add)) or hasContentDescription(words(R.string.tasks_add)))
        compose.tap(R.string.tasks_settings)
        compose.waitForText(words(R.string.tasks_make_backup))
    }

    private fun securityWords(id: Int): String = words(id)

    private fun assertNotShown(text: String) = compose.onAllNodes(hasText(text)).assertCountEquals(0)

    /** The class of the screen of core/security that Tasks opened for a result. */
    private fun openedScreen(): String? = scenario.openedForResult()?.component?.className

    private fun titles() = storedTasks().map { it.title }.sorted()

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    // What Settings shows.

    @Test
    fun withARecoveryKeyThereIsNoNoteAndTheRowsSayTheirState() {
        openSettings()

        assertNotShown(words(R.string.tasks_backup_note_no_key))
        assertNotShown(words(R.string.tasks_backup_note_unfinished))
        compose.onNode(hasContentDescription("Recovery key, Set up") and hasClickAction()).assertExists()
        compose.onNode(hasContentDescription("App lock, Off") and hasClickAction()).assertExists()
        listOf(R.string.tasks_section_backup, R.string.tasks_section_security, R.string.tasks_section_about).forEach {
            compose.onNode(hasText(words(it))).assert(isHeading())
        }
        listOf(R.string.tasks_make_backup, R.string.tasks_restore_backup, R.string.tasks_licences).forEach {
            compose.onNode(hasText(words(it)) and hasClickAction()).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
    }

    @Test
    @Config(application = NewTasksApp::class)
    fun withNoRecoveryKeyTheNoteSaysWhenItIsSetUpAndTheRowsStayEnabled() {
        openSettings()

        compose.onNode(hasText(words(R.string.tasks_backup_note_no_key))).assertExists()
        assertTrue(
            "the note is text, not a button",
            compose.onAllNodes(hasText(words(R.string.tasks_backup_note_no_key)) and hasClickAction()).fetchSemanticsNodes().isEmpty(),
        )
        compose.onNode(hasContentDescription("Recovery key, Not set up")).assertExists()
        compose.onNode(hasContentDescription("App lock, Off")).assertExists()
        compose.onNode(hasText(words(R.string.tasks_make_backup)) and hasClickAction()).assertExists()
        compose.onNode(hasText(words(R.string.tasks_restore_backup)) and hasClickAction()).assertExists()
    }

    @Test
    @Config(application = StoppedSetupTasksApp::class)
    fun afterASetupThatStoppedTheNoteAndTheRowSaySo() {
        openSettings()

        compose.onNode(hasText(words(R.string.tasks_backup_note_unfinished))).assertExists()
        compose.onNode(hasContentDescription("Recovery key, Setup not finished")).assertExists()

        compose.tap(R.string.tasks_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_finish_title))
        compose.tap(securityWords(SecurityR.string.sec_first_need_open_security))
        assertEquals(SecurityActivity::class.java.name, openedScreen())
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun withTheAppLockOnTheRowSaysOn() {
        openSettings()

        compose.onNode(hasContentDescription("App lock, On")).assertExists()
    }

    @Test
    fun recoveryKeyAlwaysOpensTheSecurityScreenAndAppLockItsScreen() {
        openSettings()

        compose.tap(R.string.tasks_recovery_key)
        scenario.onActivity { assertEquals(SecurityActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }

        compose.tap(R.string.tasks_app_lock)
        compose.waitUntil(5_000) {
            var opened: Intent? = null
            scenario.onActivity { opened = shadowOf(it).peekNextStartedActivity() }
            opened != null
        }
        scenario.onActivity { assertEquals(AppLockActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }
    }

    // A backup.

    @Test
    fun aBackupGoesToTheFilePickerWithTheSuggestedNameAndSaysHowManyTasksItHolds() {
        seed {
            val home = addAList("Home")
            addTask("Pills", dueToday(), home.id)
            addTask("Gym", dueToday())
            val gone = addTask("Old")
            deleteTask(gone.id)
        }
        openSettings()

        compose.tap(R.string.tasks_make_backup)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        assertEquals("application/octet-stream", picker.type)
        assertTrue(picker.hasCategory(Intent.CATEGORY_OPENABLE))

        compose.theOpenedScreenCloses(scenario, picked = document)

        compose.waitForText(words(R.string.tasks_backup_written_title))
        compose.onNode(hasText("The backup is written and checked. It holds 2 tasks.")).assertExists()
        assertTrue(TestDocuments.file(BACKUP_NAME).length() > 0)
        compose.tap(R.string.tasks_ok)
        assertNotShown(words(R.string.tasks_backup_written_title))
    }

    @Test
    fun leavingTheFilePickerWritesNothingAndShowsNothing() {
        openSettings()
        compose.tap(R.string.tasks_make_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }

        compose.theOpenedScreenCloses(scenario, picked = null)

        assertNotShown(words(R.string.tasks_backup_writing))
        assertNotShown(words(R.string.tasks_backup_written_title))
        assertTrue(TestDocuments.file(BACKUP_NAME).length() == 0L)
    }

    // A restore.

    @Test
    @Config(application = NotifyingTasksApp::class)
    fun aRestoreChecksTheFileAsksAndThenTakesIt() {
        seed {
            val home = addAList("Home")
            addTask("Pills", dueToday(), home.id)
            addTask("Gym", dueToday())
        }
        writeABackup()
        // As a new phone with the same recovery words: the database starts empty.
        (testApp as NotifyingTasksApp).startOnAPhoneWithNoData()
        assertEquals(emptyList<String>(), titles())
        openSettings()

        compose.tap(R.string.tasks_restore_backup)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        assertEquals("every file is offered: storage apps name the type differently", "*/*", picker.type)
        compose.theOpenedScreenCloses(scenario, picked = document)

        compose.waitForText(words(R.string.tasks_restore_question_title))
        compose.onNode(
            // The date is in the phone's format; the test's phone is set to American English.
            hasText("Made on November 16, 2026, 09:30. It holds 2 tasks. A restore cannot undo a deletion or an edit you made after the backup."),
        ).assertExists()
        compose.onNode(hasText(words(R.string.tasks_cancel)) and hasClickAction()).assertExists()

        compose.tap(R.string.tasks_restore)

        compose.waitForText(words(R.string.tasks_restored_title))
        compose.tap(R.string.tasks_ok)
        assertNotShown(words(R.string.tasks_restored_title))
        assertEquals(listOf("Gym", "Pills"), titles())
        assertEquals(listOf("Home"), storedLists().map { it.name })
        // Today and Lists show them at once: they read the database through a flow.
        compose.tap(R.string.tasks_today)
        compose.waitFor(rowMatcher("Pills"))
        compose.waitFor(rowMatcher("Gym"))
        compose.tap(R.string.tasks_lists)
        compose.waitFor(rowMatcher("Home"))
    }

    @Test
    fun cancelAtTheQuestionClosesItAndRestoresNothing() {
        seed { addTask("Pills", dueToday()) }
        writeABackup()
        // A task deleted after the backup: a restore would leave it deleted, and so does Cancel.
        val pills = storedTasks().single()
        seed { deleteTask(pills.id) }
        openSettings()

        compose.tap(R.string.tasks_restore_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        compose.theOpenedScreenCloses(scenario, picked = document)
        compose.waitForText(words(R.string.tasks_restore_question_title))
        compose.tap(R.string.tasks_cancel)

        assertNotShown(words(R.string.tasks_restore_question_title))
        assertNotShown(words(R.string.tasks_restored_title))
        assertEquals(emptyList<String>(), titles())
    }

    @Test
    fun aFileThatIsNoBackupIsNamedAndNothingChanges() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()

        compose.tap(R.string.tasks_restore_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        compose.theOpenedScreenCloses(scenario, picked = TestDocuments.uri("photo.jpg"))

        compose.waitForText(words(R.string.tasks_refused_not_a_backup_title))
        compose.onNode(hasText(words(R.string.tasks_refused_not_a_backup_text))).assertExists()
        compose.tap(R.string.tasks_ok)
        assertNotShown(words(R.string.tasks_refused_not_a_backup_title))
    }

    // The recovery key when first needed.

    @Test
    @Config(application = NewTasksApp::class)
    fun aBackupWithNoRecoveryKeyAsksFirstAndGoesOnToTheFilePickerWithoutAnotherTap() {
        openSettings()

        compose.tap(R.string.tasks_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_backup_text))).assertExists()
        // The owner's sentence: a key made in another app, such as Water, is entered with "I already have one".
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_other_app))).assertExists()
        assertNull("nothing is opened before the user chooses", scenario.openedForResult())

        compose.tap(securityWords(SecurityR.string.sec_first_need_create))
        assertEquals(CreateRecoveryKeyActivity::class.java.name, openedScreen())
        // The flow stores the keys, then its screen closes.
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        compose.waitFor(hasContentDescription("Recovery key, Set up"))
        assertNotShown(words(R.string.tasks_backup_note_no_key))
    }

    @Test
    @Config(application = NewTasksApp::class)
    fun aKeyOfAnotherAppIsEnteredWithIAlreadyHaveOneAndLeavingTheFlowLeavesSettingsAsItWas() {
        openSettings()
        compose.tap(R.string.tasks_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.tap(securityWords(SecurityR.string.sec_first_need_have_one))
        assertEquals(EnterRecoveryKeyActivity::class.java.name, openedScreen())

        compose.theOpenedScreenCloses(scenario)

        assertNull("no file picker", scenario.openedForResult())
        assertNotShown(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasContentDescription("Recovery key, Not set up")).assertExists()
    }

    @Test
    @Config(application = NewTasksApp::class)
    fun aRestoreWithNoRecoveryKeyAsksForTheWordsAndGoesOnToTheFilePicker() {
        openSettings()

        compose.tap(R.string.tasks_restore_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_enter_title))
        assertNotShown(securityWords(SecurityR.string.sec_first_need_create))
        assertNotShown(securityWords(SecurityR.string.sec_first_need_other_app))
        compose.tap(securityWords(SecurityR.string.sec_first_need_enter))
        assertEquals(EnterRecoveryKeyActivity::class.java.name, openedScreen())
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
    }

    @Test
    @Config(application = NewTasksApp::class)
    fun theAppLockWithNoRecoveryKeyAsksFirstAndNotNowClosesIt() {
        openSettings()

        compose.tap(R.string.tasks_app_lock)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_app_lock_text))).assertExists()
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_other_app))).assertExists()
        compose.tap(securityWords(SecurityR.string.sec_first_need_not_now))

        assertNotShown(securityWords(SecurityR.string.sec_first_need_set_up_title))
        assertNull(scenario.openedForResult())
    }

    // Licences.

    @Test
    fun licencesListsEveryPartByNameAndATapShowsItsNoticeAndItsLicence() {
        openSettings()

        compose.tap(R.string.tasks_licences)
        compose.waitForText(words(R.string.tasks_licences_intro))
        listOf(
            "AndroidX libraries",
            "BIP-39 English word list",
            "Jetpack Compose and Material 3",
            "Kotlin standard library",
            "kotlinx.coroutines",
            "Protocol Buffers, inside Tink",
            "Tink for Java",
        ).forEach {
            compose.onNode(hasText(it) and hasClickAction()).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }

        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
        compose.onNode(hasText(words(R.string.tasks_licence_notice))).assert(isHeading())
        compose.onNode(hasText("MIT License")).assert(isHeading())
        compose.onNode(hasText("Permission is hereby granted, free of charge", substring = true)).assertExists()

        // Back closes the notice, then Licences, then goes to Today.
        pressBack()
        compose.waitForText(words(R.string.tasks_licences_intro))
        pressBack()
        compose.waitForText(words(R.string.tasks_version))
        assertNotShown(words(R.string.tasks_licences_intro))
        pressBack()
        compose.waitFor(hasText(words(R.string.tasks_add)) or hasContentDescription(words(R.string.tasks_add)))
    }

    @Test
    @Config(application = UnlockedTasksApp::class, qualifiers = TABLET)
    fun onATabletTheNoticeOpensBesideTheList() {
        openSettings()

        compose.tap(R.string.tasks_licences)
        compose.waitForText(words(R.string.tasks_choose_a_part))

        compose.tap("Tink for Java")
        compose.waitForText("Copyright 2017 Google Inc.", substring = true)
        compose.onNode(hasText("AndroidX libraries") and hasClickAction()).assertExists()
        compose.onNode(hasText("Apache License 2.0") and isHeading()).assertExists()

        // Read to the end of one notice, then open another beside the list: it opens at its top.
        compose.onNode(hasText("END OF TERMS AND CONDITIONS", substring = true)).performScrollTo()
        compose.tap("Kotlin standard library")
        compose.waitForText("Copyright 2010-2024 JetBrains", substring = true)
        compose.onNode(hasText(words(R.string.tasks_licence_notice)) and isHeading()).assertIsDisplayed()
    }

    /** Due on the day of the tests, with no repeat and no reminder. */
    private fun dueToday() = Due(TODAY)
}

/** The day the tests start on: Monday 16 November 2026. */
private val TODAY: LocalDate = THE_TIME.toLocalDate()

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
