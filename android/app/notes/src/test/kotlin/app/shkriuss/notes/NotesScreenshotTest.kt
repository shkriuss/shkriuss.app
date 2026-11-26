package app.shkriuss.notes

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import android.content.Intent
import android.net.Uri
import app.shkriuss.core.security.R as SecurityR
import androidx.lifecycle.ViewModelProvider
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.testing.TestDocuments
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import app.shkriuss.feature.notes.AddProblem
import app.shkriuss.feature.notes.CopyResult
import app.shkriuss.feature.notes.NotesListViewModel
import app.shkriuss.feature.notes.NotesMessage
import app.shkriuss.feature.notes.OpenNoteViewModel
import app.shkriuss.feature.notes.PickedFile
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.TextEdit
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import app.shkriuss.core.crypto.AppName
import app.shkriuss.feature.notes.NotesServices
import java.io.File
import java.io.FileNotFoundException
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.CountDownLatch
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
 * Screenshots of every screen, dialog and menu of Notes
 * (docs/apps/notes/spec.md, "Screens"), in the four standard
 * configurations: phone light at font scale 1.0, phone dark at 2.0,
 * tablet light at 2.0 and tablet dark at 1.0. Each starts the real
 * activity with the app lock off, on a database written as the user would
 * have, on Tuesday 24 November 2026 at 09:30 UTC, with the 24-hour clock
 * of the spec's examples.
 *
 * A screen that scrolls is captured to its end, in parts. On the phone an
 * open note is in place of the list; on the tablet it is beside the list.
 * A dialog or a menu is captured with the screen dimmed behind it, and a
 * snackbar over the screen, once.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedNotesApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotesScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private var scenario: ActivityScenario<NotesActivity>? = null

    /** Holds a backup that is being written, so that its progress dialog stays. Let go at the end of the test. */
    private val held = CountDownLatch(1)

    @After
    fun closeTheScreen() {
        held.countDown()
        testApp.test.work.letGo()
        TestDocuments.onOpen = {}
        scenario?.close()
    }

    // The list.

    @Test
    fun noNotes() {
        start(ready = words(R.string.notes_no_notes))
        compose.captureWholeScreen("NotesEmpty", config)
    }

    /** Pinned and Other notes: a time today, a date this year and one of last year, a text that is cut, and a title from the text. */
    @Test
    fun theList() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        compose.waitForText("09:30 · 2 files")
        compose.captureWholeScreen("Notes", config, LIST)
    }

    /** A search for "ta" that matches lines of two texts, a title, and the name of a file, each in bold. */
    @Test
    fun aSearch() {
        seedNotes()
        val ideas = storedNotes().single { it.title.isEmpty() }.id
        start()
        compose.addFiles(ideas, BytesPick("tram-timetable.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        search("ta")
        compose.waitFor(hasText(words(R.string.notes_file_match, "tram-timetable.pdf")), useUnmergedTree = true)
        compose.captureWholeScreen("NotesSearch", config, LIST)
    }

    @Test
    fun aSearchWithNoMatch() {
        seedNotes()
        start()
        search("rent")
        compose.waitForText(words(R.string.notes_no_match, "rent"))
        compose.captureWholeScreen("NotesNoMatch", config)
    }

    /** What the list shows when the database cannot be read. */
    @Test
    fun theListWhenTheDatabaseCannotBeRead() {
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${NoteEntity.TABLE}") } }
        start(ready = words(R.string.notes_could_not_open))
        compose.captureWholeScreen("NotesCouldNotOpen", config)
    }

    /** No pinned note, so no headings, and a note with a mark and no words, which the list calls "Empty note". */
    @Test
    fun theListWithNoPinnedNote() {
        clockAt(at(2026, 11, 16, 14, 5))
        seed { addNote("Shopping", "Bread, milk and eggs") }
        clockAt(at(2026, 11, 24, 9, 30))
        seed { addNote("", "- [ ] ") }
        start()
        compose.waitFor(rowMatcher(words(R.string.notes_empty_note)))
        compose.captureWholeScreen("NotesNoPinned", config, LIST)
    }

    /** The list right after Delete note, with "Note deleted" and Undo. */
    @Test
    fun theSnackbarOfADeletedNote() {
        seedNotes()
        start()
        openNote("Shopping")
        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_delete_note)
        compose.waitForText(words(R.string.notes_note_deleted))
        compose.waitForIdle()
        captureWindows("NoteDeletedSnackbar")
    }

    // The other snackbars: each over the screen it shows on, once.

    /** An Undo that the database refused: "Could not change your notes. Try again.", and Undo with it. */
    @Test
    fun theSnackbarOfAnUndoThatFailed() {
        seedNotes()
        start()
        openNote("Shopping")
        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_delete_note)
        compose.waitForText(words(R.string.notes_note_deleted))
        refuseBringingNotesBack()
        compose.tap(R.string.notes_undo)
        compose.waitForText(words(R.string.notes_could_not_change))
        compose.waitFor(hasText(words(R.string.notes_undo)) and hasClickAction())
        captureWindows("UndoFailedSnackbar")
    }

    @Test
    fun theSnackbarOfARemovedFile() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        openNote("Trip")
        compose.runAction(rowMatcher("plan.pdf"), words(R.string.notes_remove))
        compose.waitForText(words(R.string.notes_file_removed))
        captureWindows("FileRemovedSnackbar")
    }

    /** New note at 5,000 notes, over the list. */
    @Test
    fun theSnackbarWhenNotesIsFull() = snackbar("NotesFullSnackbar", NotesMessage.NotesFull, "5,000", overANote = false)

    /** A file picked for a note that was deleted meanwhile, over the list. */
    @Test
    fun theSnackbarOfAFileWhoseNoteWasDeleted() =
        snackbar("NoteGoneSnackbar", NotesMessage.NotAdded(AddProblem.NoteDeleted), words(R.string.notes_note_gone), overANote = false)

    @Test
    fun theSnackbarWhenAChangeFailed() = snackbar("CouldNotChangeSnackbar", NotesMessage.CouldNotChange, words(R.string.notes_could_not_change))

    /** Two sentences: the count of a note, and how many files of the pick were not added. */
    @Test
    fun theSnackbarOfANoteThatIsFull() = snackbar("NoteFullSnackbar", NotesMessage.NotAdded(AddProblem.NoteFull(3)), "3 files were not added")

    @Test
    fun theSnackbarWhenAllFilesAreFull() = snackbar("AllFullSnackbar", NotesMessage.NotAdded(AddProblem.AllFull), "1 GB of files")

    @Test
    fun theSnackbarOfAFileThatIsTooLarge() =
        snackbar("TooLargeSnackbar", NotesMessage.NotAdded(AddProblem.TooLarge("holiday-film.mp4")), "is larger than 25 MB")

    @Test
    fun theSnackbarOfAFileThatCouldNotBeAdded() =
        snackbar("CouldNotAddSnackbar", NotesMessage.NotAdded(AddProblem.CouldNotAdd("ticket.png")), words(R.string.notes_could_not_add, "ticket.png"))

    @Test
    fun theSnackbarOfAFileThatCouldNotBeRead() =
        snackbar("CouldNotReadSnackbar", NotesMessage.NotAdded(AddProblem.CouldNotRead("ticket.png")), words(R.string.notes_could_not_read, "ticket.png"))

    @Test
    fun theSnackbarWhenNoFileKeyCanBeMade() =
        snackbar("KeysNotUsableSnackbar", NotesMessage.NotAdded(AddProblem.KeysNotUsable), words(R.string.notes_keys_not_usable))

    @Test
    fun theSnackbarOfACopyThatIsSaved() = snackbar("CopySavedSnackbar", NotesMessage.Copy(CopyResult.SAVED), words(R.string.notes_copy_saved))

    @Test
    fun theSnackbarOfACopyOfADamagedFile() = snackbar("CopyDamagedSnackbar", NotesMessage.Copy(CopyResult.DAMAGED), words(R.string.notes_copy_damaged))

    /** The longest words of a snackbar. */
    @Test
    fun theSnackbarOfACopyOfADamagedFileThatCouldNotBeDeleted() =
        snackbar("CopyDamagedPartSnackbar", NotesMessage.Copy(CopyResult.DAMAGED_PART_LEFT), words(R.string.notes_copy_damaged_part))

    @Test
    fun theSnackbarOfACopyThatFailed() = snackbar("CopyFailedSnackbar", NotesMessage.Copy(CopyResult.FAILED), words(R.string.notes_copy_failed))

    @Test
    fun theSnackbarOfACopyThatFailedAndCouldNotBeDeleted() =
        snackbar("CopyFailedPartSnackbar", NotesMessage.Copy(CopyResult.FAILED_PART_LEFT), words(R.string.notes_copy_failed_part))

    /**
     * Shows [message] as Notes shows it, through the one snackbar of the
     * app, over the open note "Trip", or over the list, and captures it as
     * [name] once [words] show.
     */
    private fun snackbar(name: String, message: NotesMessage, words: String, overANote: Boolean = true) {
        seedNotes()
        start()
        if (overANote) openNote("Trip")
        testApp.test.services.snackbars.show(message)
        compose.waitForText(words, substring = true)
        captureWindows(name)
    }

    // A note.

    /** "Trip", pinned: a heading, a checklist with a done item in bold, a numbered list, and three files: an image, a PDF and one not on this phone. */
    @Test
    fun aNote() {
        val trip = seedNotes()
        start()
        compose.addFiles(
            trip,
            BytesPick("ticket.png", "image/png", pngBytes()),
            BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)),
            BytesPick("map.png", "image/png", pngBytes()),
        )
        // The map's stream goes, as after a restore whose file has not moved in yet.
        val map = storedFiles().single { it.name == "map.png" }
        testApp.test.services.repository.store.remove(map.id)
        openNote("Trip")
        compose.waitFor(hasText(words(R.string.notes_not_on_phone)), useUnmergedTree = true)
        compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
        compose.captureWholeScreen("Note", config, NOTE)
    }

    /** A new note, with the keyboard in the text and the formatting bar above it. */
    @Test
    fun aNewNote() {
        seedNotes()
        start()
        compose.tap(R.string.notes_new_note)
        compose.waitFor(hasContentDescription(words(R.string.notes_checklist)))
        compose.captureWholeScreen("NewNote", config)
    }

    /** The bar while the cursor is on a done checklist item: Checklist is on, and the rest off. */
    @Test
    fun theFormattingBarOnAnItem() {
        seedNotes()
        start()
        compose.tap(R.string.notes_new_note)
        compose.waitFor(hasContentDescription(words(R.string.notes_checklist)))
        compose.editor(words(R.string.notes_text_hint)).performTextInput("Pack")
        compose.tap(R.string.notes_checklist)
        compose.tap(R.string.notes_checklist)
        compose.waitFor(IS_EDITABLE and hasText("- [x] Pack"))
        compose.captureWholeScreen("FormattingBar", config)
    }

    /** The menu of a note: Unpin, for a pinned note, and Delete note. */
    @Test
    fun theMenuOfANote() {
        seedNotes()
        start()
        openNote("Trip")
        compose.tap(DesignR.string.shk_more_options)
        compose.waitForText(words(R.string.notes_delete_note))
        captureWindows("NoteMenu")
    }

    /** A title past 200 characters: refused, with the words under it. */
    @Test
    fun aTitleTooLong() {
        seedNotes()
        start()
        openNote("Shopping")
        // As typing would, but with no field focused, so no blinking cursor can change the screenshot.
        checkNotNull(scenario).onActivity {
            ViewModelProvider(it)[OpenNoteViewModel::class.java].open.value?.model?.onTitleChange("Shopping " + "x".repeat(TOO_LONG_TITLE))
        }
        compose.waitFor(hasError(compose.titleTooLong()))
        compose.captureWholeScreen("NoteTitleTooLong", config)
    }

    /** A save that failed: the line above the title. Then Back asks "This note is not saved". */
    @Test
    fun aSaveThatFailed() {
        seedNotes()
        start()
        openNote("Shopping")
        refuseWrites()
        // The change comes as typing would, but with no field focused: the save fails a second later, in real time, so a
        // blinking cursor would show or not by chance.
        checkNotNull(scenario).onActivity { ViewModelProvider(it)[OpenNoteViewModel::class.java].open.value?.model?.onTitleChange("Shopping list") }
        compose.waitForText(words(R.string.notes_save_failed))
        compose.onNode(IS_EDITABLE and hasText("Shopping list")).assertIsNotFocused()
        compose.captureWholeScreen("NoteSaveFailed", config)
    }

    @Test
    fun theQuestionWhenANoteIsNotSaved() {
        seedNotes()
        start()
        openNote("Shopping")
        refuseWrites()
        compose.editor("Shopping").performTextReplacement("Shopping list")
        compose.waitForText(words(R.string.notes_save_failed))
        // Settings closes the note, as Back does under 840dp: its save fails again, and the question comes.
        compose.tap(R.string.notes_settings)
        compose.waitFor(isDialog())
        // Settings shows behind the question, with every section once the keys were read.
        compose.waitForSettings()
        captureWindows("NoteNotSaved")
    }

    /** A text past 100,000 characters: refused, with the words under it. */
    @Test
    fun aTextTooLong() {
        seedNotes()
        start()
        openNote("Shopping")
        // As pasting would, but with no field focused, so no blinking cursor can change the screenshot.
        checkNotNull(scenario).onActivity {
            ViewModelProvider(it)[OpenNoteViewModel::class.java].open.value?.model?.onBodyChange(TextEdit("x".repeat(TOO_LONG_TEXT), 0))
        }
        compose.waitFor(hasError(compose.textTooLong()))
        compose.captureWholeScreen("NoteTextTooLong", config)
    }

    /** A note that cannot be read: "Could not open your notes." in its place. */
    @Test
    fun aNoteThatCannotBeRead() {
        seedNotes()
        start()
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${NoteEntity.TABLE}") } }
        compose.tap(rowMatcher("Shopping"))
        compose.waitFor(hasContentDescription(words(R.string.notes_add_file)))
        compose.waitForText(words(R.string.notes_could_not_open))
        compose.captureWholeScreen("NoteCouldNotOpen", config)
    }

    /** The menu of a note that is not pinned: Pin, and Delete note. */
    @Test
    fun theMenuOfANoteThatIsNotPinned() {
        seedNotes()
        start()
        openNote("Shopping")
        compose.tap(DesignR.string.shk_more_options)
        compose.waitForText(words(R.string.notes_pin))
        captureWindows("NoteMenuPin")
    }

    /** The menu of a new note with nothing in it yet: Pin is turned off. */
    @Test
    fun theMenuOfANewNote() {
        seedNotes()
        start()
        compose.tap(R.string.notes_new_note)
        compose.waitFor(hasContentDescription(words(R.string.notes_checklist)))
        compose.tap(DesignR.string.shk_more_options)
        compose.waitForText(words(R.string.notes_delete_note))
        captureWindows("NewNoteMenu")
    }

    // Files.

    /** Three files that cannot be opened, each with why: not on this phone, its key given up, and damaged. */
    @Test
    fun filesThatCannotBeOpened() {
        val trip = seedNotes()
        start()
        compose.addFiles(
            trip,
            BytesPick("map.png", "image/png", pngBytes()),
            BytesPick("contract.pdf", "application/pdf", ByteArray(PDF_BYTES)),
            BytesPick("scan.pdf", "application/pdf", ByteArray(PDF_BYTES)),
        )
        val files = storedFiles().associateBy { it.name }
        val store = testApp.test.services.repository.store
        store.remove(files.getValue("map.png").id)
        sealTheKeyOfWithOtherWords(files.getValue("contract.pdf").id)
        // The stream of the scan is cut short.
        store.stream(files.getValue("scan.pdf").id).let { it.writeBytes(it.readBytes().copyOf(CUT_STREAM)) }
        openNote("Trip")
        listOf(R.string.notes_not_on_phone, R.string.notes_no_longer_opens, R.string.notes_damaged).forEach {
            compose.waitFor(hasText(words(it)), useUnmergedTree = true)
        }
        compose.captureWholeScreen("FilesNotOpened", config, NOTE)
    }

    /** A keyset file is damaged: no file opens until the recovery key repairs it, and each row says where to go. */
    @Test
    fun filesWhoseKeysCannotBeUsedNow() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        damageTheFileKeyset()
        openNote("Trip")
        compose.waitFor(hasText(words(R.string.notes_keys_not_usable)), useUnmergedTree = true)
        compose.captureWholeScreen("FilesKeysNotUsable", config, NOTE)
    }

    /** The menu of a file that cannot be opened: Remove alone. */
    @Test
    fun theMenuOfAFileThatCannotBeOpened() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("map.png", "image/png", pngBytes()))
        testApp.test.services.repository.store.remove(storedFiles().single().id)
        openNote("Trip")
        compose.tap(rowMatcher("map.png"))
        compose.waitFor(hasText(words(R.string.notes_remove)) and hasClickAction())
        captureWindows("FileMenuRemoveOnly")
    }

    /** Two files that wait: one being added whose size the picker does not give, so it has no bar, and one whose turn has not come. */
    @Test
    fun filesThatWaitToBeAdded() {
        val trip = seedNotes()
        start()
        openNote("Trip")
        val hold = CountDownLatch(1)
        try {
            val noSize = object : PickedFile by BytesPick("ticket.png", "image/png", ByteArray(ADDED_BYTES), hold) {
                override fun reportedSize(): Long? = null
            }
            testApp.test.services.adds.add(trip, listOf(noSize, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES))))
            compose.waitForText(words(R.string.notes_adding, "ticket.png"))
            compose.waitForText(words(R.string.notes_adding_a_file))
            compose.captureWholeScreen("FilesWaiting", config, NOTE)
        } finally {
            hold.countDown()
        }
    }

    /** The menu of a file that is not an image: Save a copy and Remove. */
    @Test
    fun theMenuOfAFile() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        openNote("Trip")
        compose.tap(rowMatcher("plan.pdf"))
        compose.waitForText(words(R.string.notes_save_copy))
        captureWindows("FileMenu")
    }

    /** A file being added: "Adding ticket.png", half way. */
    @Test
    fun aFileBeingAdded() {
        val trip = seedNotes()
        start()
        openNote("Trip")
        val hold = CountDownLatch(1)
        try {
            testApp.test.services.adds.add(trip, listOf(BytesPick("ticket.png", "image/png", ByteArray(ADDED_BYTES), hold)))
            compose.waitForText(words(R.string.notes_adding, "ticket.png"))
            // The first half is copied, and the read waits there: the bar shows half way, every time.
            compose.waitFor(
                SemanticsMatcher("the bar half way") { node ->
                    node.config.getOrNull(SemanticsProperties.ProgressBarRangeInfo)?.current == HALF
                },
            )
            compose.captureWholeScreen("FileBeingAdded", config, NOTE)
        } finally {
            hold.countDown()
        }
    }

    /** Save a copy, under the dialog "Saving a copy", while the copy is written. */
    @Test
    fun savingACopy() {
        val trip = seedNotes()
        pickerDocuments()
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        openNote("Trip")
        compose.runAction(rowMatcher("plan.pdf"), words(R.string.notes_save_copy))
        val screen = checkNotNull(scenario)
        compose.waitForOpened(screen) { it.action == android.content.Intent.ACTION_CREATE_DOCUMENT }
        val hold = CountDownLatch(1)
        TestDocuments.onOpen = { hold.await() }
        try {
            compose.theOpenedScreenCloses(screen, TestDocuments.uri("plan.pdf"))
            compose.waitForText(words(R.string.notes_saving_copy))
            captureWindows("SavingACopy")
        } finally {
            hold.countDown()
        }
    }

    // The image view.

    @Test
    fun theImageView() {
        openTheImageView()
        compose.captureWholeScreen("ImageView", config)
    }

    /** The image view after a double tap, at 2.5×: the image stays in its pane, under the top bar. */
    @Test
    fun theImageViewZoomedIn() {
        openTheImageView().performTouchInput { doubleClick() }
        compose.waitForIdle()
        compose.captureWholeScreen("ImageViewZoomed", config)
    }

    /** The menu of the image view: Save a copy and Remove. */
    @Test
    fun theMenuOfTheImageView() {
        openTheImageView()
        compose.tap(DesignR.string.shk_more_options)
        compose.waitForText(words(R.string.notes_save_copy))
        captureWindows("ImageMenu")
    }

    /** The image view while its image is decoded: "Opening the image". */
    @Test
    fun theImageViewWhileItsImageIsDecoded() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes(IMAGE_WIDTH, IMAGE_HEIGHT)))
        openNote("Trip")
        compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
        // The work of the app waits from here, so the image is not decoded yet, and "Opening the image" stays.
        testApp.test.work.hold()
        compose.tap(rowMatcher("ticket.png"))
        compose.waitForText(words(R.string.notes_opening_image))
        compose.captureWholeScreen("ImageOpening", config)
    }

    /** Opens the image view of an image added to Trip, and gives the image. */
    private fun openTheImageView(): SemanticsNodeInteraction {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes(IMAGE_WIDTH, IMAGE_HEIGHT)))
        openNote("Trip")
        compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
        compose.tap(rowMatcher("ticket.png"))
        val image = hasContentDescription("ticket.png") and !hasContentDescription(",", substring = true)
        compose.waitFor(image)
        return compose.onNode(image)
    }

    /**
     * An image whose type says image but whose bytes are not one: "Notes
     * cannot show this image.", with Save a copy. Its row shows a file icon,
     * so a tap opens its menu: the view is opened here as a row of an image
     * that decodes small and not large would open it.
     */
    @Test
    fun anImageThatCannotBeShown() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("scan.jpg", "image/jpeg", ByteArray(PDF_BYTES)))
        openNote("Trip")
        compose.waitFor(rowMatcher("scan.jpg"))
        val scan = storedFiles().single().id
        checkNotNull(scenario).onActivity { ViewModelProvider(it)[OpenNoteViewModel::class.java].openImage(scan) }
        compose.waitForText(words(R.string.notes_cannot_show))
        compose.captureWholeScreen("ImageCannotShow", config)
    }

    // Settings.

    @Test
    fun settingsWithNoFiles() {
        start(ready = words(R.string.notes_no_notes))
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        compose.waitForText(words(R.string.notes_no_files))
        compose.captureWholeScreen("SettingsNoFiles", config)
    }

    /** Settings when the files cannot be counted: the error state in the section Files, and the other sections under it. */
    @Test
    fun settingsWhenTheFilesCannotBeCounted() {
        runBlocking { testApp.test.database.useWriterConnection { it.executeSQL("DROP TABLE ${AttachmentEntity.TABLE}") } }
        start(ready = words(R.string.notes_could_not_open))
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        compose.waitForText(words(R.string.notes_could_not_open))
        compose.captureWholeScreen("SettingsCouldNotCount", config)
    }

    @Test
    fun settingsWithFiles() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        compose.waitForText("2 files", substring = true)
        compose.captureWholeScreen("Settings", config)
    }

    // Backup, Security and Licences.

    /** With the app lock on, its row says "On". */
    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun settingsWithTheAppLockOn() {
        openSettings()
        compose.waitFor(hasContentDescription("App lock, On"))
        compose.captureWholeScreen("SettingsAppLockOn", config)
    }

    @Test
    @Config(application = NewNotesApp::class)
    fun settingsWithNoRecoveryKey() {
        openSettings()
        compose.captureWholeScreen("SettingsNoRecoveryKey", config)
    }

    @Test
    @Config(application = StoppedSetupNotesApp::class)
    fun settingsAfterASetupThatStopped() {
        openSettings()
        compose.captureWholeScreen("SettingsSetupNotFinished", config)
    }

    /** With the owner's sentence about a recovery key made in another app. */
    @Test
    @Config(application = NewNotesApp::class)
    fun theDialogWhenTheRecoveryKeyIsFirstNeededForABackup() {
        openSettings()
        compose.tap(R.string.notes_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        captureWindows("FirstNeedBackup")
    }

    /** Before the files are counted, the circle. */
    @Test
    fun theProgressDialogWhileABackupIsWritten() {
        pickerDocuments()
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_writing))
        captureWindows("BackupWriting")
    }

    /** While the picked file is checked, before the question of a restore. */
    @Test
    fun theProgressDialogWhileAFileIsChecked() {
        pickerDocuments()
        seedNotes()
        val backup = writeABackup()
        // The storage does not answer, so "Checking the backup" stays on screen. Then the read fails, and nothing changes.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                held.await()
                throw FileNotFoundException("the test has ended")
            }
        }
        openSettings(ready = "Shopping")
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_backup_checking))
        captureWindows("BackupChecking")
    }

    /** With the bar and the percent: the whole file is read, and the files move in. */
    @Test
    fun theProgressDialogWhileABackupIsRestored() {
        pickerDocuments()
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        val backup = writeABackup()
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        // The streams are held, so the restore waits after it has read the whole file.
        val streams = testApp.test.services.repository.streams
        runBlocking { streams.lock() }
        try {
            compose.tap(R.string.notes_restore)
            compose.waitFor(hasContentDescription(words(R.string.notes_backup_restoring)) and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "100%"))
            captureWindows("BackupRestoring")
        } finally {
            streams.unlock()
        }
    }

    /** With one file that is not on this phone, so the dialog says that it is not in the backup. */
    @Test
    fun theDialogWhenABackupIsWrittenAndChecked() {
        pickerDocuments()
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        testApp.test.services.repository.store.stream(storedFiles().single { it.name == "plan.pdf" }.id).delete()
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_written_title))
        captureWindows("BackupWritten")
    }

    @Test
    fun theQuestionBeforeARestore() {
        pickerDocuments()
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        val backup = writeABackup()
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_restore_question_title))
        captureWindows("RestoreQuestion")
    }

    @Test
    fun theDialogWhenABackupIsRestored() {
        pickerDocuments()
        seedNotes()
        val backup = writeABackup()
        openSettings(ready = "Shopping")
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.notes_restore)
        compose.waitForText(words(R.string.notes_restored_title))
        captureWindows("BackupRestored")
    }

    @Test
    fun theAnswerForAFileThatIsNoBackup() {
        pickerDocuments()
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
        compose.waitForText(words(R.string.notes_refused_not_a_backup_title))
        captureWindows("RestoreNotABackup")
    }

    @Test
    fun theDialogWhenABackupCannotBeWritten() {
        pickerDocuments()
        TestDocuments.onOpen = { mode -> if (mode == "wt") throw FileNotFoundException("the storage app refuses") }
        openSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_not_written_text))
        captureWindows("BackupNotWritten")
    }

    @Test
    fun theDialogWhenABackupIsWrittenButCannotBeReadAgain() {
        pickerDocuments()
        TestDocuments.onOpen = { mode -> if (mode == "r") throw FileNotFoundException("the storage app refuses to read") }
        openSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_not_checked_title))
        captureWindows("BackupNotChecked")
    }

    @Test
    fun theDialogWhenABackupIsWrittenButFailsItsCheck() {
        pickerDocuments()
        // The storage loses the end of the file between the write and the check.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                val file = TestDocuments.file(BACKUP_NAME)
                file.writeBytes(file.readBytes().dropLast(10).toByteArray())
            }
        }
        openSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_not_usable_title))
        captureWindows("BackupNotUsable")
    }

    /** A note deleted before a stop, and a database that refuses to wipe it: no backup is made. */
    @Test
    fun theDialogWhenWhatWasDeletedCannotBeWipedFirst() {
        pickerDocuments()
        seedNotes()
        val taxReturn = storedNotes().single { it.title == "Tax return" }.id
        seed { deleteNote(taxReturn) }
        refuseWrites()
        openSettings(ready = "Shopping")
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_not_wiped_text))
        captureWindows("BackupNotWiped")
    }

    /** A file added before the recovery key, whose key is damaged: it cannot move to the recovery key, and no backup is made. */
    @Test
    @Config(application = NewNotesApp::class)
    fun theDialogWhenAFileKeyCannotMoveYet() {
        pickerDocuments()
        val trip = seed { addNote("Trip", "Passport") }
        start(ready = "Trip")
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        damageTheKeyOf(storedFiles().single().id)
        giveTheAppARecoveryKey()
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
        pick(R.string.notes_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_backup_files_moving_text))
        captureWindows("BackupFilesMoving")
    }

    @Test
    fun theAnswerForABackupOfANewerVersion() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 2))
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_refused_newer_title))
        captureWindows("RestoreNewerVersion")
    }

    @Test
    fun theAnswerForABackupOfAnotherApp() {
        pickerDocuments()
        val tasks = AppName.of("tasks")
        val backup = writeABackupOf(OtherContent(dataVersion = 1), crypto = keysOfOtherWords(tasks), appName = tasks)
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_refused_other_app_title))
        captureWindows("RestoreOtherApp")
    }

    /** The longest words of a restore: the short name of the key comes from fixed words, so it is the same in every run. */
    @Test
    fun theAnswerForABackupMadeWithOtherWords() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 1), crypto = keysOfOtherWords(NotesServices.APP_NAME))
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_refused_other_key_title))
        captureWindows("RestoreOtherKey")
    }

    @Test
    fun theAnswerForAFileThatIsCutShort() {
        pickerDocuments()
        seedNotes()
        val backup = writeABackup()
        val file = TestDocuments.file(BACKUP_NAME)
        file.writeBytes(file.readBytes().dropLast(1).toByteArray())
        openSettings(ready = "Shopping")
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_refused_damaged_title))
        captureWindows("RestoreDamaged")
    }

    @Test
    fun theAnswerForAFileThatCannotBeRead() {
        pickerDocuments()
        TestDocuments.onOpen = { throw FileNotFoundException("the storage app refuses") }
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.notes_not_read_title))
        captureWindows("RestoreNotRead")
    }

    @Test
    fun theAnswerWhenTheBackupCannotBePutAside() {
        pickerDocuments()
        seedNotes()
        val backup = writeABackup()
        openSettings(ready = "Shopping")
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.notes_restore_question_title))
        // The staging folder cannot be made: a file stands in its place.
        File(RuntimeEnvironment.getApplication().noBackupFilesDir, "shk-restore").apply {
            deleteRecursively()
            writeText("in the way")
        }
        compose.tap(R.string.notes_restore)
        compose.waitForText(words(R.string.notes_no_room_title))
        captureWindows("RestoreNoRoom")
    }

    @Test
    fun theAnswerForABackupWithSomethingNotesCannotRead() {
        pickerDocuments()
        val backup = writeABackupOf(OtherContent(dataVersion = 1, listOf(otherRecord("task"))))
        openSettings()
        pick(R.string.notes_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.notes_restore)
        compose.waitForText(words(R.string.notes_unreadable_title))
        captureWindows("RestoreUnreadable")
    }

    @Test
    fun licences() {
        openSettings()
        compose.tap(R.string.notes_licences)
        compose.waitForText(words(R.string.notes_licences_intro))
        compose.captureWholeScreen("Licences", config)
    }

    /** The shortest licence, so that the whole notice fits in a few images. */
    @Test
    fun theNoticeOfOnePartOfLicences() {
        openSettings()
        compose.tap(R.string.notes_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
        compose.captureWholeScreen("LicenceNotice", config)
    }

    /** Starts Notes, waits until the list shows [ready], and opens Settings, with all of its sections. */
    private fun openSettings(ready: String = words(R.string.notes_no_notes)) {
        start(ready)
        compose.tap(R.string.notes_settings)
        compose.waitForSettings()
    }

    /** Taps the row [row] of Settings and picks [document] in the file picker that Notes opens with [action]. */
    private fun pick(row: Int, action: String, document: Uri) {
        compose.tap(row)
        val shown = checkNotNull(scenario)
        compose.waitForOpened(shown) { it.action == action }
        compose.theOpenedScreenCloses(shown, document)
    }

    private fun start(ready: String = "Shopping") {
        use24HourClock()
        scenario = ActivityScenario.launch(NotesActivity::class.java)
        compose.waitFor(hasText(ready) or rowMatcher(ready))
    }

    /**
     * Searches for [query] as typing in the field would, but with no field
     * focused: the search waits 300 ms in real time, and a blinking cursor
     * would show or not by chance.
     */
    private fun search(query: String) {
        checkNotNull(scenario).onActivity { ViewModelProvider(it)[NotesListViewModel::class.java].search(query) }
        compose.waitFor(IS_EDITABLE and hasText(query))
    }

    /** Opens the note whose row starts with [title]. */
    private fun openNote(title: String) {
        compose.tap(rowMatcher(title))
        compose.waitFor(IS_EDITABLE and hasText(title))
    }

    /** Captures every window once: a menu or a dialog over the dimmed screen, or a snackbar over it. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun captureWindows(name: String) {
        compose.waitForIdle()
        captureScreenRoboImage("src/test/screenshots/${name}_${config.name}.png")
    }

    /**
     * Four notes. "Trip", pinned, today at 09:30, with a heading, a
     * checklist with a done item in bold, and a numbered list. "Shopping",
     * on Monday 16 November at 14:05, with a text long enough to be cut.
     * A note with no title, from Thursday 1 October, whose first line,
     * "Ideas", is its title. "Tax return" from last year. Gives the `id` of
     * "Trip".
     */
    private fun seedNotes(): String {
        clockAt(at(2025, 12, 30, 18, 0))
        seed { addNote("Tax return", "Ask for the forms") }
        clockAt(at(2026, 10, 1, 8, 15))
        seed { addNote("", "# Ideas\nA *small* garden by the kitchen window") }
        clockAt(at(2026, 11, 16, 14, 5))
        seed {
            addNote(
                "Shopping",
                "Bread, milk and eggs for the week, and something for dinner on Friday, when the guests come over to see the new flat and stay late",
            )
        }
        clockAt(at(2026, 11, 24, 9, 30))
        return seed {
            val trip = addNote("Trip", "# Packing\n- [ ] Passport\n- [x] **Tickets**\n1. Taxi at 6\n2. Train at 7")
            check(setPinned(trip, false))
            trip
        }
    }

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        LocalDateTime.of(year, month, day, hour, minute).toInstant(ZoneOffset.UTC).toEpochMilli()

    companion object {
        /** The list of notes: the part that scrolls and is a list. */
        private val LIST = hasScrollAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)

        /** The open note: the part that scrolls and holds its title. */
        private val NOTE
            get() = hasScrollAction() and hasAnyDescendant(IS_EDITABLE and hasText("Trip"))

        private const val PDF_BYTES = 2_400_000
        private const val HALF = 0.5f
        private const val ADDED_BYTES = 6_000_000
        private const val TOO_LONG_TITLE = 200
        private const val TOO_LONG_TEXT = 100_001
        private const val CUT_STREAM = 100
        private const val IMAGE_WIDTH = 600
        private const val IMAGE_HEIGHT = 400

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}

/** "A note has at most 100,000 characters." */
private fun androidx.compose.ui.test.junit4.ComposeTestRule.textTooLong(): String =
    androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>()
        .resources.getQuantityString(R.plurals.notes_text_too_long, 100_000, "100,000")

/** "A title has at most 200 characters." */
private fun androidx.compose.ui.test.junit4.ComposeTestRule.titleTooLong(): String =
    androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>()
        .resources.getQuantityString(R.plurals.notes_title_too_long, 200, "200")
