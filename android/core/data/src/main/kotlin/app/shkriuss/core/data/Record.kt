package app.shkriuss.core.data

/**
 * The four fields every stored record has (ADR 0004, ADR 0027,
 * docs/architecture/data.md). An entity embeds them with `@Embedded`, so
 * its table has the columns `id`, `createdAt`, `updatedAt` and `deletedAt`.
 * They travel with the record: into a backup, and later through sync.
 *
 * Only [RecordWriter] sets them. Times are in milliseconds since
 * 1970-01-01T00:00:00Z, from a [Clock].
 */
data class RecordFields(
    /** A random UUID from an [IdSource]. Never changes. */
    val id: String,
    /** When the record was created. Never changes. */
    val createdAt: Long,
    /** When the record last changed, deletion included. Only moves forward. */
    val updatedAt: Long,
    /** When the record was deleted, or null while it is not. */
    val deletedAt: Long?,
)

/** True once the record is deleted. A deleted record stays stored, marked. */
val RecordFields.isDeleted: Boolean
    get() = deletedAt != null

/**
 * A stored record: a Room entity that embeds [RecordFields] and has a
 * [changeNumber].
 *
 * An entity implements it like this:
 * ```
 * @Entity(
 *     tableName = "note",
 *     primaryKeys = ["id"],
 *     indices = [Index("changeNumber", unique = true)],
 * )
 * data class NoteEntity(
 *     @Embedded override val record: RecordFields,
 *     override val changeNumber: Long,
 *     val title: String,
 * ) : Record<NoteEntity> {
 *     override fun withRecord(record: RecordFields, changeNumber: Long) =
 *         copy(record = record, changeNumber = changeNumber)
 * }
 * ```
 * The database lists [ChangeCounter] among its entities too.
 */
interface Record<T : Record<T>> {
    /** The ID and the timestamps. */
    val record: RecordFields

    /**
     * The record's place in the order of changes of its database, from
     * [ChangeCounter]. [RecordWriter] gives every write a new, higher one.
     * It is local: never part of a backup or of what sync sends. A record
     * restored from a backup, or received by sync, gets a new one when it
     * is written.
     */
    val changeNumber: Long

    /** A copy of this record with other [RecordFields] and change number, used by [RecordWriter]. */
    fun withRecord(record: RecordFields, changeNumber: Long): T
}
