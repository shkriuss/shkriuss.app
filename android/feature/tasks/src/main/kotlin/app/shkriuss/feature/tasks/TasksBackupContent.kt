package app.shkriuss.feature.tasks

import androidx.room3.withReadTransaction
import androidx.room3.withWriteTransaction
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.data.BackupTake
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.timesAreWithinLimits
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.UUID

/**
 * Tasks' records in a backup and out of one (docs/apps/tasks/spec.md,
 * "Backup contents"). Data version 1: two record types, `task_list` and
 * `task`, named after their tables, and no files.
 *
 * Writing lists every list and every task, deleted ones too, each once, as
 * one snapshot. Reading takes them in one write transaction through
 * `RecordWriter.takeFromBackup`, and stops with
 * [UnreadableBackupException] at the first thing this version cannot
 * read. Then the transaction rolls back and nothing changes.
 *
 * The phone-only entries are no part of it. After a restore, each task it
 * took counts from that moment (spec, "Backup contents", point 3): once
 * the transaction is written, [afterRestore] gets the `id` of every task
 * it took, and `TasksRepository.afterRestore` does the rest. A record the
 * phone has with the same `updatedAt`, or a later one, is not taken, so it
 * stays as it is.
 */
class TasksBackupContent(
    private val database: TasksDatabase,
    clock: Clock,
    ids: IdSource,
    private val afterRestore: suspend (taken: List<String>) -> Unit = {},
) : BackupContent {
    // takeFromBackup keeps the record fields it is given; the clock and the ID source are never used for it.
    private val lists = RecordWriter(database, database.lists(), clock, ids)
    private val tasks = RecordWriter(database, database.tasks(), clock, ids)

    override val dataVersion: Int = DATA_VERSION

    override suspend fun list(into: BackupSink) {
        // One snapshot: every row is read in one read transaction, and only then given to the backup.
        val records = database.withReadTransaction {
            database.lists().all().map(TasksBackupCodec::encode) + database.tasks().all().map(TasksBackupCodec::encode)
        }
        records.forEach { into.record(it) }
        // Tasks stores no files, so it leaves none out. filesLeftOut(0) adds nothing to the count.
        into.filesLeftOut(0)
    }

    override suspend fun restore(from: CheckedBackup) {
        if (from.dataVersion != DATA_VERSION) throw UnreadableBackupException("data version ${from.dataVersion}")
        if (from.fileCount != 0L) throw UnreadableBackupException("the backup holds files")
        val taken = mutableListOf<String>()
        val seen = mapOf(TaskListEntity.TABLE to mutableSetOf<String>(), TaskEntity.TABLE to mutableSetOf())
        database.withWriteTransaction {
            from.forEachRecord { record ->
                // Tasks writes each record once. Of two with one ID in one type only one would stay, though the question counted both.
                val ofItsType = seen[record.type] ?: throw UnreadableBackupException("a record of the type ${record.type}")
                if (!ofItsType.add(record.fields.id)) throw UnreadableBackupException("a record ID is there twice")
                when (record.type) {
                    TaskListEntity.TABLE -> lists.takeFromBackup(TasksBackupCodec.decodeList(record))
                    else -> {
                        val task = TasksBackupCodec.decodeTask(record)
                        if (tasks.takeFromBackup(task) == BackupTake.TAKEN) taken += task.record.id
                    }
                }
            }
            from.forEachFile { throw UnreadableBackupException("the backup holds files") }
        }
        afterRestore(taken)
    }

    /** Tasks' data version. */
    companion object {
        /** The data version Tasks writes and reads. */
        const val DATA_VERSION: Int = 1
    }
}

/**
 * Thrown by [TasksBackupContent.restore] when a backup holds something
 * this version of Tasks cannot read: another record type, a content of
 * another length, a name or title that is not UTF-8 or breaks its limits,
 * a value or a record time outside its limits, a record ID that is there
 * twice in one type, or a file. It is the third failure of
 * docs/architecture/backup-format.md, "The answers". The message names
 * what was wrong, never what a record holds.
 */
class UnreadableBackupException(reason: String) : Exception("Tasks cannot read this backup: $reason")

