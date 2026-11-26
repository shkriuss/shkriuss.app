package app.shkriuss.feature.notes

import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The limits of every column, the wiped form, and how the title, the
 * text, a file's name and its type are kept from what is typed or picked
 * (docs/apps/notes/spec.md, "A note", point 7, "Data", "The wiped form",
 * "Limits and defaults" and "Adding a file", point 3).
 */
class NoteLimitsTest {
    private val fields = RecordFields(TestIdSource.idNumber(1), 1_000, 2_000, deletedAt = null)
    private val deleted = fields.copy(deletedAt = 2_000)
    private val noteId = TestIdSource.idNumber(9)
    private val key = NoteLimits.WRAPPED_KEY_START + ByteArray(168) { 1 }

    private fun note(title: String = "Trip", body: String = "Passport", pinned: Boolean = false, fileChanges: Int = 0, record: RecordFields = fields) =
        NoteEntity(record, 1, title, body, pinned, fileChanges)

    private fun file(
        name: String = "ticket.jpg",
        type: String = "image/jpeg",
        size: Long = 2_400_000,
        wrappedKey: ByteArray = key,
        record: RecordFields = fields,
        note: String = noteId,
    ) = AttachmentEntity(record, 1, note, name, type, size, wrappedKey)

    @Test
    fun theTitleKeepsOneLineAndNoControlCharacter() {
        assertEquals("Trip to Kutaisi", NoteText.title("Trip\r\nto\nKutaisi"))
        assertEquals("Trip to", NoteText.title("Trip\rto"))
        assertEquals("Trip", NoteText.title("Tr\u0007i\tp"))
        assertEquals("a b", NoteText.title("a b"))
        assertEquals("Spaces at both ends go when it is saved", "Trip", NoteText.savedTitle("  Trip  "))
    }

    @Test
    fun theTextKeepsLineBreaksAsNewLinesAndTabs() {
        assertEquals("a\nb\nc\n", NoteText.body("a\r\nb\rc\n"))
        assertEquals("a\tb", NoteText.body("a\tb"))
        assertEquals("Other control characters go", "ab", NoteText.body("a\u0000\u001b\u0085b"))
        assertEquals("The line and paragraph separators are line breaks", "a\nb\nc", NoteText.body("a\u2028b\u2029c"))
        assertFalse(NoteRules.isBody("a\u2028b"))
    }

    @Test
    fun charactersAreCodePoints() {
        val emoji = "😀"
        assertEquals(1, NoteText.length(emoji))
        assertTrue(NoteRules.isTitle(emoji.repeat(NoteLimits.MOST_TITLE)))
        assertFalse(NoteRules.isTitle(emoji.repeat(NoteLimits.MOST_TITLE + 1)))
    }

    @Test
    fun aNoteIsWithinItsLimits() {
        assertTrue(NoteRules.isStored(note()))
        assertTrue("An empty note is a good record", NoteRules.isStored(note(title = "", body = "")))
        assertTrue(NoteRules.isStored(note(title = "a".repeat(200), body = "b".repeat(100_000))))
        assertFalse(NoteRules.isStored(note(title = "a".repeat(201))))
        assertFalse(NoteRules.isStored(note(body = "b".repeat(100_001))))
        assertFalse("A space at an end", NoteRules.isStored(note(title = " Trip")))
        assertFalse("Two lines", NoteRules.isStored(note(title = "Trip\nKutaisi")))
        assertFalse("A tab in the title", NoteRules.isStored(note(title = "Tr\tip")))
        assertFalse("\\r in the text", NoteRules.isStored(note(body = "a\r\nb")))
        assertFalse("A control character in the text", NoteRules.isStored(note(body = "a\u0000b")))
        assertTrue("A tab in the text", NoteRules.isStored(note(body = "a\tb")))
        assertFalse(NoteRules.isStored(note(fileChanges = -1)))
        assertTrue(NoteRules.isStored(note(fileChanges = Int.MAX_VALUE)))
    }

