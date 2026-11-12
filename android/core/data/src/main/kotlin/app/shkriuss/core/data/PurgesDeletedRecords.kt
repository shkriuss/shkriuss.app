package app.shkriuss.core.data

/**
 * Marks the one DAO query that may remove deleted records for good: the
 * purge of deletion markers, once the sync design says when that is safe
 * (ADR 0009, Phase 5). Nothing uses it yet.
 *
 * `checkDaoRules` lets a marked query pass only if:
 * - it is a `@Query` of the form
 *   `DELETE FROM <table> WHERE deletedAt IS NOT NULL`, optionally followed
 *   by `AND` and more conditions, with no `OR`,
 * - it is the only marked function in its DAO.
 *
 * A purge never touches [ChangeCounter], so a purged record's change
 * number is never handed out again.
 */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.BINARY)
annotation class PurgesDeletedRecords
