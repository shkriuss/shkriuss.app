package app.shkriuss.notes

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.notes.OpenNoteViewModel
import app.shkriuss.feature.notes.R
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR

/**
 * What Notes' screens do, and what TalkBack hears, on a phone and on a
 * tablet (docs/apps/notes/spec.md, "Screens", "Saving", "Formatting",
 * "Files" and "TalkBack"). Each test starts the real activity with the app
 * lock off, on a database in memory. A tap is TalkBack's, on the one item
 * that holds the words; a picked document comes from the test's file
 * picker.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedNotesApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotesScreensTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private lateinit var scenario: ActivityScenario<NotesActivity>

    private val onTablet: Boolean
        get() = config.device == ScreenshotConfig.Device.Tablet

    @After
    fun closeTheScreen() {
        if (::scenario.isInitialized) scenario.close()
    }

    // New note and saving.

    @Test
    fun aNewNoteOpensWithTheKeyboardInTheTextAndSavesWhatIsTyped() {
        start()
        compose.tap(R.string.notes_new_note)
        val text = textEditor()
        compose.waitUntil(WAIT) { runCatching { text.assertIsFocused() }.isSuccess }

        text.performTextInput("Passport")
        compose.waitUntil(WAIT) { storedNotes().singleOrNull()?.body == "Passport" }

        closeTheNote()
        compose.waitFor(rowMatcher("Passport"))
    }

    @Test
    fun aNewNoteThatStaysEmptyIsGoneWhenItCloses() {
        start()
        compose.tap(R.string.notes_new_note)
        compose.waitFor(hasContentDescription(words(R.string.notes_add_file)))

        closeTheNote()

        compose.waitForText(words(R.string.notes_no_notes))
        assertTrue(storedNotes().isEmpty())
    }

    @Test
    fun aRefusedSaveAsksBeforeTheNoteClosesAndDiscardKeepsWhatWasSaved() {
        val shopping = seed { addNote("Shopping", "Bread") }
        start()
        openNote("Shopping")
        refuseWrites()
        compose.editor("Bread").performTextInput(" and milk")
        compose.waitForText(words(R.string.notes_save_failed))

        compose.tap(R.string.notes_settings)
        compose.waitFor(isDialog())
        compose.onNode(hasText(words(R.string.notes_not_saved))).assertExists()
        compose.tap(R.string.notes_discard)

        compose.waitForGone(isDialog())
        assertEquals("Bread", storedNotes().single { it.id == shopping }.body)
    }

    // The list and search.

    @Test
    fun aRowIsReadAsOneItemWithItsPinItsLastChangeAndItsText() {
        clockAt(NOV_16_14_05)
        seed {
            val id = addNote("Shopping", "- [ ] Bread\n**Milk**")
            check(setPinned(id, false))
        }
        clockAt(THE_TIME.toInstant(java.time.ZoneOffset.UTC).toEpochMilli())
        start()

        val row = compose.row("Shopping").fetchSemanticsNode()
        assertEquals(
            listOf("Shopping, pinned, changed Monday, November 16, Bread Milk"),
            row.config[SemanticsProperties.ContentDescription],
        )
        compose.onNode(hasText(words(R.string.notes_pinned))).assertExists()
    }

    @Test
    fun aSearchFiltersTheListAndBackClearsIt() {
        seed {
            addNote("Trip", "- [ ] Passport")
            addNote("Shopping", "Bread")
        }
        start()

        searchField().performTextInput("pass")
        compose.waitForGone(rowMatcher("Shopping"))
        compose.row("Trip").assertExists()

        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitFor(rowMatcher("Shopping"))
        assertEquals("", searchField().fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
    }

    @Test
    fun noMatchIsSaidAndAnnounced() {
        seed { addNote("Trip", "Passport") }
        start()

        searchField().performTextInput("rent")

        val words = words(R.string.notes_no_match, "rent")
        compose.waitForText(words)
        val announced = compose.onNode(hasText(words)).fetchSemanticsNode().config[SemanticsProperties.LiveRegion]
        assertEquals(LiveRegionMode.Polite, announced)
    }

    @Test
    fun pinMovesTheNoteToPinnedAndUnpinBack() {
        seed {
            addNote("Trip", "Passport")
            addNote("Shopping", "Bread")
        }
        start()
        openNote("Trip")

        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_pin)

        compose.waitUntil(WAIT) { storedNotes().single { it.title == "Trip" }.pinned }
        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_unpin)
        compose.waitUntil(WAIT) { !storedNotes().single { it.title == "Trip" }.pinned }
    }

    @Test
    fun deleteNoteClosesItAndUndoBringsItBack() {
        seed { addNote("Trip", "Passport") }
        start()
        openNote("Trip")

        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_delete_note)

        compose.waitForText(words(R.string.notes_note_deleted))
        compose.waitUntil(WAIT) { storedNotes().isEmpty() }
        compose.tap(R.string.notes_undo)
        compose.waitUntil(WAIT) { storedNotes().size == 1 }
        compose.waitFor(rowMatcher("Trip"))
    }

    @Test
    fun turningThePhoneKeepsTheUndoOfADeletedNote() {
        seed { addNote("Trip", "Passport") }
        start()
        openNote("Trip")
        compose.tap(DesignR.string.shk_more_options)
        compose.tap(R.string.notes_delete_note)
        compose.waitForText(words(R.string.notes_note_deleted))

        scenario.recreate()

        compose.tap(R.string.notes_undo)
        compose.waitUntil(WAIT) { storedNotes().singleOrNull()?.body == "Passport" }
    }

    // Formatting.

    @Test
    fun theBarSaysWhatIsOnAndTalkBackTicksTheItemTheCursorIsOn() {
        start()
        compose.tap(R.string.notes_new_note)
        textEditor().performTextInput("Passport")

        compose.tap(R.string.notes_checklist)
        compose.waitFor(IS_EDITABLE and hasText("- [ ] Passport"))
        assertEquals(words(R.string.notes_on), barState(R.string.notes_checklist))
        assertEquals(words(R.string.notes_off), barState(R.string.notes_heading))

        compose.runAction(IS_EDITABLE and hasText("- [ ] Passport"), words(R.string.notes_tick))
        compose.waitFor(IS_EDITABLE and hasText("- [x] Passport"))
        compose.runAction(IS_EDITABLE and hasText("- [x] Passport"), words(R.string.notes_open_again))
        compose.waitFor(IS_EDITABLE and hasText("- [ ] Passport"))
    }

    @Test
    fun theTitleTheTextAndTheSearchAskTheKeyboardNotToLearn() {
        start()
        searchField().performClick()
        assertNoLearning("search")
        compose.tap(R.string.notes_new_note)
        compose.waitFor(IS_EDITABLE and hasText(words(R.string.notes_title_hint)))
        compose.editor(words(R.string.notes_title_hint)).performClick()
        assertNoLearning("title")
        textEditor().performClick()
        assertNoLearning("text")
    }

    // Files.

    @Test
    fun aFileRowIsReadAsOneItemWithItsActionsAndOpenShowsTheImage() {
        val trip = seed { addNote("Trip", "Passport") }
        start()
        compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()))
        openNote("Trip")
        val size = storedFiles().single().size

        compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
        val row = compose.row("ticket.png").fetchSemanticsNode()
        val spokenSize = "%.1f kilobytes".format(size / 1000.0)
        assertEquals(listOf("ticket.png, image, $spokenSize"), row.config[SemanticsProperties.ContentDescription])
        assertEquals(
            listOf(words(R.string.notes_open), words(R.string.notes_save_copy), words(R.string.notes_remove)),
            row.config[SemanticsActions.CustomActions].map { it.label },
        )

        compose.runAction(rowMatcher("ticket.png"), words(R.string.notes_open))
        val image = hasContentDescription("ticket.png") and SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)
        compose.waitFor(image)
        assertEquals(
            listOf(words(R.string.notes_zoom_in), words(R.string.notes_zoom_out)),
            compose.onNode(image).fetchSemanticsNode().config[SemanticsActions.CustomActions].map { it.label },
        )
        compose.runAction(image, words(R.string.notes_zoom_in))

        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitFor(rowMatcher("ticket.png"))
    }

    @Test
    fun removeShowsFileRemovedAndUndoBringsTheFileBack() {
        val trip = seed { addNote("Trip", "Passport") }
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))
        openNote("Trip")

        compose.runAction(rowMatcher("plan.pdf"), words(R.string.notes_remove))

        compose.waitForText(words(R.string.notes_file_removed))
        compose.waitUntil(WAIT) { storedFiles().isEmpty() }
        compose.tap(R.string.notes_undo)
        compose.waitUntil(WAIT) { storedFiles().size == 1 }
        compose.waitFor(rowMatcher("plan.pdf"))
    }

    @Test
    fun theMenuOfAFileStaysWithItsFileWhenARowBeforeItGoes() {
        val trip = seed { addNote("Trip", "Passport") }
        start()
        compose.addFiles(
            trip,
            BytesPick("one.pdf", "application/pdf", ByteArray(FILE_BYTES)),
            BytesPick("two.pdf", "application/pdf", ByteArray(FILE_BYTES)),
        )
        openNote("Trip")
        // A tap on a file that is no image opens its menu.
        compose.tap(rowMatcher("two.pdf"))
        compose.waitForText(words(R.string.notes_save_copy))

        scenario.onActivity { activity ->
            val note = checkNotNull(ViewModelProvider(activity)[OpenNoteViewModel::class.java].open.value).model
            note.removeFile(note.state.value.files.first { it.file.name == "one.pdf" }.file)
        }
        compose.waitUntil(WAIT) { storedFiles().size == 1 }
        compose.waitForIdle()

        // The menu that is still open is the one of two.pdf: its Remove removes two.pdf.
        compose.tap(R.string.notes_remove)
        compose.waitUntil(WAIT) { storedFiles().isEmpty() }
    }

    @Test
    fun addAFileOpensOnePickerForAnyTypeAndAddsEveryFilePicked() {
        pickerDocuments()
        TestDocuments.file("one.txt").writeText("one")
        TestDocuments.file("two.txt").writeText("two")
        seed { addNote("Trip", "Passport") }
        start()
        openNote("Trip")

        compose.tap(R.string.notes_add_file)
        compose.tap(R.string.notes_add_file)
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_OPEN_DOCUMENT }
        assertEquals("*/*", picker.type)
        assertTrue(picker.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertTrue(picker.hasCategory(Intent.CATEGORY_OPENABLE))

        compose.theOpenedScreenCloses(scenario, TestDocuments.uri("one.txt"), TestDocuments.uri("two.txt"))

        compose.waitUntil(WAIT) { storedFiles().size == 2 }
        scenario.onActivity { activity ->
            assertEquals("A second press opened no second picker", null, org.robolectric.Shadows.shadowOf(activity).peekNextStartedActivityForResult())
        }
    }

    @Test
    fun saveACopyWritesTheFileByteForByteWhereTheUserChose() {
        pickerDocuments()
        val bytes = ByteArray(FILE_BYTES) { (it * 7).toByte() }
        val trip = seed { addNote("Trip", "Passport") }
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", bytes))
        openNote("Trip")

        compose.runAction(rowMatcher("plan.pdf"), words(R.string.notes_save_copy))
        val picker = compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
        assertEquals("plan.pdf", picker.getStringExtra(Intent.EXTRA_TITLE))
        assertEquals("application/pdf", picker.type)
        compose.theOpenedScreenCloses(scenario, TestDocuments.uri("plan.pdf"))

        compose.waitForText(words(R.string.notes_copy_saved))
        assertArrayEquals(bytes, TestDocuments.file("plan.pdf").readBytes())
    }

    // Two panes, and Settings.

    @Test
    fun fromEightHundredFortyTheNoteOpensBesideTheListAndAnotherNoteTakesItsPlace() {
        seed {
            addNote("Trip", "Passport")
            addNote("Shopping", "Bread")
        }
        start()
        if (!onTablet) return
        compose.waitForText(words(R.string.notes_choose_a_note))

        openNote("Trip")
        compose.row("Shopping").assertExists()
        compose.editor("Passport").performTextInput("Tickets ")
        openNote("Shopping")

        compose.waitUntil(WAIT) { storedNotes().single { it.title == "Trip" }.body == "Tickets Passport" }
        compose.editor("Bread").assertExists()
    }

    @Test
    fun settingsCountsTheFilesThatAreNotDeleted() {
        val trip = seed { addNote("Trip", "Passport") }
        start()
        compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)), BytesPick("map.pdf", "application/pdf", ByteArray(FILE_BYTES)))

        compose.tap(R.string.notes_settings)

        compose.waitForText("2 files, 4.8 MB of 1 GB")
    }

    private fun start() {
        use24HourClock()
        scenario = ActivityScenario.launch(NotesActivity::class.java)
        compose.waitFor(hasContentDescription(words(R.string.notes_new_note)) or hasText(words(R.string.notes_new_note)))
    }

    private fun openNote(title: String) {
        compose.tap(rowMatcher(title))
        compose.waitFor(IS_EDITABLE and hasText(title))
    }

    /** Back on the open note: its Back button under 840dp, or Settings beside the list, which closes it too. */
    private fun closeTheNote() {
        if (onTablet) compose.tap(R.string.notes_settings) else compose.tap(DesignR.string.shk_back)
        if (onTablet) compose.tap(R.string.notes_notes)
    }

    private fun textEditor() = compose.editor(words(R.string.notes_text_hint)).also { compose.waitFor(IS_EDITABLE and hasText(words(R.string.notes_text_hint))) }

    private fun searchField() = compose.onNode(IS_EDITABLE and hasText(words(R.string.notes_search)))

    /** What TalkBack reads for the state of the bar's button [label]. */
    private fun barState(label: Int): String =
        compose.onNode(hasContentDescription(words(label))).fetchSemanticsNode().config[SemanticsProperties.StateDescription]

    /** The field that has the focus tells the keyboard not to learn what is typed. */
    private fun assertNoLearning(what: String) {
        compose.waitForIdle()
        val info = EditorInfo()
        compose.runOnUiThread { checkNotNull(textEditor(scenario)).onCreateInputConnection(info) }
        assertTrue("The $what does not ask the keyboard not to learn", info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
    }

    private fun textEditor(scenario: ActivityScenario<NotesActivity>): View? {
        var found: View? = null
        scenario.onActivity { found = editorIn(it.window.decorView) }
        return found
    }

    private fun editorIn(view: View): View? {
        if (view.onCheckIsTextEditor()) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) editorIn(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    companion object {
        private const val WAIT = 5_000L
        private const val FILE_BYTES = 2_400_000

        /** Monday 16 November 2026 at 14:05 UTC. */
        private val NOV_16_14_05 = java.time.LocalDateTime.of(2026, 11, 16, 14, 5).toInstant(java.time.ZoneOffset.UTC).toEpochMilli()

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = listOf(ScreenshotConfig.all()[0], ScreenshotConfig.all()[3])
    }
}

