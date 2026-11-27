package app.shkriuss.core.sync

import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.data.RecordFields
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every step of the order for ties, each against each
 * (docs/architecture/sync-protocol.md, "Conflict rules", step 2, and
 * "What the tests must cover", `core/sync-client` point 2).
 */
class SyncOrderTest {
    private val id = "00112233-4455-4677-8899-aabbccddeeff"
    private val s = KeyId(0x0a0b0c0d)
    private val other = KeyId(0x01020304)

    /** One version of the record, with a content that makes its plaintext large or small. */
    private class Version(val name: String, val record: SyncRecord) {
        override fun toString(): String = name
    }

    private fun version(name: String, deleted: Boolean, wiped: Boolean, key: KeyId?, content: Int): Version {
        val fields = RecordFields(id, createdAt = 1, updatedAt = 5, deletedAt = if (deleted) 5 else null)
        val entry = BackupRecord("file", fields, byteArrayOf(content.toByte()))
        return Version(name, SyncRecord(entry, isFile = true, streamLength = if (wiped) null else 10, wrappedKeyId = key, wiped = wiped))
    }

    // The contents are chosen so that step 4 alone would pick the other one of each pair that an earlier step decides.
    private val liveWithS = version("live, key S", deleted = false, wiped = false, key = s, content = 1)
    private val liveWithOther = version("live, other key", deleted = false, wiped = false, key = other, content = 2)
    private val deletedWithS = version("deleted, key S", deleted = true, wiped = false, key = s, content = 3)
    private val deletedWithOther = version("deleted, other key", deleted = true, wiped = false, key = other, content = 4)
    private val wiped = version("wiped", deleted = true, wiped = true, key = null, content = 5)

    /** The winner of each pair, by the first step that tells them apart. */
    private val winners = mapOf(
        setOf(liveWithS, liveWithOther) to liveWithS, // step 3, though step 4 would pick the other
        setOf(liveWithS, deletedWithS) to liveWithS, // step 1
        setOf(liveWithS, deletedWithOther) to liveWithS, // step 1
        setOf(liveWithS, wiped) to liveWithS, // step 1
        setOf(liveWithOther, deletedWithS) to liveWithOther, // step 1 before step 3
        setOf(liveWithOther, deletedWithOther) to liveWithOther, // step 1
        setOf(liveWithOther, wiped) to liveWithOther, // step 1
        setOf(deletedWithS, deletedWithOther) to deletedWithS, // step 3
        setOf(deletedWithS, wiped) to wiped, // step 2 before step 3
        setOf(deletedWithOther, wiped) to wiped, // step 2
    )

    @Test
    fun eachVersionAgainstEachWinsByTheFirstStepThatTellsThemApart() {
        val all = listOf(liveWithS, liveWithOther, deletedWithS, deletedWithOther, wiped)
        for (stored in all) {
            for (came in all) {
                val order = tie(stored, came)
                if (stored === came) {
                    assertEquals("$stored against itself is the same", 0, order)
                    continue
                }
                val winner = winners.getValue(setOf(stored, came))
                assertEquals("stored $stored, came $came", if (winner === came) 1 else -1, order)
            }
        }
    }

    @Test
    fun stepFourComparesThePlaintextsByteByByteAndTheLongerWinsWhenOneStartsTheOther() {
        assertEquals(1, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(1, 2), byteArrayOf(1, 3)))
        assertEquals(-1, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(1, 3), byteArrayOf(1, 2)))
        assertEquals("bytes are unsigned", 1, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(0x7f), byteArrayOf(0x80.toByte())))
        assertEquals("the longer one is larger", 1, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(1), byteArrayOf(1, 0)))
        assertEquals(-1, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(1, 0), byteArrayOf(1)))
        assertEquals("the same bytes are the same record", 0, SyncOrder.tie(liveWithS.record, liveWithS.record, s, byteArrayOf(1, 2), byteArrayOf(1, 2)))
    }

    @Test
    fun stepThreeTellsNothingApartWhenNeitherOrBothKeysNameS() {
        val alsoOther = version("live, other key, larger", deleted = false, wiped = false, key = other, content = 9)
        assertEquals("both name another key: step 4 decides", 1, tie(liveWithOther, alsoOther))
        val alsoS = version("live, key S, larger", deleted = false, wiped = false, key = s, content = 9)
        assertEquals("both name S: step 4 decides", 1, tie(liveWithS, alsoS))
        val noKey = Version("a record without a key", SyncRecord(BackupRecord("item", liveWithS.record.entry.fields, byteArrayOf(9))))
        assertEquals("only one has a key: step 4 decides", 1, tie(liveWithS, noKey))
    }

    private fun tie(stored: Version, came: Version): Int = SyncOrder.tie(
        stored = stored.record,
        came = came.record,
        syncKeyId = s,
        storedPlaintext = plaintext(stored),
        camePlaintext = plaintext(came),
    )

    private fun plaintext(version: Version): ByteArray =
        SealedPlaintext.encode(1, version.record.entry, version.record.streamLength?.let { StreamPart(it, ByteArray(32)) })
}