    @Test
    fun aFileThatIsNotDeletedIsWithinItsLimits() {
        assertTrue(NoteRules.isStored(file()))
        assertTrue(NoteRules.isStored(file(size = 0)))
        assertTrue(NoteRules.isStored(file(size = 25_000_000)))
        assertFalse(NoteRules.isStored(file(size = 25_000_001)))
        assertFalse(NoteRules.isStored(file(size = -1)))
        assertFalse(NoteRules.isStored(file(name = "")))
        assertFalse(NoteRules.isStored(file(name = "x".repeat(256))))
        assertFalse(NoteRules.isStored(file(name = " ticket.jpg")))
        assertFalse(NoteRules.isStored(file(name = "a\nb")))
        assertFalse(NoteRules.isStored(file(type = "image/JPEG")))
        assertFalse(NoteRules.isStored(file(type = "jpeg")))
        assertFalse(NoteRules.isStored(file(type = "a/")))
        assertTrue(NoteRules.isStored(file(type = "a/b")))
        assertFalse(NoteRules.isStored(file(type = "a/" + "b".repeat(126))))
        assertFalse(NoteRules.isStored(file(wrappedKey = ByteArray(0))))
        assertFalse("Not a wrapped key", NoteRules.isStored(file(wrappedKey = ByteArray(173))))
        assertFalse("Too short", NoteRules.isStored(file(wrappedKey = key.copyOf(49))))
        assertTrue(NoteRules.isStored(file(wrappedKey = key.copyOf(50))))
        assertFalse("Too long", NoteRules.isStored(file(wrappedKey = key.copyOf(1_025))))
        assertFalse("Its note is no version 4 UUID", NoteRules.isStored(file(note = "note")))
    }

    @Test
    fun theWipedFormOfAFileIsGoodOnlyForADeletedFileAndAPartlyWipedFileIsRefused() {
        val wiped = NoteRules.wiped(file(record = deleted))

        assertEquals(file(name = "", type = "", size = 0, wrappedKey = ByteArray(0), record = deleted), wiped)
        assertTrue(NoteRules.isWiped(wiped))
        assertTrue(NoteRules.isStored(wiped))
        assertFalse("A file that is not deleted is never wiped", NoteRules.isStored(NoteRules.wiped(file())))
        assertFalse("Partly wiped", NoteRules.isStored(wiped.copy(name = "ticket.jpg")))
        assertFalse("Partly wiped", NoteRules.isStored(wiped.copy(wrappedKey = key)))
        assertTrue("A deleted file within its limits", NoteRules.isStored(file(record = deleted)))
    }

    @Test
    fun theWipedFormOfANoteIsAnEmptyNote() {
        val wiped = NoteRules.wiped(note(pinned = true, fileChanges = 3, record = deleted))

        assertEquals(note(title = "", body = "", pinned = false, fileChanges = 0, record = deleted), wiped)
        assertTrue(NoteRules.isWiped(wiped))
        assertTrue(NoteRules.isStored(wiped))
        assertFalse(NoteRules.isWiped(note(title = "", body = "", fileChanges = 1)))
    }

    @Test
    fun aFileComparesItsKeyByItsBytes() {
        assertEquals(file(wrappedKey = key.copyOf()), file(wrappedKey = key.copyOf()))
        assertEquals(file(wrappedKey = key.copyOf()).hashCode(), file(wrappedKey = key.copyOf()).hashCode())
        assertFalse(file() == file(wrappedKey = key.copyOf().also { it[60] = 2 }))
    }

    @Test
    fun fileChangesGoBackToZeroAfterTheLargestNumber() {
        assertEquals(1, NoteRules.nextFileChanges(0))
        assertEquals(0, NoteRules.nextFileChanges(Int.MAX_VALUE))
    }

    @Test
    fun aPickedNameIsCleanedInTheOrderOfTheSpec() {
        assertEquals("ticket.jpg", FileText.name("ticket.jpg", "File"))
        assertEquals("Line breaks and control characters become spaces", "tick et.jpg", FileText.name("tick\net.jpg", "File"))
        assertEquals("a b", FileText.name("a\u0000b", "File"))
        assertEquals("Spaces at both ends go", "ticket.jpg", FileText.name("  ticket.jpg\n", "File"))
        assertEquals("File", FileText.name("   ", "File"))
        assertEquals("File", FileText.name(null, "File"))
        assertEquals("It keeps its first 255 characters", "x".repeat(255), FileText.name("x".repeat(300), "File"))
        assertEquals("The cut comes before the spaces go", "x".repeat(254), FileText.name("x".repeat(254) + " y", "File"))
        assertTrue(FileText.isName(FileText.name("😀".repeat(300), "File")))
    }

    @Test
    fun aTypeOutsideTheLimitsBecomesOctetStream() {
        assertEquals("image/jpeg", FileText.type("image/jpeg"))
        assertEquals("application/vnd.oasis.opendocument.text", FileText.type("application/vnd.oasis.opendocument.text"))
        assertEquals(NoteLimits.UNKNOWN_TYPE, FileText.type(null))
        assertEquals(NoteLimits.UNKNOWN_TYPE, FileText.type("image/JPEG"))
        assertEquals(NoteLimits.UNKNOWN_TYPE, FileText.type("text/plain; charset=utf-8"))
        assertEquals(NoteLimits.UNKNOWN_TYPE, FileText.type("image"))
    }
}
