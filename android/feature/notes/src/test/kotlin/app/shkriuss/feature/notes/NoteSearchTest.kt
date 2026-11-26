package app.shkriuss.feature.notes

import java.util.Locale
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        assertEquals("The match in the name is in bold", listOf(0..5), match?.inFileName)
        assertNull(match?.line)
        assertNull("A title that matches shows the row as in the list", NoteSearch.match(note(title = "ticket"), listOf("ticket.jpg"), "ticket")?.fileName)
    }

    @Test
    fun aMatchFarIntoALongLineShowsFromTheNextWordALittleBeforeIt() {
        val line = "Bread, milk and eggs for the week, and something for dinner on Friday when the guests come"
        val match = checkNotNull(NoteSearch.match(note(body = line), emptyList(), "guests")?.line)

        val shown = NoteSearch.shownLine(match)

        assertEquals("…when the guests come", shown.line)
        assertEquals("guests", shown.line.substring(shown.ranges.single()))
    }

    @Test
    fun aMatchNearTheStartShowsTheLineAsItIs() {
        val match = checkNotNull(NoteSearch.match(note(body = "Bread, milk and eggs"), emptyList(), "milk")?.line)

        assertEquals(match, NoteSearch.shownLine(match))
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
        assertEquals("Empty lines and lines with only a mark are passed over", "Passport", NoteRow.title(note(title = "", body = "\n  \n- [ ] \n# \n- [ ] Passport\nKeys")))
        assertEquals("Only line marks and spaces: Empty note", "", NoteRow.title(note(title = "", body = "\n- [ ] \n# ")))
        assertEquals("Kutaisi Passport", NoteRow.preview(note(body = "# Kutaisi\n- [ ] Passport")))
    }

    @Test
    fun aRowKeepsTheFirstThousandCharactersOfTheTextAndNeverHalfACharacter() {
        val words = "word ".repeat(20_000)
        assertEquals(100_000, words.length)
        assertEquals(words.take(1_000), NoteRow.preview(note(body = words)))
        assertEquals("With no title, the first line is the title: its first 1,000 characters", "a".repeat(1_000), NoteRow.title(note(title = "", body = "a".repeat(100_000))))
        // 1,001 characters that take two places each: the row keeps 1,000 whole ones.
        assertEquals("😀".repeat(1_000), NoteRow.preview(note(body = "😀".repeat(1_001))))
        assertEquals("A short text is kept whole", "Passport", NoteRow.preview(note(body = "Passport")))
        assertEquals("A title of the note's own is kept whole", "t".repeat(200), NoteRow.title(note(title = "t".repeat(200), body = words)))
    }

    @Test
    fun theLineOfAMatchIsKeptAsTheRowShowsItAndNoLongerThanAThousandCharacters() {
        val line = "a".repeat(50_000) + " rent " + "b".repeat(49_994)
        val match = checkNotNull(NoteSearch.match(note(body = line), emptyList(), "rent"))

        val kept = NoteSearch.rowLine(checkNotNull(match.line))

        assertEquals(1_000, NoteText.length(kept.line))
        assertEquals("It starts just before the match", "…rent b", kept.line.take(7))
        assertEquals("The match is where its range says", "rent", kept.line.substring(kept.ranges.single()))
        val both = "rent " + "c".repeat(2_000) + " rent"
        val first = NoteSearch.rowLine(checkNotNull(NoteSearch.match(note(body = both), emptyList(), "rent")?.line))
        assertEquals("A match past the part that is kept is not marked", listOf(0..3), first.ranges)
        val short = MatchedLine("Pay the rent", listOf(8..11))
        assertEquals("A short line stays as it is", short, NoteSearch.rowLine(short))
    }

    @Test
    fun aMatchInTheTitleOrTheTextComesBeforeOneInAFileName() {
        val trip = note(title = "Trip", body = "Buy a ticket")
        assertNull(NoteSearch.inNote(trip, "pdf"))
        assertEquals("map.pdf", NoteSearch.inFileNames(listOf("ticket.jpg", "map.pdf"), "PDF")?.fileName)
        assertNull("An empty search matches no file", NoteSearch.inFileNames(listOf("map.pdf"), ""))
        assertEquals(NoteSearch.inNote(trip, "ticket"), NoteSearch.match(trip, listOf("ticket.jpg"), "ticket"))
        assertEquals(NoteSearch.inFileNames(listOf("map.pdf"), "map"), NoteSearch.match(trip, listOf("map.pdf"), "map"))
    }

    /**
     * A search first asks the cheap question, whether the text lower-cased
     * once holds what was typed, and works out the places only then
     * ([NoteSearch.placesIn]). The question must never leave a match out.
     */
    private fun assertTheSameWithAndWithoutTheCheapQuestion(text: String, typed: String): Int {
        val wanted = typed.lowercase(Locale.ROOT)
        val places = NoteSearch.placesIn(text, wanted)
        assertEquals("\"$typed\" in \"$text\"", places, NoteSearch.rangesIn(text, wanted))
        return places.size
    }

    @Test
    fun theCheapQuestionOfASearchLeavesNoMatchOut() {
        val texts = listOf(
            "", "Trip", "TRIP trip TrIp", "Café CAFÉ", "İstanbul İ", "i̇", "ΟΣ ΤΑ ΟΣ", "Σ", "aΣ", "Σa",
            "😀 Trip 😀", "ǅ ǆ Ǆ", "STRASSE straße", "a\nb", "  spaces  ", "**bold** *italic*",
        )
        val typed = listOf("trip", "TRIP", "é", "É", "i", "i̇", "̇", "ς", "σ", "ος", "ΟΣ", "😀", "ǆ", "ss", "ß", " ", "**", "\n", "a\nb")

        val found = texts.sumOf { text -> typed.sumOf { assertTheSameWithAndWithoutTheCheapQuestion(text, it) } }

        assertTrue("Matches were found: $found", found > 30)
    }

    @Test
    fun theCheapQuestionOfASearchLeavesNoMatchOutOfTenThousandMadeUpTexts() {
        val random = Random(20261126)
        val pieces = listOf("a", "B", "é", "É", "İ", "i", "̇", "Σ", "σ", "ς", "Ο", " ", "\n", "😀", "ǅ", "ß", "*", "-")
        var found = 0

        repeat(10_000) {
            val text = buildString { repeat(random.nextInt(12)) { append(pieces[random.nextInt(pieces.size)]) } }
            val typed = buildString { repeat(1 + random.nextInt(3)) { append(pieces[random.nextInt(pieces.size)]) } }
            if (assertTheSameWithAndWithoutTheCheapQuestion(text, typed) > 0) found++
        }

        assertTrue("Texts that match and texts that do not were both tried: $found matched", found in 500..9_000)
    }

    @Test
    fun theCheapQuestionOfASearchLeavesOutNoCharacterOfUnicode() {
        var found = 0
        for (codePoint in 0..Character.MAX_CODE_POINT) {
            if (codePoint in Character.MIN_SURROGATE.code..Character.MAX_SURROGATE.code) continue
            val character = String(Character.toChars(codePoint))
            // Between letters, at the end of a word and after a Greek capital: the final sigma looks at the letters around it.
            found += assertTheSameWithAndWithoutTheCheapQuestion("a${character}a $character Α$character", character)
        }

        assertTrue("Every character was found where it stands: $found places", found >= 3 * (Character.MAX_CODE_POINT - 2_048))
    }
}
