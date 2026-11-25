package app.shkriuss.notes

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.ViewModelProvider
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.testing.TestDocuments
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import app.shkriuss.feature.notes.NotesListViewModel
import app.shkriuss.feature.notes.OpenNoteViewModel
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.data.NoteEntity
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

    @After
    fun closeTheScreen() {
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
        captureWindows("NoteNotSaved")
    }

    // Files.

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
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes(IMAGE_WIDTH, IMAGE_HEIGHT)))
        openNote("Trip")
        compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
        compose.tap(rowMatcher("ticket.png"))
        compose.waitFor(hasContentDescription("ticket.png") and !hasContentDescription(",", substring = true))
        compose.captureWholeScreen("ImageView", config)
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
        compose.waitForText(words(R.string.notes_no_files))
        compose.captureWholeScreen("SettingsNoFiles", config)
    }

    @Test
    fun settingsWithFiles() {
        val trip = seedNotes()
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()), BytesPick("plan.pdf", "application/pdf", ByteArray(PDF_BYTES)))
        compose.tap(R.string.notes_settings)
        compose.waitForText("2 files", substring = true)
        compose.captureWholeScreen("Settings", config)
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
        private const val IMAGE_WIDTH = 600
        private const val IMAGE_HEIGHT = 400

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}

/** "A title has at most 200 characters." */
private fun androidx.compose.ui.test.junit4.ComposeTestRule.titleTooLong(): String =
    androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>()
        .resources.getQuantityString(R.plurals.notes_title_too_long, 200, "200")
