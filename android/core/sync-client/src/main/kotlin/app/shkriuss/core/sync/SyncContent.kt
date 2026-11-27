package app.shkriuss.core.sync

import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecordKeyIds
import app.shkriuss.core.crypto.RecordSealer
import app.shkriuss.core.data.SyncTaken
import app.shkriuss.core.data.isDeleted
import java.io.File
import java.io.InputStream

/**
 * What one data app gives to sync and takes from it. Each data app
 * implements it once, as it implements `BackupContent`. `core/sync-client`
 * knows no table and no record type of any app, so everything that is the
 * app's own goes through here (docs/architecture/sync-protocol.md).
 *
 * Every function that reads or writes records is called inside a
 * transaction of the app's database that sync holds. It must use the same
 * database, through the DAOs and `RecordWriter`.
 */
interface SyncContent {
    /** The app's data version: the same number as in its backups. */
    val dataVersion: Int

    /**
     * True if the app wipes the content of deleted records (ADR 0042).
     * Such an app sends a deleted record only in its wiped form.
     */
    val wipes: Boolean

    /**
     * Up to [limit] records of every table whose change number is above
     * [afterChangeNumber], deleted ones included, lowest change number
     * first. Only the IDs and the change numbers, so that a long list
     * costs little memory.
     */
    suspend fun changesSince(afterChangeNumber: Long, limit: Int): List<SyncChange>

    /** The record with [id], in whichever table holds it, deleted or not. Null if none is stored. */
    suspend fun find(id: String): SyncRecord?

    /**
     * Reads a record that came through sync, sealed by an app of data
     * version [dataVersion], which is never above the app's own. Returns
     * the record as this version of the app holds it, or null if it breaks
     * a check that a record of a backup of that data version must pass: a
     * type the app does not have in that version, or content that is not
     * valid. A record of a lower version is read by the app's reader for
     * that version, as in a restore.
     */
    fun read(dataVersion: Int, entry: BackupRecord): SyncRecord?

    /**
     * Writes [record], which [read] gave, with `RecordWriter.takeFromSync`
     * of its table. [tie] gets the stored record and [record], both as
     * [SyncRecord], when their `updatedAt` is the same. The app passes its
     * answer on.
     */
    suspend fun take(record: SyncRecord, tie: (stored: SyncRecord, came: SyncRecord) -> Int): SyncTaken

    /**
     * True while a file key is sealed by a key that exists only on this
     * phone (crypto-design.md, "The file-key keyset without a recovery
     * key", point 5). Every file's record is then held back.
     */
    fun fileKeysOnlyOnThisPhone(): Boolean

    /** True if the stored stream of the file [fileId] is on this phone, with [length] bytes. */
    fun hasStream(fileId: String, length: Long): Boolean

    /** Opens the stored stream of the file [fileId], which [hasStream] found. The caller closes it. */
    fun openStream(fileId: String): InputStream

    /**
     * Moves a stream that sync fetched and checked into the app's file
     * store, as a restore does. [fetched] is in the folder that sync was
     * given, and is gone afterwards. Sync calls it once it found the
     * record still live. The app's own writes go on beside sync, so the
     * app moves the stream in only if its record is still live when it
     * holds the lock that its own writes of streams take, and else
     * deletes [fetched].
     */
    suspend fun moveStreamIn(fileId: String, fetched: File)

    /**
     * Removes this phone's copy of the stream of the file [fileId], whose
     * deleted record sync took. Sync calls it after its transaction, once
     * it found the record still deleted. The app's own writes go on beside
     * sync, so the app removes the stream only if its record is still
     * deleted when it holds the lock that its own writes of streams take.
     */
    suspend fun removeStream(fileId: String)

    /**
     * Called after the last page of a fetch, outside its transaction. The
     * app sets its alarms again, as after a restore. It changes no record.
     */
    suspend fun afterImport()

    /**
     * Called once the app syncs with a new recovery key. The app seals its
     * file keys again under it, with `RecordWriter.sealFileKeyAgain`. A
     * file's record is held back until its wrapped key names that key.
     */
    suspend fun sealFileKeysAgain()
}

/** One change that [SyncContent.changesSince] lists: a record's ID and its change number. */
class SyncChange(val id: String, val changeNumber: Long) {
    override fun toString(): String = "SyncChange($changeNumber)"
}

/**
 * One record as sync sees it.
 *
 * - [entry] is the record as the app writes it into a backup, in its own
 *   data version: its type, its four fields and its content.
 * - [isFile] is true for the record of a file.
 * - [streamLength] is the length of the file's stored stream, as the
 *   record's own size gives it. It is there exactly for a file's record
 *   that is not wiped.
 * - [wrappedKeyId] is the key ID that the record's wrapped file key
 *   names in its bytes 6 to 9, if it holds one.
 * - [wiped] is true for a deleted record in its wiped form (ADR 0042).
 * - [changeNumber] is the stored record's change number, or 0 for one
 *   that came through sync.
 */
class SyncRecord(
    val entry: BackupRecord,
    val isFile: Boolean = false,
    val streamLength: Long? = null,
    val wrappedKeyId: KeyId? = null,
    val wiped: Boolean = false,
    val changeNumber: Long = 0,
) {
    init {
        require(streamLength == null || (isFile && !wiped && streamLength >= 0)) { "Only a file's record that is not wiped has a stream" }
        require(!wiped || entry.fields.isDeleted) { "Only a deleted record is wiped" }
    }

    /** The record's ID. */
    val id: String get() = entry.fields.id

    /** True once the record is deleted. */
    val isDeleted: Boolean get() = entry.fields.isDeleted

    /** Names the record and never shows what is in it. */
    override fun toString(): String = "SyncRecord(${entry.type})"
}

/**
 * The keys that seal and open sealed records. An app gives sync its
 * [RecordSealer] through [ofSealer].
 */
interface SyncKeys {
    /**
     * The key IDs of the app's `record` keyset. Throws
     * `BlobException` if the app has no keys yet or cannot read them now.
     */
    fun keyIds(): RecordKeyIds

    /** Seals [plaintext] for the record [recordId] with the current key. */
    fun seal(recordId: String, plaintext: ByteArray): ByteArray

    /** Opens a sealed record. Throws `BlobException` with the answer. */
    fun open(recordId: String, blob: ByteArray): ByteArray

    /** The keys of an app's [RecordSealer]. */
    companion object {
        /** Sync's view of [sealer]. */
        fun ofSealer(sealer: RecordSealer): SyncKeys = object : SyncKeys {
            override fun keyIds(): RecordKeyIds = sealer.keyIds()

            override fun seal(recordId: String, plaintext: ByteArray): ByteArray = sealer.seal(recordId, plaintext)

            override fun open(recordId: String, blob: ByteArray): ByteArray = sealer.open(recordId, blob)
        }
    }
}
