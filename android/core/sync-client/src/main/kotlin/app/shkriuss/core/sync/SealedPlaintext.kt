package app.shkriuss.core.sync

import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupRecordEntry

/** The stream part of a sealed record: the length and the SHA-256 of the file's stored stream. */
internal class StreamPart(val length: Long, val hash: ByteArray) {
    init {
        require(hash.size == SyncFormat.HASH_BYTES) { "A SHA-256 is 32 bytes" }
    }
}

/**
 * The plaintext of a sealed record (docs/architecture/sync-protocol.md,
 * "The sealed record"): the version `01`, the data version of the app
 * that sealed it, the record entry of a backup, and the stream part.
 */
internal object SealedPlaintext {
    private const val NO_STREAM = 0
    private const val STREAM = 1

    fun encode(dataVersion: Int, entry: BackupRecord, stream: StreamPart?): ByteArray {
        require(dataVersion >= 1) { "A data version starts at 1" }
        val writer = ByteWriter()
            .u8(SyncFormat.PLAINTEXT_VERSION)
            .i32(dataVersion)
            .bytes(BackupRecordEntry.encode(entry))
        if (stream == null) {
            writer.u8(NO_STREAM)
        } else {
            writer.u8(STREAM).i64(stream.length).bytes(stream.hash)
        }
        return writer.toByteArray()
    }

    /** What [decode] found. */
    sealed interface Decoded {
        /** A plaintext of a higher version, or of an app of a higher data version. */
        data object Newer : Decoded

        /** It breaks the layout. */
        data object NotValid : Decoded

        /** A whole plaintext. */
        class Whole(val dataVersion: Int, val entry: BackupRecord, val stream: StreamPart?) : Decoded
    }

    /**
     * Reads a plaintext in the order of "What a reader checks", points 4
     * to 6: its version byte, its data version against [ownDataVersion],
     * then the entry and the stream part, with nothing left over.
     */
    fun decode(plaintext: ByteArray, ownDataVersion: Int): Decoded {
        val reader = ByteReader(plaintext)
        return try {
            val version = reader.u8()
            if (version > SyncFormat.PLAINTEXT_VERSION) return Decoded.Newer
            if (version != SyncFormat.PLAINTEXT_VERSION) return Decoded.NotValid
            val dataVersion = reader.i32()
            if (dataVersion < 1) return Decoded.NotValid
            if (dataVersion > ownDataVersion) return Decoded.Newer
            val entry = BackupRecordEntry.decode(plaintext, reader.position) ?: return Decoded.NotValid
            reader.position = entry.end
            val stream = when (reader.u8()) {
                NO_STREAM -> null
                STREAM -> StreamPart(reader.i64(), reader.bytes(SyncFormat.HASH_BYTES))
                else -> return Decoded.NotValid
            }
            reader.end()
            if (stream != null && stream.length < 0) return Decoded.NotValid
            Decoded.Whole(dataVersion, entry.record, stream)
        } catch (_: LayoutException) {
            Decoded.NotValid
        }
    }
}
