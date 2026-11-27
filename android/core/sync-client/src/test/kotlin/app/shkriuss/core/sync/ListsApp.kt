package app.shkriuss.core.sync

import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Embedded
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.Query
import androidx.room3.RoomDatabase
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordSql
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.SyncTaken
import app.shkriuss.core.data.isDeleted
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/*
 * "Lists", a made-up data app for the tests of sync. It has two record
 * tables: items, which are text, and attachments, which are files with a
 * wrapped file key and a stored stream. Deleted records may be wiped. Its
 * database lists the seven sync tables, as every app that syncs does.
 */

/** One item: a title, and in data version 2 a pin. */
@Entity(tableName = "item", primaryKeys = ["id"], indices = [Index("changeNumber", unique = true)])
data class ItemEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    val title: String,
    val pinned: Boolean,
) : Record<ItemEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): ItemEntity = copy(record = record, changeNumber = changeNumber)
}

/** One attachment: a file with a name, a size, and a wrapped file key that names [keyId]. Wiped, it has no key. */
@Entity(tableName = "attachment", primaryKeys = ["id"], indices = [Index("changeNumber", unique = true)])
data class AttachmentEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    val name: String,
    val size: Long,
    val keyId: Int?,
    val keyBytes: String,
) : Record<AttachmentEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): AttachmentEntity = copy(record = record, changeNumber = changeNumber)
}

/** An ID and a change number, for [SyncContent.changesSince]. */
data class ChangeRow(val id: String, val changeNumber: Long)

@Dao
interface ItemDao : RecordDao<ItemEntity> {
    @Query("SELECT * FROM item WHERE id = :id")
    override suspend fun find(id: String): ItemEntity?

    @Query("SELECT * FROM item WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<ItemEntity>

    @Query("SELECT id, changeNumber FROM item WHERE changeNumber > :afterChangeNumber ORDER BY changeNumber LIMIT :limit")
    suspend fun changes(afterChangeNumber: Long, limit: Int): List<ChangeRow>

    @Query("SELECT * FROM item ORDER BY id")
    suspend fun all(): List<ItemEntity>
}

@Dao
interface AttachmentDao : RecordDao<AttachmentEntity> {
    @Query("SELECT * FROM attachment WHERE id = :id")
    override suspend fun find(id: String): AttachmentEntity?

    @Query("SELECT * FROM attachment WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<AttachmentEntity>

    @Query("SELECT id, changeNumber FROM attachment WHERE changeNumber > :afterChangeNumber ORDER BY changeNumber LIMIT :limit")
    suspend fun changes(afterChangeNumber: Long, limit: Int): List<ChangeRow>

    @Query("SELECT * FROM attachment ORDER BY id")
    suspend fun all(): List<AttachmentEntity>
}

/** The database of Lists, with the sync tables. */
@Database(
    entities = [
        ItemEntity::class,
        AttachmentEntity::class,
        ChangeCounter::class,
        SyncStateRow::class,
        SyncSendRow::class,
        SyncTakenRow::class,
        SyncSeenRow::class,
        SyncDamagedRow::class,
        SyncBatchRow::class,
        SyncStreamRow::class,
    ],
    version = 1,
)
abstract class ListsDatabase : RoomDatabase() {
    abstract fun items(): ItemDao

