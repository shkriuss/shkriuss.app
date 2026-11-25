package app.shkriuss.notes

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
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
import app.shkriuss.feature.notes.R
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * The sections Backup and Security of Settings, a backup and a restore
 * with their progress, the moment the recovery key is first needed, and
 * Licences (docs/apps/notes/spec.md, "As in Water and Tasks" and
 * "Writing", and Water's spec, "Settings screen", "Backup and restore
 * screens", "The recovery key when first needed" and "Licences"), with
 * the real activity, on Tuesday 24 November 2026 at 09:30 UTC.
 *
 * Robolectric shows no file picker and no screen of core/security. The
 * test reads which screen Notes opened, and closes it as the user would:
 * with the picked document, or with nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedNotesApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotesBackupScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<NotesActivity>

    private val document = TestDocuments.uri(BACKUP_NAME)

    /** Holds a backup or a restore, so that its dialog stays. Let go at the end of the test. */
    private val held = CountDownLatch(1)

    @Before
    fun aFilePicker() = pickerDocuments()

    @After
    fun closeTheScreen() {
        held.countDown()
        TestDocuments.onOpen = {}
        if (::scenario.isInitialized) scenario.close()
    }

    /** Starts Notes and opens Settings. The two sections show once the keys were read. */
    private fun openSettings() {
        use24HourClock()
        scenario = ActivityScenario.launch(NotesActivity::class.java)
        compose.waitFor(hasContentDescription(words(R.string.notes_new_note)) or hasText(words(R.string.notes_new_note)))
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
    }

    private fun assertNotShown(text: String) = compose.onAllNodes(hasText(text)).assertCountEquals(0)

    /** The class of the screen of core/security that Notes opened for a result. */
    private fun openedScreen(): String? = scenario.openedForResult()?.component?.className

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /** Taps the row [row] of Settings and picks [picked] in the file picker that Notes opens with [action]. */
    private fun pick(row: Int, action: String, picked: android.net.Uri = document) {
        compose.tap(row)
        compose.waitForOpened(scenario) { it.action == action }
        compose.theOpenedScreenCloses(scenario, picked)
    }

    /** True if a view of Notes' window keeps the screen on now. */
    private fun keepsTheScreenOn(): Boolean {
        var on = false
        scenario.onActivity { activity -> on = anyKeepsTheScreenOn(activity.window.decorView) }
        return on
    }

    private fun anyKeepsTheScreenOn(view: View): Boolean =
        view.keepScreenOn || (view is ViewGroup && (0 until view.childCount).any { anyKeepsTheScreenOn(view.getChildAt(it)) })

    /** The progress bar of the dialog with [words], at [percent], as TalkBack reads it. */
    private fun progressBar(words: String, percent: String): SemanticsMatcher =
        hasContentDescription(words) and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, percent)

    /** Two notes, one with two files, and a deleted note: two notes and two files count. */
    private fun twoNotesAndTwoFiles(): String {
        val trip = seed { addNote("Trip", "Passport") }
        seed {
            addNote("Shopping", "Milk")
            val gone = addNote("Old")
            wipe(checkNotNull(deleteNote(gone)))
        }
        return trip
    }

    // What Settings shows.

    @Test
    fun withARecoveryKeyThereIsNoNoteAndTheRowsSayTheirState() {
        openSettings()

        assertNotShown(words(R.string.notes_backup_note_no_key))
        assertNotShown(words(R.string.notes_backup_note_unfinished))
        compose.onNode(hasContentDescription("Recovery key, Set up") and hasClickAction()).assertExists()
        compose.onNode(hasContentDescription("App lock, Off") and hasClickAction()).assertExists()
        listOf(R.string.notes_section_files, R.string.notes_section_backup, R.string.notes_section_security, R.string.notes_section_about).forEach {
            compose.onNode(hasText(words(it))).assert(isHeading())
        }
        listOf(R.string.notes_make_backup, R.string.notes_restore_backup, R.string.notes_licences).forEach {
            compose.onNode(hasText(words(it)) and hasClickAction()).assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
    }

    @Test
    @Config(application = NewNotesApp::class)
    fun withNoRecoveryKeyTheNoteSaysWhenItIsSetUpAndTheRowsStayEnabled() {
        openSettings()

        compose.onNode(hasText(words(R.string.notes_backup_note_no_key))).assertExists()
        assertTrue(
            "the note is text, not a button",
            compose.onAllNodes(hasText(words(R.string.notes_backup_note_no_key)) and hasClickAction()).fetchSemanticsNodes().isEmpty(),
        )
        compose.onNode(hasContentDescription("Recovery key, Not set up")).assertExists()
        compose.onNode(hasText(words(R.string.notes_make_backup)) and hasClickAction()).assertExists()
        compose.onNode(hasText(words(R.string.notes_restore_backup)) and hasClickAction()).assertExists()
    }

    @Test
    @Config(application = StoppedSetupNotesApp::class)
    fun afterASetupThatStoppedTheNoteAndTheRowSaySo() {
        openSettings()

        compose.onNode(hasText(words(R.string.notes_backup_note_unfinished))).assertExists()
        compose.onNode(hasContentDescription("Recovery key, Setup not finished")).assertExists()
        compose.tap(R.string.notes_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_finish_title))
        compose.tap(words(SecurityR.string.sec_first_need_open_security))
        assertEquals(SecurityActivity::class.java.name, openedScreen())
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun withTheAppLockOnTheRowSaysOn() {
        openSettings()

        compose.onNode(hasContentDescription("App lock, On")).assertExists()
    }

    @Test
    fun recoveryKeyAlwaysOpensTheSecurityScreenAndAppLockItsScreen() {
        openSettings()

        compose.tap(R.string.notes_recovery_key)
        scenario.onActivity { assertEquals(SecurityActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }

        compose.tap(R.string.notes_app_lock)
        compose.waitUntil(5_000) {
            var opened: Intent? = null
            scenario.onActivity { opened = shadowOf(it).peekNextStartedActivity() }
            opened != null
        }
        scenario.onActivity { assertEquals(AppLockActivity::class.java.name, shadowOf(it).nextStartedActivity.component?.className) }
    }

    // A backup.

    @Test
    fun aBackupGoesToTheFilePickerWithTheSuggestedNameAndSaysHowManyNotesAndFilesItHolds() {
        val trip = twoNotesAndTwoFiles()
        openSettings()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))

        compose.tap(R.string.notes_make_backup)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        assertEquals("application/octet-stream", picker.type)
        compose.theOpenedScreenCloses(scenario, document)

        compose.waitForText(words(R.string.notes_backup_written_title))
        compose.onNode(hasText("The backup is written and checked. It holds 2 notes and 2 files.")).assertExists()
        assertTrue(TestDocuments.file(BACKUP_NAME).length() > FILE_BYTES)
        compose.tap(R.string.notes_ok)
        assertNotShown(words(R.string.notes_backup_written_title))
    }

    @Test
    fun aBackupSaysHowManyFilesAreNotInIt() {
        val trip = seed { addNote("Trip") }
        openSettings()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()))
        val ticket = storedFiles().single()
        testApp.test.services.repository.store.stream(ticket.id).delete()

        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT)

        compose.waitForText(
            "The backup is written and checked. It holds 1 note and 0 files. " +
                "1 file is not on this phone or is damaged, and is not in this backup.",
        )
    }

    @Test
    fun theScreenStaysOnWhileABackupIsWritten() {
        openSettings()
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        assertFalse(keepsTheScreenOn())

        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT)
        compose.waitForText(words(R.string.notes_backup_writing))

        assertTrue(keepsTheScreenOn())
        held.countDown()
        compose.waitForText(words(R.string.notes_backup_written_title))
        assertFalse("not once it ended", keepsTheScreenOn())
    }

    @Test
    fun aRestoreShowsAProgressBarAndKeepsTheScreenOnUntilItEnds() {
        val trip = seed { addNote("Trip", "Passport") }
        openSettings()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))
        writeABackup()
        // The streams are held, so the restore waits after it has read the whole file.
        val streams = testApp.test.services.repository.streams
        runBlocking { streams.lock() }
        try {
            pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT)
            compose.tap(R.string.notes_restore)
            compose.waitFor(progressBar(words(R.string.notes_backup_restoring), "100%"))
            assertTrue(keepsTheScreenOn())
        } finally {
            streams.unlock()
        }
        compose.waitForText(words(R.string.notes_restored_title))
        assertFalse(keepsTheScreenOn())
    }

    @Test
    fun leavingTheFilePickerWritesNothingAndShowsNothing() {
        openSettings()
        compose.tap(R.string.notes_make_backup)
        compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }

        compose.theOpenedScreenCloses(scenario)

        assertNotShown(words(R.string.notes_backup_writing))
        assertNotShown(words(R.string.notes_backup_written_title))
        assertFalse(TestDocuments.file(BACKUP_NAME).exists() && TestDocuments.file(BACKUP_NAME).length() > 0)
    }

    // A restore.

    @Test
    fun aRestoreChecksTheFileAsksAndThenTakesIt() {
        val trip = twoNotesAndTwoFiles()
        use24HourClock()
        scenario = ActivityScenario.launch(NotesActivity::class.java)
        compose.waitFor(rowMatcher("Trip"))
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))
        writeABackup()
        scenario.close()
        // As a new phone with the same recovery words: the database starts empty.
        (testApp as UnlockedNotesApp).startOnAPhoneWithNoData()
        assertEquals(emptyList<String>(), storedNotes().map { it.title })
        openSettings()

        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT)
        compose.waitForText(words(R.string.notes_restore_question_title))
        compose.onNode(
            // The date is in the phone's format; the test's phone is set to American English.
            hasText(
                "Made on November 24, 2026, 09:30. It holds 2 notes and 2 files. " +
                    "A restore cannot undo a deletion or an edit you made after the backup.",
            ),
        ).assertExists()
        compose.onNode(hasText(words(R.string.notes_cancel)) and hasClickAction()).assertExists()
        compose.tap(R.string.notes_restore)

        compose.waitForText(words(R.string.notes_restored_title))
        compose.tap(R.string.notes_ok)
        assertEquals(listOf("Shopping", "Trip"), storedNotes().map { it.title }.sorted())
        assertEquals(listOf("plan.pdf", "ticket.png"), storedFiles().map { it.name }.sorted())
        // Settings and the list show them at once: they read the database through a flow.
        compose.waitForText("2 files", substring = true)
        compose.tap(R.string.notes_notes)
        compose.waitFor(rowMatcher("Trip"))
        compose.waitFor(rowMatcher("Shopping"))
    }

    @Test
    fun cancelAtTheQuestionClosesItAndRestoresNothing() {
        val trip = seed { addNote("Trip", "Passport") }
        writeABackup()
        // A note deleted after the backup: a restore would leave it deleted, and so does Cancel.
        seed { wipe(checkNotNull(deleteNote(trip))) }
        openSettings()

        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT)
        compose.waitForText(words(R.string.notes_restore_question_title))
        compose.tap(R.string.notes_cancel)

        assertNotShown(words(R.string.notes_restore_question_title))
        assertNotShown(words(R.string.notes_restored_title))
        assertEquals(emptyList<String>(), storedNotes().map { it.title })
    }

    @Test
    fun aFileThatIsNoBackupIsNamedAndNothingChanges() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()

        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))

        compose.waitForText(words(R.string.notes_refused_not_a_backup_title))
        compose.onNode(hasText(words(R.string.notes_refused_not_a_backup_text))).assertExists()
        compose.tap(R.string.notes_ok)
        assertNotShown(words(R.string.notes_refused_not_a_backup_title))
    }

    // The recovery key when first needed.

    @Test
    @Config(application = NewNotesApp::class)
    fun aBackupWithNoRecoveryKeyAsksFirstAndGoesOnToTheFilePickerWithoutAnotherTap() {
        openSettings()

        compose.tap(R.string.notes_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(words(SecurityR.string.sec_first_need_backup_text))).assertExists()
        compose.onNode(hasText(words(SecurityR.string.sec_first_need_other_app))).assertExists()
        assertNull("nothing is opened before the user chooses", scenario.openedForResult())

        compose.tap(words(SecurityR.string.sec_first_need_create))
        assertEquals(CreateRecoveryKeyActivity::class.java.name, openedScreen())
        // The flow stores the keys, then its screen closes.
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals(BACKUP_NAME, picker.getStringExtra(Intent.EXTRA_TITLE))
        compose.waitFor(hasContentDescription("Recovery key, Set up"))
        assertNotShown(words(R.string.notes_backup_note_no_key))
    }

    @Test
    @Config(application = NewNotesApp::class)
    fun aRestoreWithNoRecoveryKeyAsksForTheWordsAndGoesOnToTheFilePicker() {
        openSettings()

        compose.tap(R.string.notes_restore_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_enter_title))
        compose.tap(words(SecurityR.string.sec_first_need_enter))
        assertEquals(EnterRecoveryKeyActivity::class.java.name, openedScreen())
        giveTheAppARecoveryKey()
        compose.theOpenedScreenCloses(scenario)

        compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
    }

    @Test
    @Config(application = NewNotesApp::class)
    fun theAppLockWithNoRecoveryKeyAsksFirstAndNotNowClosesIt() {
        openSettings()

        compose.tap(R.string.notes_app_lock)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        compose.onNode(hasText(words(SecurityR.string.sec_first_need_app_lock_text))).assertExists()
        compose.tap(words(SecurityR.string.sec_first_need_not_now))

        assertNotShown(words(SecurityR.string.sec_first_need_set_up_title))
        assertNull(scenario.openedForResult())
    }

    // Licences.

    @Test
    fun licencesListsEveryPartByNameAndATapShowsItsNoticeAndItsLicence() {
        openSettings()

        compose.tap(R.string.notes_licences)
        compose.waitForText(words(R.string.notes_licences_intro))
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
        compose.onNode(hasText(words(R.string.notes_licence_notice))).assert(isHeading())
        compose.onNode(hasText("MIT License")).assert(isHeading())

        // Back closes the notice, then Licences, then goes to Notes.
        pressBack()
        compose.waitForText(words(R.string.notes_licences_intro))
        pressBack()
        compose.waitForText(words(R.string.notes_version))
        assertNotShown(words(R.string.notes_licences_intro))
        pressBack()
        compose.waitFor(hasContentDescription(words(R.string.notes_new_note)) or hasText(words(R.string.notes_new_note)))
    }

    @Test
    @Config(application = UnlockedNotesApp::class, qualifiers = TABLET)
    fun onATabletTheNoticeOpensBesideTheList() {
        openSettings()

        compose.tap(R.string.notes_licences)
        compose.waitForText(words(R.string.notes_choose_a_part))

        compose.tap("Tink for Java")
        compose.waitForText("Copyright 2017 Google Inc.", substring = true)
        compose.onNode(hasText("AndroidX libraries") and hasClickAction()).assertExists()
        compose.onNode(hasText("Apache License 2.0") and isHeading()).assertExists()

        // Read to the end of one notice, then open another beside the list: it opens at its top.
        compose.onNode(hasText("END OF TERMS AND CONDITIONS", substring = true)).performScrollTo()
        compose.tap("Kotlin standard library")
        compose.waitForText("Copyright 2010-2024 JetBrains", substring = true)
        compose.onNode(hasText(words(R.string.notes_licence_notice)) and isHeading()).assertIsDisplayed()
    }

    private companion object {
        const val FILE_BYTES = 2_400_000
    }
}

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