/**
 * The content of the two record types, as docs/apps/tasks/spec.md,
 * "Backup contents", fixes it. Numbers are big-endian. The four record
 * fields travel in the container.
 *
 * `task_list`, 2 + n bytes:
 *
 * | Offset | Size | Content |
 * |---|---|---|
 * | 0 | 2 | n, the name's length in bytes, unsigned, 1 to 240 |
 * | 2 | n | The name, in UTF-8 |
 *
 * `task`, 40 + n bytes:
 *
 * | Offset | Size | Content |
 * |---|---|---|
 * | 0 | 16 | `listId`: the 16 bytes of the list's ID, or 16 zero bytes for Inbox |
 * | 16 | 1 | `repeat`, 0 to 4 |
 * | 17 | 1 | `weekdays`, 0, or 1 to 127 for every week |
 * | 18 | 4 | `dueDay`, int32, -1 for none |
 * | 22 | 4 | `repeatFrom`, int32, -1 for none |
 * | 26 | 4 | `remindMinute`, int32, -1 for none |
 * | 30 | 8 | `doneAt`, int64, -1 for none |
 * | 38 | 2 | n, the title's length in bytes, unsigned, 1 to 800 |
 * | 40 | n | The title, in UTF-8 |
 */
object TasksBackupCodec {
    /** The length of a list's content before its name. */
    const val LIST_FIXED_LENGTH: Int = 2

    /** The length of a task's content before its title. */
    const val TASK_FIXED_LENGTH: Int = 40

    /** The most bytes a list's name takes: 60 code points of 4 bytes. */
    const val MOST_NAME_BYTES: Int = 240

    /** The most bytes a title takes: 200 code points of 4 bytes. */
    const val MOST_TITLE_BYTES: Int = 800

    /** The length of an ID in the content. */
    private const val ID_BYTES = 16

    /** What stands for "none" in a number of the content. */
    private const val NONE = -1

    /** A list as a backup record. */
    fun encode(row: TaskListEntity): BackupRecord {
        val name = row.name.toByteArray(Charsets.UTF_8)
        return BackupRecord(
            TaskListEntity.TABLE,
            row.record,
            ByteBuffer.allocate(LIST_FIXED_LENGTH + name.size).putShort(name.size.toShort()).put(name).array(),
        )
    }

    /** A task as a backup record. */
    fun encode(row: TaskEntity): BackupRecord {
        val title = row.title.toByteArray(Charsets.UTF_8)
        return BackupRecord(
            TaskEntity.TABLE,
            row.record,
            ByteBuffer.allocate(TASK_FIXED_LENGTH + title.size)
                .put(listIdBytes(row.listId))
                .put(row.repeat.toByte())
                .put(row.weekdays.toByte())
                .putInt(row.dueDay ?: NONE)
                .putInt(row.repeatFrom ?: NONE)
                .putInt(row.remindMinute ?: NONE)
                .putLong(row.doneAt ?: NONE.toLong())
                .putShort(title.size.toShort())
                .put(title)
                .array(),
        )
    }

    /**
     * The list a `task_list` record holds, with the record fields of the
     * backup and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length, a name
     * outside its limits, or a `createdAt`, `updatedAt` or `deletedAt` that
     * no record can hold.
     */
    fun decodeList(record: BackupRecord): TaskListEntity {
        if (record.type != TaskListEntity.TABLE) throw UnreadableBackupException("a record of the type ${record.type}")
        val bytes = record.content
        if (bytes.size < LIST_FIXED_LENGTH) throw lengthProblem(TaskListEntity.TABLE, bytes.size)
        val nameLength = ByteBuffer.wrap(bytes).short.toInt() and SHORT_MASK
        if (bytes.size != LIST_FIXED_LENGTH + nameLength) throw lengthProblem(TaskListEntity.TABLE, bytes.size)
        val name = utf8(bytes.copyOfRange(LIST_FIXED_LENGTH, bytes.size))
        within(nameLength in 1..MOST_NAME_BYTES && name != null, TaskListEntity.TABLE, "name")
        val row = TaskListEntity(record.fields, NO_CHANGE_NUMBER, name = checkNotNull(name))
        within(TaskRules.isStored(row), TaskListEntity.TABLE, "name")
        within(record.fields.timesAreWithinLimits, TaskListEntity.TABLE, "createdAt, updatedAt or deletedAt")
        return row
    }