    abstract fun attachments(): AttachmentDao
}

/**
 * The [SyncContent] of Lists. [dataVersion] 1 writes an item as its title;
 * version 2 adds a pin byte in front, and reads items of version 1 as not
 * pinned. [streams] is the folder of the stored streams.
 */
class ListsContent(
    private val database: ListsDatabase,
    private val items: RecordWriter<ItemEntity>,
    private val attachments: RecordWriter<AttachmentEntity>,
    private val streams: File,
    override val dataVersion: Int = 1,
    override val wipes: Boolean = true,
    private val currentKeyId: () -> KeyId,
) : SyncContent {
    /** True while a file key is sealed by a key that exists only on this phone. */
    var fileKeysOnlyHere = false

    /** How many times sync called [afterImport]. */
    var afterImports = 0

    /** True to make the next [sealFileKeysAgain] stop before it writes, as when the app is stopped there. */
    var stopNextSeal = false

    override suspend fun changesSince(afterChangeNumber: Long, limit: Int): List<SyncChange> {
        val both = database.items().changes(afterChangeNumber, limit) + database.attachments().changes(afterChangeNumber, limit)
        return both.sortedBy { it.changeNumber }.take(limit).map { SyncChange(it.id, it.changeNumber) }
    }

    override suspend fun find(id: String): SyncRecord? =
        database.items().find(id)?.let(::syncRecordOf) ?: database.attachments().find(id)?.let(::syncRecordOf)

    override fun read(dataVersion: Int, entry: BackupRecord): SyncRecord? = when (entry.type) {
        ITEM -> readItem(dataVersion, entry)?.let(::syncRecordOf)
        ATTACHMENT -> readAttachment(entry)?.let(::syncRecordOf)
        else -> null
    }

    override suspend fun take(record: SyncRecord, tie: (stored: SyncRecord, came: SyncRecord) -> Int): SyncTaken = when (record.entry.type) {
        ITEM -> items.takeFromSync(readItem(this.dataVersion, record.entry)!!) { s, c -> tie(syncRecordOf(s), syncRecordOf(c)) }
        else -> attachments.takeFromSync(readAttachment(record.entry)!!) { s, c -> tie(syncRecordOf(s), syncRecordOf(c)) }
    }

    override fun fileKeysOnlyOnThisPhone(): Boolean = fileKeysOnlyHere

    override fun hasStream(fileId: String, length: Long): Boolean = streamFile(fileId).let { it.isFile && it.length() == length }

    override fun openStream(fileId: String): InputStream = FileInputStream(streamFile(fileId))

    override suspend fun moveStreamIn(fileId: String, fetched: File) {
        streams.mkdirs()
        check(fetched.renameTo(streamFile(fileId))) { "The stream did not move in" }
    }

    override suspend fun removeStream(fileId: String) {
        streamFile(fileId).delete()
    }

    override suspend fun afterImport() {
        afterImports++
    }

    override suspend fun sealFileKeysAgain() {
        if (stopNextSeal) {
            stopNextSeal = false
            throw IllegalStateException("The app stopped here")
        }
        val current = currentKeyId().value
        database.attachments().all().filter { it.keyId != null && it.keyId != current }.forEach { stored ->
            attachments.sealFileKeyAgain(stored.record.id) { it.copy(keyId = current, keyBytes = it.keyBytes + "r") }
        }
    }

    /** The stored stream of the file [fileId]. */
    fun streamFile(fileId: String): File = File(streams, fileId)

    /** The record as sync sees it. */
    fun syncRecordOf(item: ItemEntity): SyncRecord = SyncRecord(
        entry = BackupRecord(ITEM, item.record, itemContent(item, dataVersion)),
        wiped = item.record.isDeleted && item.title.isEmpty(),
        changeNumber = item.changeNumber,
    )

    /** The record as sync sees it. */
    fun syncRecordOf(attachment: AttachmentEntity): SyncRecord {
        val wiped = attachment.record.isDeleted && attachment.keyId == null
        return SyncRecord(
            entry = BackupRecord(ATTACHMENT, attachment.record, attachmentContent(attachment)),
            isFile = true,
            streamLength = if (wiped) null else attachment.size,
            wrappedKeyId = attachment.keyId?.let(::KeyId),
            wiped = wiped,
            changeNumber = attachment.changeNumber,
        )
    }

    private fun readItem(version: Int, entry: BackupRecord): ItemEntity? {
        val bytes = entry.content
        val (pinned, titleBytes) = when (version) {
            1 -> false to bytes
            2 -> {
                if (bytes.isEmpty() || bytes[0] > 1 || bytes[0] < 0) return null
                (bytes[0].toInt() == 1) to bytes.copyOfRange(1, bytes.size)
            }
            else -> return null
        }
        val title = strictText(titleBytes) ?: return null
        // A live item has a title. Only a deleted one may be wiped, and a wiped one has no pin.
        if (title.isEmpty() && (!entry.fields.isDeleted || pinned)) return null
        return ItemEntity(entry.fields, changeNumber = 0, title = title, pinned = pinned)
    }

    private fun readAttachment(entry: BackupRecord): AttachmentEntity? {
        val buffer = ByteBuffer.wrap(entry.content)
        if (buffer.remaining() < 8 + 1 + 4 + 2) return null
        val size = buffer.long
        val hasKey = buffer.get().toInt()
        val keyId = buffer.int
        val keyLength = buffer.short.toInt()
        if (size < 0 || hasKey !in 0..1 || keyLength < 0 || buffer.remaining() < keyLength) return null
        val keyBytes = strictText(ByteArray(keyLength).also { buffer.get(it) }) ?: return null
        val name = strictText(ByteArray(buffer.remaining()).also { buffer.get(it) }) ?: return null
        if (hasKey == 0 && (!entry.fields.isDeleted || size != 0L || keyBytes.isNotEmpty() || name.isNotEmpty())) return null
        return AttachmentEntity(entry.fields, changeNumber = 0, name = name, size = size, keyId = if (hasKey == 1) keyId else null, keyBytes = keyBytes)
    }

    private fun strictText(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }

    /** The two kinds of record, and how Lists writes them. */
    companion object {
        const val ITEM = "item"
        const val ATTACHMENT = "attachment"

        fun itemContent(item: ItemEntity, version: Int): ByteArray {
            val title = item.title.toByteArray()
            return if (version >= 2) byteArrayOf(if (item.pinned) 1 else 0) + title else title
        }

        fun attachmentContent(attachment: AttachmentEntity): ByteArray {
            val key = attachment.keyBytes.toByteArray()
            val name = attachment.name.toByteArray()
            return ByteBuffer.allocate(8 + 1 + 4 + 2 + key.size + name.size)
                .putLong(attachment.size)
                .put(if (attachment.keyId == null) 0 else 1)
                .putInt(attachment.keyId ?: 0)
                .putShort(key.size.toShort())
                .put(key)
                .put(name)
                .array()
        }
    }
}
