package app.shkriuss.feature.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The marks of the text, and what the formatting bar, Enter and a tap on a box do (docs/apps/notes/spec.md, "Formatting"). */
class NoteFormattingTest {
    private fun kind(line: String) = NoteFormatting.lineMark(line)?.kind

    private fun looksOf(text: String, look: Look) =
        NoteFormatting.looks(text).filter { it.look == look }.map { text.substring(it.start, it.end) }

    @Test
    fun aLineMarkCountsOnlyAtTheVeryStartOfTheLine() {
        assertEquals(LineKind.HEADING, kind("# Trip"))
        assertEquals(LineKind.BULLET, kind("- Passport"))
        assertEquals(LineKind.OPEN_ITEM, kind("- [ ] Passport"))
        assertEquals(LineKind.DONE_ITEM, kind("- [x] Tickets"))
        assertEquals(LineKind.DONE_ITEM, kind("- [X] Tickets"))
        assertEquals(LineKind.NUMBERED, kind("1. First"))
        assertEquals(99_999, NoteFormatting.lineMark("99999. Last")?.number)
        assertNull("Above 99,999", kind("100000. Too far"))
        assertNull("No number 0", kind("0. Zero"))
        assertNull(kind(" # Not at the start"))
        assertNull(kind("#No space"))
        assertNull(kind("-No space"))
        assertEquals("A checklist mark without its space is a bullet", LineKind.BULLET, kind("- [ ]Passport"))
        assertNull(kind("1.First"))
    }

    @Test
    fun boldAndItalicCountOnOneLineAroundTextThatDoesNotStartOrEndWithASpace() {
        assertEquals(listOf("bold"), looksOf("a **bold** b", Look.BOLD))
        assertEquals(listOf("it"), looksOf("a *it* b", Look.ITALIC))
        assertEquals(emptyList<String>(), looksOf("a ** spaced** b", Look.BOLD))
        assertEquals(emptyList<String>(), looksOf("a **spaced ** b", Look.BOLD))
        assertEquals("Both marks on one line", emptyList<String>(), looksOf("a **open\nclose** b", Look.BOLD))
        assertEquals("The nearest closing mark counts", listOf("one", "two"), looksOf("**one** and **two**", Look.BOLD))
        assertEquals("** is read before *", listOf("x"), looksOf("**x**", Look.BOLD))
        assertEquals(emptyList<String>(), looksOf("**x**", Look.ITALIC))
        assertEquals("Marks inside a heading count", listOf("big"), looksOf("# A **big** day", Look.BOLD))
    }

    @Test
    fun theMarksShowAsMarksAndAHeadingAndADoneItemHaveTheirLooks() {
        val text = "# Trip\n- [x] **Tickets**\n- [ ] Passport"

        assertEquals(listOf("# ", "- [x] ", "**", "**", "- [ ] "), looksOf(text, Look.MARK))
        assertEquals(listOf("# Trip"), looksOf(text, Look.HEADING))
        assertEquals(listOf("**Tickets**"), looksOf(text, Look.DONE))
        assertEquals(listOf("Tickets"), looksOf(text, Look.BOLD))
    }

    @Test
    fun aTapOnABoxTicksItsItemOrOpensItAgain() {
        val text = "- [ ] Passport\n- [x] Tickets"
        val boxes = NoteFormatting.boxes(text)

        assertEquals(listOf("[ ]", "[x]"), boxes.map { text.substring(it.first, it.last + 1) })
        assertEquals("- [x] Passport\n- [x] Tickets", NoteFormatting.toggleBox(text, boxes[0].first))
        assertEquals("- [ ] Passport\n- [ ] Tickets", NoteFormatting.toggleBox(text, boxes[1].first))
        assertEquals("No box there", text, NoteFormatting.toggleBox(text, 0))
        assertEquals(true, NoteFormatting.itemAt(text, text.length))
        assertEquals(false, NoteFormatting.itemAt(text, 3))
        assertNull(NoteFormatting.itemAt("Plain", 2))
    }

    @Test
    fun headingAndBulletsAddTheirMarkInPlaceOfAnotherOrRemoveItWhenEveryLineHasIt() {
        val text = "Trip\n1. Passport\n- Tickets"
        val all = TextEdit(text, 0, text.length)

        assertEquals("- Trip\n- Passport\n- Tickets", NoteFormatting.toggleLineMark(all, LineKind.BULLET).text)
        assertEquals("Trip\nPassport\nTickets", NoteFormatting.toggleLineMark(TextEdit("- Trip\n- Passport\n- Tickets", 0, 26), LineKind.BULLET).text)
        assertEquals("# Trip\n1. Passport\n- Tickets", NoteFormatting.toggleLineMark(TextEdit(text, 2), LineKind.HEADING).text)
        assertEquals("Trip", NoteFormatting.toggleLineMark(TextEdit("# Trip", 6), LineKind.HEADING).text)
    }

