package app.shkriuss.core.sync

/** One record of a batch: its ID and its sealed record. */
internal class BatchRecord(val id: String, val blob: ByteArray)

/**
 * A batch, as `export` gives it (docs/architecture/sync-protocol.md,
 * "A batch"). The Sync app sends it without its first 17 bytes.
 */
internal object BatchLayout {
    fun write(token: Long, epoch: SyncId, cursor: Long, known: Long, comparison: Boolean, records: List<BatchRecord>): ByteArray {
        require(records.size in 1..SyncFormat.MOST_RECORDS) { "A batch holds 1 to 100 records" }
        val writer = ByteWriter()
            .header(SyncFormat.TYPE_BATCH)
            .i64(token)
            .bytes(epoch.toBytes())
            .i64(cursor)
            .i64(known)
            .u8(if (comparison) 1 else 0)
            .i32(records.size)
        records.forEach { writer.bytes(RecordIds.toBytes(it.id)).i32(it.blob.size).bytes(it.blob) }
        return writer.toByteArray()
    }
}

/** What the server answered for one record of a batch (docs/architecture/sync-protocol.md, "Send"). */
enum class SendResult(internal val code: Int, val hasNumber: Boolean) {
    STORED(0x00, true),
    CHANGED_AFTER_CURSOR(0x01, false),
    ANOTHER_KEY_ID(0x02, false),
    NOT_A_SEALED_RECORD(0x03, false),
    STORED_SEND_STREAM_AGAIN(0x04, true),
    CHUNKS_BEING_DELETED(0x05, false),
    ;

    internal companion object {
        fun of(code: Int): SendResult? = entries.firstOrNull { it.code == code }
    }
}

/** One result of the server's answer to a batch, with the record's new number after [SendResult.hasNumber]. */
class SendOutcome internal constructor(val result: SendResult, val number: Long)

/** The server's answer `00` to a batch: its epoch, the heads before and after it, and one result for each record. */
class SendAnswer internal constructor(val epoch: SyncId, val headBefore: Long, val headAfter: Long, val outcomes: List<SendOutcome>) {
    companion object {
        private const val DONE = 0x00

        /**
         * Reads the answer to a batch of [count] records. Returns null for
         * any other answer, and for one that breaks the layout or does not
         * hold together: a result this code does not know, another count,
         * a head that goes back, or numbers that are not above the head
         * before, not up to the head after, or not in order.
         */
        fun read(bytes: ByteArray, count: Int): SendAnswer? = try {
            val reader = ByteReader(bytes)
            if (reader.u8() != DONE) {
                null
            } else {
                val epoch = SyncId(reader.bytes(SyncFormat.ID_BYTES))
                val before = reader.i64()
                val after = reader.i64()
                if (reader.u32() != count.toLong()) throw LayoutException()
                var last = before
                val outcomes = List(count) {
                    val result = SendResult.of(reader.u8()) ?: throw LayoutException()
                    val number = if (result.hasNumber) reader.i64() else 0L
                    if (result.hasNumber) {
                        if (number <= last || number > after) throw LayoutException()
                        last = number
                    }
                    SendOutcome(result, number)
                }
                reader.end()
                if (before < 0 || after < before) throw LayoutException()
                SendAnswer(epoch, before, after, outcomes)
            }
        } catch (_: LayoutException) {
            null
        }
    }
}

/** One record of a page: its ID, the number the server gave it, and its sealed record. */
class PageRecord internal constructor(val id: String, val number: Long, val blob: ByteArray)

/**
 * A page, as the server answers a fetch and `import` takes it
 * (docs/architecture/sync-protocol.md, "Fetch" and "A page").
 */
class Page internal constructor(val epoch: SyncId, val since: Long, val through: Long, val more: Boolean, val records: List<PageRecord>) {
    companion object {
        private const val DONE = 0x00

        /**
         * Reads a page. Returns null for one that breaks its layout or the
         * rules a page keeps by itself: Through is below Since, the numbers
         * do not go up, a number is not above Since or is above Through, a
         * blob is not 50 to 524,288 bytes, or the blobs pass the byte limit
         * of a page while there are more than one.
         */
        fun read(bytes: ByteArray): Page? = try {
            val reader = ByteReader(bytes)
            if (reader.u8() != DONE) throw LayoutException()
            val epoch = SyncId(reader.bytes(SyncFormat.ID_BYTES))
            val since = reader.i64()
            val through = reader.i64()
            val more = when (reader.u8()) {
                0 -> false
                1 -> true
                else -> throw LayoutException()
            }
            val count = reader.u32()
            if (count > SyncFormat.MOST_RECORDS) throw LayoutException()
            if (since < 0 || through < since) throw LayoutException()
            var last = since
            var total = 0L
            val records = List(count.toInt()) {
                val id = RecordIds.toText(reader.bytes(SyncFormat.ID_BYTES))
                val number = reader.i64()
                val length = reader.u32()
                if (length !in SyncFormat.SMALLEST_SEALED..SyncFormat.LARGEST_SEALED) throw LayoutException()
                if (number <= last || number > through) throw LayoutException()
                last = number
                total += length
                if (it > 0 && total > SyncFormat.MOST_PAGE_BYTES) throw LayoutException()
                PageRecord(id, number, reader.bytes(length.toInt()))
            }
            reader.end()
            Page(epoch, since, through, more, records)
        } catch (_: LayoutException) {
            null
        }
    }
}
