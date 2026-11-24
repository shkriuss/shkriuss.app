package app.shkriuss.feature.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Search, the order of the list and what a row shows (docs/apps/notes/spec.md, "Notes" and "Search"). */
class NoteSearchTest {
    private fun note(
        title: String = "Trip",
        body: String = "",
        pinned: Boolean = false,
        lastChange: Long = 1_000,
        createdAt: Long = 1_000,
        id: String = "a",
    ) = Note(id, title, body, pinned, createdAt, lastChange, 1)

    @Test
    fun caseIsIgnoredAndNothingElseIsFolded() {
        val trip = note(title = "Trip to TBILISI")

        assertEquals(listOf(8..14), NoteSearch.match(trip, emptyList(), "tbilisi")?.inTitle)
        assertEquals(listOf(0..3), NoteSearch.match(trip, emptyList(), "TRIP")?.inTitle)
        assertNull("e does not match é", NoteSearch.match(note(title = "Café"), emptyList(), "cafe"))
        assertEquals(listOf(0..3), NoteSearch.match(note(title = "Café"), emptyList(), "CAFÉ")?.inTitle)
        assertEquals("Marks are text", listOf(2..3), NoteSearch.match(note(title = "a ** b"), emptyList(), "**")?.inTitle)
    }

    @Test
    fun aMatchInTheTextShowsTheFirstLineThatMatchesAsStored() {
        val match = NoteSearch.match(note(body = "# Trip\n- [ ] Pay the **rent**\n- [ ] rent again"), emptyList(), "rent")

        assertEquals(MatchedLine("- [ ] Pay the **rent**", listOf(16..19)), match?.line)
        assertEquals(emptyList<IntRange>(), match?.inTitle)
        assertNull(match?.fileName)
    }

    @Test
    fun aMatchInAFileNameOnlyNamesTheFile() {
        val match = NoteSearch.match(note(title = "Trip"), listOf("passport.pdf", "ticket.jpg"), "TICKET")

        assertEquals("ticket.jpg", match?.fileName)
        assertNull(match?.line)
        assertNull("A title that matches shows the row as in the list", NoteSearch.match(note(title = "ticket"), listOf("ticket.jpg"), "ticket")?.fileName)
    }

    @Test
    fun aNoteThatDoesNotMatchIsLeftOutAndEveryMatchInALineIsFound() {
        assertNull(NoteSearch.match(note(title = "Trip", body = "Passport"), listOf("ticket.jpg"), "rent"))
        assertEquals(listOf(0..1, 3..4), NoteSearch.rangesIn("ab ab", "ab"))
    }

    @Test
    fun aMatchKeepsItsPlaceWhenLowerCasingChangesTheLength() {
        // U+0130, a capital I with a dot, is one character; its lower case by Unicode's rules is two, "i" and a dot above.
        val text = "\u0130stanbul trip"

        assertEquals(listOf(9..12), NoteSearch.rangesIn(text, "trip"))
        assertEquals(listOf(0..7), NoteSearch.match(note(title = text), emptyList(), "\u0130STANBUL")?.inTitle)
        assertEquals("A match inside the two characters of one takes the whole of it", listOf(0..0), NoteSearch.rangesIn("\u0130", "i"))
    }

    @Test
    fun theFinalSigmaIsLowerCasedByUnicodesRules() {
        // "ΟΣ" lower-cased by Unicode's rules is "ος", with the final sigma, not "οσ".
        val greek = note(title = "\u039f\u03a3 \u03a4\u0391")

        assertEquals(listOf(0..1), NoteSearch.match(greek, emptyList(), "\u03bf\u03c2")?.inTitle)
        assertEquals(listOf(0..1), NoteSearch.match(greek, emptyList(), "\u039f\u03a3")?.inTitle)
        assertEquals(listOf(0..4), NoteSearch.match(greek, emptyList(), "\u03bf\u03c2 \u03c4\u03b1")?.inTitle)
    }

    @Test
    fun theListIsByLastChangeNewestFirstWithPinnedNotesInASectionOfTheirOwn() {
        val older = note(id = "b", lastChange = 1_000)
        val newer = note(id = "c", lastChange = 2_000)
        val pinned = note(id = "d", lastChange = 500, pinned = true)
        val tieFirst = note(id = "e", lastChange = 1_000, createdAt = 100)
        val tieLast = note(id = "f", lastChange = 1_000, createdAt = 100)

        val sections = NoteOrder.sections(listOf(older, tieLast, pinned, newer, tieFirst))

        assertEquals(listOf(pinned), sections.pinned)
        assertEquals(listOf(newer, tieFirst, tieLast, older), sections.others)
        assertEquals(true, sections.hasHeadings)
        assertEquals(false, NoteOrder.sections(listOf(older)).hasHeadings)
    }

    @Test
    fun theFilesOfANoteAreOldestFirst() {
        val first = NoteFile("b", "n", "a.jpg", "image/jpeg", 1, createdAt = 1_000)
        val second = NoteFile("a", "n", "b.jpg", "image/jpeg", 1, createdAt = 2_000)
        val tie = NoteFile("c", "n", "c.jpg", "image/jpeg", 1, createdAt = 1_000)

        assertEquals(listOf(first, tie, second), listOf(second, tie, first).sortedWith(NoteOrder.FILES))
    }

    @Test
    fun aRowShowsTheTitleOrTheFirstLineOfTheTextAndTheTextWithoutMarks() {
        assertEquals("Trip", NoteRow.title(note(title = "Trip", body = "# Kutaisi")))
        assertEquals("With no title, the first line without its marks", "Kutaisi", NoteRow.title(note(title = "", body = "# **Kutaisi**\nPassport")))
        assertEquals("With neither, the screen shows Empty note", "", NoteRow.title(note(title = "", body = "")))
        assertEquals("Kutaisi Passport", NoteRow.preview(note(body = "# Kutaisi\n- [ ] Passport")))
    }
}
