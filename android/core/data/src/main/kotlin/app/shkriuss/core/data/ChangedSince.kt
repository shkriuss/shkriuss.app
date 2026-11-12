package app.shkriuss.core.data

/**
 * SQL that every record table's DAO shares. Room needs the table name
 * written out in each query, so the parts that stay the same live here.
 */
object RecordSql {
    /**
     * The end of a "changed since" query, after `WHERE`. A DAO writes
     * `@Query("SELECT * FROM <table> WHERE " + RecordSql.CHANGED_SINCE)`.
     *
     * - It finds every record changed after a [ChangeCursor], deleted
     *   records included, oldest change first.
     * - Records with the same `updatedAt` are ordered by `id`, so paging
     *   never skips or repeats one.
     * - The first condition lets SQLite read the `(updatedAt, id)` index
     *   from the cursor on. The order then needs no sorting.
     */
    const val CHANGED_SINCE =
        "updatedAt >= :afterUpdatedAt " +
            "AND (updatedAt > :afterUpdatedAt OR id > :afterId) " +
            "ORDER BY updatedAt, id LIMIT :limit"
}

/**
 * A position in the order of changes: records sorted by `updatedAt`, then
 * by `id`. [RecordDao.changedSince] returns the records after a position.
 *
 * To read all changes in pages, start at [Start], and continue from the
 * cursor of the last record of each page ([of]). A record that changes
 * again moves to the end of the order, so it is read again later, with its
 * newest content.
 */
data class ChangeCursor(
    /** The `updatedAt` of the position. */
    val updatedAt: Long,
    /** The `id` of the position, which orders records with the same `updatedAt`. */
    val id: String,
) {
    /** The cursors that do not come from a record. */
    companion object {
        /** Before every record. */
        val Start: ChangeCursor = ChangeCursor(updatedAt = Long.MIN_VALUE, id = "")

        /** The position of [record], so the next page starts after it. */
        fun of(record: RecordFields): ChangeCursor = ChangeCursor(record.updatedAt, record.id)
    }
}

/**
 * Up to [limit] records that changed after [cursor], deleted ones
 * included, oldest change first.
 */
suspend fun <T : Record<T>> RecordDao<T>.changedSince(cursor: ChangeCursor, limit: Int): List<T> {
    require(limit > 0) { "limit must be at least 1" }
    return changedSince(cursor.updatedAt, cursor.id, limit)
}
