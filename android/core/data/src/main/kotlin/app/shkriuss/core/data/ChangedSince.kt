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
     * - It finds every record whose change number is above
     *   `:afterChangeNumber`, deleted records included, oldest change
     *   first, at most `:limit` of them.
     * - Change numbers are unique, so paging never skips or repeats a
     *   record. They do not depend on the clock.
     * - The unique index on `changeNumber` serves it. The order then needs
     *   no sorting.
     */
    const val CHANGED_SINCE: String =
        "changeNumber > :afterChangeNumber ORDER BY changeNumber LIMIT :limit"
}

/**
 * The change number before every change. Change numbers start at 1. To
 * read every change, start here.
 */
const val BEFORE_FIRST_CHANGE: Long = 0L