    @Test
    fun theCursorStaysOnItsTextWhenALineMarkChanges() {
        val bullet = NoteFormatting.toggleLineMark(TextEdit("Trip\nPassport", 7), LineKind.BULLET)
        assertEquals("Only the line of the cursor", "Trip\n- Passport", bullet.text)
        assertEquals("Still after \"Pa\"", 9, bullet.start)

        val both = NoteFormatting.toggleLineMark(TextEdit("Trip\nPassport", 2, 7), LineKind.BULLET)
        assertEquals("- Trip\n- Passport", both.text)
        assertEquals("The selection keeps its text", "ip\n- Pa", both.text.substring(both.start, both.end))
        val atLineStart = NoteFormatting.toggleLineMark(TextEdit("Trip", 0), LineKind.HEADING)
        assertEquals("After the new mark", 2, atLineStart.start)
        val removed = NoteFormatting.toggleLineMark(TextEdit("- Trip", 1), LineKind.BULLET)
        assertEquals("Inside the old mark: at the line's start", TextEdit("Trip", 0), removed)
    }

    @Test
    fun numbersCountFromOneOrGoWhenEveryLineIsNumbered() {
        val text = "Passport\n- Tickets\nKeys"

        val numbered = NoteFormatting.toggleNumbers(TextEdit(text, 0, text.length))
        assertEquals("1. Passport\n2. Tickets\n3. Keys", numbered.text)
        assertEquals("Passport\nTickets\nKeys", NoteFormatting.toggleNumbers(TextEdit(numbered.text, 0, numbered.text.length)).text)
        assertTrue(NoteFormatting.isOn(TextEdit(numbered.text, 1), LineKind.NUMBERED))
        assertFalse(NoteFormatting.isOn(TextEdit(text, 1), LineKind.NUMBERED))
    }

    @Test
    fun checklistTurnsALineIntoAnOpenItemAndTicksAndOpensItems() {
        assertEquals("- [ ] Passport", NoteFormatting.toggleChecklist(TextEdit("Passport", 0)).text)
        assertEquals("- [ ] Passport", NoteFormatting.toggleChecklist(TextEdit("- Passport", 0)).text)
        assertEquals("- [x] Passport", NoteFormatting.toggleChecklist(TextEdit("- [ ] Passport", 0)).text)
        assertEquals("- [ ] Passport", NoteFormatting.toggleChecklist(TextEdit("- [X] Passport", 0)).text)
    }

    @Test
    fun boldAndItalicGoAroundTheSelectionOrComeAwayOrGoInAtTheCursor() {
        val bold = NoteFormatting.toggleInline(TextEdit("a word b", 2, 6), "**")
        assertEquals(TextEdit("a **word** b", 4, 8), bold)
        assertEquals("Exactly around it: taken away", TextEdit("a word b", 2, 6), NoteFormatting.toggleInline(bold, "**"))
        assertEquals("No selection: the cursor between them", TextEdit("a **** b", 4), NoteFormatting.toggleInline(TextEdit("a  b", 2), "**"))
        assertEquals(TextEdit("*it*", 1, 3), NoteFormatting.toggleInline(TextEdit("it", 0, 2), "*"))
    }

    @Test
    fun enterAtTheEndOfAnItemStartsTheNextOne() {
        fun enter(text: String): TextEdit? {
            val before = TextEdit(text, text.length)
            return NoteFormatting.afterEnter(before, TextEdit(text + "\n", text.length + 1))
        }

        assertEquals(TextEdit("- Passport\n- ", 13), enter("- Passport"))
        assertEquals(TextEdit("1. Passport\n2. ", 15), enter("1. Passport"))
        assertEquals("A done item gives an open box", TextEdit("- [x] Tickets\n- [ ] ", 20), enter("- [x] Tickets"))
        assertNull("After item 99,999 the line starts with no mark", enter("99999. Last"))
        assertNull("A heading does not go on", enter("# Trip"))
        assertNull("A plain line does not go on", enter("Trip"))
        assertEquals("An item with no text after its mark loses the mark", TextEdit("Trip\n", 5), enter("Trip\n- "))
    }

    @Test
    fun enterInTheMiddleOfALineOrAnyOtherChangeDoesNothingMore() {
        val before = TextEdit("- Passport", 4)
        assertNull(NoteFormatting.afterEnter(before, TextEdit("- Pa\nssport", 5)))
        assertNull(NoteFormatting.afterEnter(TextEdit("- Passport", 10), TextEdit("- Passports", 11)))
    }

    @Test
    fun aLongLineOfMarksThatCloseNothingTakesOnePass() {
        // 100,000 characters in which every mark opens and none closes: each later mark follows a space.
        val line = "*a ".repeat(33_333)
        val started = System.nanoTime()

        assertEquals(emptyList<LookRange>(), NoteFormatting.looks(line).filter { it.look != Look.MARK })
        assertEquals(line.replace(" ", " "), NoteFormatting.plain(line))

        val seconds = (System.nanoTime() - started) / 1e9
        assertTrue("It took $seconds seconds", seconds < 2.0)
    }

    @Test
    fun aRowShowsTheTextWithoutItsMarksAndLineBreaksAsSpaces() {
        assertEquals("Trip Passport Tickets", NoteFormatting.plain("# Trip\n- [ ] Passport\n- [x] **Tickets**"))
        assertEquals("Marks that do not count stay", "a ** b", NoteFormatting.plain("a ** b"))
        assertEquals("1 and 2", NoteFormatting.plain("1. 1 and *2*"))
    }
}
