package app.shkriuss.core.backup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** IDs in a backup are the 16 bytes of the UUID, in the order of its hex digits (backup-format.md, "Record"). */
class BackupIdsTest {
    @Test
    fun anIdIsItsSixteenBytesInTheOrderOfItsDigits() {
        // The ID of the vectors in crypto-design.md.
        val bytes = BackupIds.toBytes("00112233-4455-4677-8899-aabbccddeeff")

        assertEquals("00112233445546778899aabbccddeeff", bytes.toHex())
        assertEquals("00112233-4455-4677-8899-aabbccddeeff", BackupIds.toText(bytes))
    }

    @Test
    fun hexDigitsAreTakenInEitherCaseAndGivenBackInLowerCase() {
        val bytes = BackupIds.toBytes("0F1E2D3C-4B5A-4978-8695-A4B3C2D1E0FF")

        assertEquals("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff", BackupIds.toText(bytes))
    }

    @Test
    fun onlyTheThirtySixCharacterFormIsTaken() {
        val notIds = listOf(
            "",
            "1",
            "00112233445546778899aabbccddeeff",
            "00112233-4455-4677-8899-aabbccddeef",
            "00112233-4455-4677-8899-aabbccddeeff0",
            "{00112233-4455-4677-8899-aabbccddeeff}",
            "0011223g-4455-4677-8899-aabbccddeeff",
            "1-1-1-1-1",
        )

        notIds.forEach { text ->
            assertTrue("\"$text\" is no ID", runCatching { BackupIds.toBytes(text) }.exceptionOrNull() is IllegalArgumentException)
        }
    }
}