    /**
     * The task a `task` record holds, with the record fields of the backup
     * and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length, a
     * title or a value outside its limits, the rules that join two values
     * included (`TaskRules.isStored`), or a `createdAt`, `updatedAt` or
     * `deletedAt` that no record can hold.
     */
    fun decodeTask(record: BackupRecord): TaskEntity {
        if (record.type != TaskEntity.TABLE) throw UnreadableBackupException("a record of the type ${record.type}")
        val bytes = record.content
        if (bytes.size < TASK_FIXED_LENGTH) throw lengthProblem(TaskEntity.TABLE, bytes.size)
        val content = ByteBuffer.wrap(bytes)
        val listId = ByteArray(ID_BYTES).also { content.get(it) }
        val repeat = content.get().toInt() and BYTE_MASK
        val weekdays = content.get().toInt() and BYTE_MASK
        val dueDay = content.int
        val repeatFrom = content.int
        val remindMinute = content.int
        val doneAt = content.long
        val titleLength = content.short.toInt() and SHORT_MASK
        if (bytes.size != TASK_FIXED_LENGTH + titleLength) throw lengthProblem(TaskEntity.TABLE, bytes.size)
        val title = utf8(bytes.copyOfRange(TASK_FIXED_LENGTH, bytes.size))
        within(titleLength in 1..MOST_TITLE_BYTES && title != null, TaskEntity.TABLE, "title")
        // -1 is "none". Any other negative number is outside the limits, and TaskRules refuses it.
        val row = TaskEntity(
            record.fields,
            NO_CHANGE_NUMBER,
            listId = listIdOf(listId),
            title = checkNotNull(title),
            dueDay = dueDay.takeUnless { it == NONE },
            repeat = repeat,
            weekdays = weekdays,
            repeatFrom = repeatFrom.takeUnless { it == NONE },
            remindMinute = remindMinute.takeUnless { it == NONE },
            doneAt = doneAt.takeUnless { it == NONE.toLong() },
        )
        within(TaskRules.isStored(row), TaskEntity.TABLE, "title, listId, due day, repeat, days, repeatFrom, remindMinute or doneAt")
        within(record.fields.timesAreWithinLimits, TaskEntity.TABLE, "createdAt, updatedAt or deletedAt")
        return row
    }

    /**
     * The 16 bytes of the list [listId] in a task's content: those of its
     * UUID, in the order of its 32 hex digits, as the container writes an
     * ID (docs/architecture/backup-format.md, "Record"), or 16 zero bytes
     * for Inbox. A stored `listId` is Inbox or a version 4 UUID.
     */
    private fun listIdBytes(listId: String): ByteArray {
        if (listId == INBOX) return ByteArray(ID_BYTES)
        val uuid = UUID.fromString(listId)
        return ByteBuffer.allocate(ID_BYTES).putLong(uuid.mostSignificantBits).putLong(uuid.leastSignificantBits).array()
    }

    /** The `listId` of the 16 bytes [bytes]: Inbox for 16 zero bytes, else the UUID in its 36-character form, in lower case. */
    private fun listIdOf(bytes: ByteArray): String {
        if (bytes.all { it == 0.toByte() }) return INBOX
        val buffer = ByteBuffer.wrap(bytes)
        return UUID(buffer.long, buffer.long).toString()
    }

    /** [bytes] as UTF-8, or null if they are not UTF-8. */
    private fun utf8(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }

    private fun lengthProblem(type: String, size: Int): UnreadableBackupException {
        val fixed = if (type == TaskListEntity.TABLE) LIST_FIXED_LENGTH else TASK_FIXED_LENGTH
        return UnreadableBackupException("a $type record of $size bytes, not $fixed and its text")
    }

    private fun within(ok: Boolean, type: String, what: String) {
        if (!ok) throw UnreadableBackupException("a $type record whose $what is outside its limits")
    }

    private const val BYTE_MASK = 0xff
    private const val SHORT_MASK = 0xffff

    /** `takeFromBackup` ignores the change number that comes with a record. */
    private const val NO_CHANGE_NUMBER = 0L
}
