package app.shkriuss.core.data

/**
 * The four fields every stored record has (ADR 0004,
 * docs/architecture/data.md). An entity embeds them with `@Embedded`, so
 * its table has the columns `id`, `createdAt`, `updatedAt` and `deletedAt`.
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
 * A stored record: a Room entity that embeds [RecordFields].
 *
 * An entity implements it like this:
 * ```
 * @Entity(
 *     tableName = "note",
 *     primaryKeys = ["id"],
 *     indices = [Index("updatedAt", "id")],
 * )
 * data class NoteEntity(
 *     @Embedded override val record: RecordFields,
 *     val title: String,
 * ) : Record<NoteEntity> {
 *     override fun withRecord(record: RecordFields) = copy(record = record)
 * }
 * ```
 * The index serves the "changed since" query of [RecordDao.changedSince].
 */
interface Record<T : Record<T>> {
    /** The ID and the timestamps. */
    val record: RecordFields

    /** A copy of this record with other [RecordFields], used by [RecordWriter]. */
    fun withRecord(record: RecordFields): T
}
