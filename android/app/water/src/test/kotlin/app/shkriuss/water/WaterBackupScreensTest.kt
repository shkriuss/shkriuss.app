package app.shkriuss.water

import android.content.Intent
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.security.AppLockActivity
import app.shkriuss.core.security.CreateRecoveryKeyActivity
import app.shkriuss.core.security.EnterRecoveryKeyActivity
import app.shkriuss.core.security.SecurityActivity
import app.shkriuss.core.security.R as SecurityR
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.water.R
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
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
 * (docs/apps/water/spec.md, "Settings screen", "Backup and restore
 * screens", "The recovery key when first needed" and "Licences"), with
 * the real activity, on Friday 13 November 2026 at 14:05.
 *
 * Robolectric shows no file picker and no screen of core/security. The
 * test reads which screen Water opened, and closes it as the user would:
 * with the picked document, or with nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedWaterApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WaterBackupScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<WaterActivity>

    private val document = TestDocuments.uri(BACKUP_NAME)

    @Before
    fun aFilePicker() = pickerDocuments()

    @After
    fun closeTheScreen() {
        TestDocuments.onOpen = {}
        if (::scenario.isInitialized) scenario.close()
    }

    /** Starts Water and opens Settings. The two sections show once the keys were read. */
    private fun openSettings() {
        use24HourClock()
        scenario = ActivityScenario.launch(WaterActivity::class.java)
        compose.waitForText(words(R.string.water_other_amount))
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_make_backup))
    }

    private fun securityWords(id: Int): String = words(id)

    private fun assertNotShown(text: String) = compose.onAllNodes(hasText(text)).assertCountEquals(0)

    /** The class of the screen of core/security that Water opened for a result. */
    private fun openedScreen(): String? = scenario.openedForResult()?.component?.className

    private fun drinks() = runBlocking { testApp.test.services.repository.drinksOf(THE_DAY).first() }

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    // What Settings shows.

    @Test
    fun withARecoveryKeyThereIsNoNoteAndTheRowsSayTheirState() {
        openSettings()

        assertNotShown(words(R.string.water_backup_note_no_key))
        assertNotShown(words(R.string.water_backup_note_unfinished))
        compose.onNode(hasContentDescription("Recovery key, Set up") and hasClickAction()).assertExists()
        compose.onNode(hasContentDescription("App lock, Off") and hasClickAction()).assertExists()
        listOf(R.string.water_section_backup, R.string.water_section_security, R.string.water_section_about).forEach {
            compose.onNode(hasText(words(it))).assert(isHeading())
        }
        listOf(R.string.water_make_backup, R.string.water_restore_backup, R.string.water_licences).forEach {
            compose.onNode(hasText(words(it)) and hasClickAction()).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
    }

    @Test
    @Config(application = NewWaterApp::class)
    fun withNoRecoveryKeyTheNoteSaysWhenItIsSetUpAndTheRowsStayEnabled() {
        openSettings()

        compose.onNode(hasText(words(R.string.water_backup_note_no_key))).assertExists()
        assertTrue("the note is text, not a button", compose.onAllNodes(hasText(words(R.string.water_backup_note_no_key)) and hasClickAction()).fetchSemanticsNodes().isEmpty())
        compose.onNode(hasContentDescription("Recovery key, Not set up")).assertExists()
        compose.onNode(hasContentDescription("App lock, Off")).assertExists()
        compose.onNode(hasText(words(R.string.water_make_backup)) and hasClickAction()).assertExists()
        compose.onNode(hasText(words(R.string.water_restore_backup)) and hasClickAction()).assertExists()
    }

    @Test
    @Config(application = StoppedSetupWaterApp::class)
    fun afterASetupThatStoppedTheNoteAndTheRowSaySo() {
        openSettings()

        compose.onNode(hasText(words(R.string.water_backup_note_unfinished))).assertExists()
        compose.onNode(hasContentDescription("Recovery key, Setup not finished")).assertExists()

        compose.tap(R.string.water_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_finish_title))
        compose.tap(securityWords(SecurityR.string.sec_first_need_open_security))
        assertEquals(SecurityActivity::class.java.name, openedScreen())
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun withTheAppLockOnTheRowSaysOn() {
        openSettings()

        compose.onNode(hasContentDescription("App lock, On")).assertExists()
    }

    @Test
    fun recoveryKeyAlwaysOpensTheSecurityScreenAndAppLockItsScreen() {
        openSettings()

        compose.tap(R.string.water_recovery_key)
        scenario.onActivity { assertEquals(SecurityActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }

        compose.tap(R.string.water_app_lock)
        compose.waitUntil(5_000) {
            var opened: Intent? = null
            scenario.onActivity { opened = shadowOf(it).peekNextStartedActivity() }
            opened != null
        }
        scenario.onActivity { assertEquals(AppLockActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }
    }

    // A backup.

    @Test
    fun aBackupGoesToTheFilePickerWithTheSuggestedNameAndSaysHowManyDrinksItHolds() {
        seed {
            addDrink(THE_DAY, 9 * 60, 250)
            addDrink(THE_DAY, 11 * 60, 500)
            val gone = addDrink(THE_DAY, 12 * 60, 150)
            deleteDrink(gone.id)
        }
        openSettings()

        compose.tap(R.string.water_make_backup)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        assertEquals("application/octet-stream", picker.type)
        assertTrue(picker.hasCategory(Intent.CATEGORY_OPENABLE))

        compose.theOpenedScreenCloses(scenario, picked = document)

        compose.waitForText(words(R.string.water_backup_written_title))
        compose.onNode(hasText("The backup is written and checked. It holds 2 drinks.")).assertExists()
        assertTrue(TestDocuments.file(BACKUP_NAME).length() > 0)
        compose.tap(R.string.water_ok)
        assertNotShown(words(R.string.water_backup_written_title))
    }

    @Test
    fun leavingTheFilePickerWritesNothingAndShowsNothing() {
        openSettings()
        compose.tap(R.string.water_make_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }

        compose.theOpenedScreenCloses(scenario, picked = null)

        assertNotShown(words(R.string.water_backup_writing))
        assertNotShown(words(R.string.water_backup_written_title))
        assertTrue(TestDocuments.file(BACKUP_NAME).length() == 0L)
    }

    // A restore.

    @Test
    fun aRestoreChecksTheFileAsksAndThenTakesIt() {
        seed {
            addDrink(THE_DAY, 9 * 60, 250)
            addDrink(THE_DAY, 11 * 60, 500)
        }
        writeABackup()
        openSettings()

        compose.tap(R.string.water_restore_backup)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        assertEquals("every file is offered: storage apps name the type differently", "*/*", picker.type)
        compose.theOpenedScreenCloses(scenario, picked = document)

        compose.waitForText(words(R.string.water_restore_question_title))
        compose.onNode(
            // The date is in the phone's format; the test's phone is set to American English.
            hasText("Made on November 13, 2026, 14:05. It holds 2 drinks. A restore cannot undo a deletion or an edit you made after the backup."),
        ).assertExists()
        compose.onNode(hasText(words(R.string.water_cancel)) and hasClickAction()).assertExists()

        compose.tap(R.string.water_restore)

        compose.waitForText(words(R.string.water_restored_title))
        compose.tap(R.string.water_ok)
        assertNotShown(words(R.string.water_restored_title))
        assertEquals(listOf(500, 250), drinks().map { it.amountMl })
    }

    @Test
    fun cancelAtTheQuestionClosesItAndRestoresNothing() {
        seed { addDrink(THE_DAY, 9 * 60, 250) }
        writeABackup()
        // A drink deleted after the backup: a restore would leave it deleted, and so does Cancel.
        val drink = drinks().single()
        seed { deleteDrink(drink.id) }
        openSettings()

        compose.tap(R.string.water_restore_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        compose.theOpenedScreenCloses(scenario, picked = document)
        compose.waitForText(words(R.string.water_restore_question_title))
        compose.tap(R.string.water_cancel)

        assertNotShown(words(R.string.water_restore_question_title))
        assertNotShown(words(R.string.water_restored_title))
        assertEquals(emptyList<Int>(), drinks().map { it.amountMl })
    }

    @Test
    fun aFileThatIsNoBackupIsNamedAndNothingChanges() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()

        compose.tap(R.string.water_restore_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        compose.theOpenedScreenCloses(scenario, picked = TestDocuments.uri("photo.jpg"))

        compose.waitForText(words(R.string.water_refused_not_a_backup_title))
        compose.onNode(hasText(words(R.string.water_refused_not_a_backup_text))).assertExists()
        compose.tap(R.string.water_ok)
        assertNotShown(words(R.string.water_refused_not_a_backup_title))
    }

    // The recovery key when first needed.

    @Test
    @Config(application = NewWaterApp::class)
    fun aBackupWithNoRecoveryKeyAsksFirstAndGoesOnToTheFilePickerWithoutAnotherTap() {
        openSettings()

        compose.tap(R.string.water_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_backup_text))).assertExists()
        assertNull("nothing is opened before the user chooses", scenario.openedForResult())

        compose.tap(securityWords(SecurityR.string.sec_first_need_create))
        assertEquals(CreateRecoveryKeyActivity::class.java.name, openedScreen())
        // The flow stores the keys, then its screen closes.
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        compose.waitFor(hasContentDescription("Recovery key, Set up"))
        assertNotShown(words(R.string.water_backup_note_no_key))
    }

    @Test
    @Config(application = NewWaterApp::class)
    fun leavingTheFlowWithoutAKeyLeavesSettingsAsItWas() {
        openSettings()
        compose.tap(R.string.water_make_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.tap(securityWords(SecurityR.string.sec_first_need_have_one))
        assertEquals(EnterRecoveryKeyActivity::class.java.name, openedScreen())

        compose.theOpenedScreenCloses(scenario)

        assertNull("no file picker", scenario.openedForResult())
        assertNotShown(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasContentDescription("Recovery key, Not set up")).assertExists()
    }

    @Test
    @Config(application = NewWaterApp::class)
    fun aRestoreWithNoRecoveryKeyAsksForTheWordsAndGoesOnToTheFilePicker() {
        openSettings()

        compose.tap(R.string.water_restore_backup)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_enter_title))
        assertNotShown(securityWords(SecurityR.string.sec_first_need_create))
        compose.tap(securityWords(SecurityR.string.sec_first_need_enter))
        assertEquals(EnterRecoveryKeyActivity::class.java.name, openedScreen())
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
    }

    @Test
    @Config(application = NewWaterApp::class)
    fun theAppLockWithNoRecoveryKeyAsksFirstAndNotNowClosesIt() {
        openSettings()

        compose.tap(R.string.water_app_lock)
        compose.waitForText(securityWords(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(securityWords(SecurityR.string.sec_first_need_app_lock_text))).assertExists()
        compose.tap(securityWords(SecurityR.string.sec_first_need_not_now))

        assertNotShown(securityWords(SecurityR.string.sec_first_need_set_up_title))
        assertNull(scenario.openedForResult())
    }

    // Licences.

    @Test
    fun licencesListsEveryPartByNameAndATapShowsItsNoticeAndItsLicence() {
        openSettings()

        compose.tap(R.string.water_licences)
        compose.waitForText(words(R.string.water_licences_intro))
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
        compose.onNode(hasText(words(R.string.water_licence_notice))).assert(isHeading())
        compose.onNode(hasText("MIT License")).assert(isHeading())
        compose.onNode(hasText("Permission is hereby granted, free of charge", substring = true)).assertExists()

        // Back closes the notice, then Licences, then goes to Today.
        pressBack()
        compose.waitForText(words(R.string.water_licences_intro))
        pressBack()
        compose.waitForText(words(R.string.water_version))
        assertNotShown(words(R.string.water_licences_intro))
        pressBack()
        compose.waitForText(words(R.string.water_other_amount))
    }

    @Test
    @Config(application = UnlockedWaterApp::class, qualifiers = TABLET)
    fun onATabletTheNoticeOpensBesideTheList() {
        openSettings()

        compose.tap(R.string.water_licences)
        compose.waitForText(words(R.string.water_choose_a_part))

        compose.tap("Tink for Java")
        compose.waitForText("Copyright 2017 Google Inc.", substring = true)
        compose.onNode(hasText("AndroidX libraries") and hasClickAction()).assertExists()
        compose.onNode(hasText("Apache License 2.0") and isHeading()).assertExists()
    }
}

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
