package app.shkriuss.buildlogic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shows that the DAO rules check ([CheckDaoRulesTask]) reads the comments
 * and the quoted text of a query in one pass, as SQLite does. A comment
 * marker inside quotes is text, and a quote inside a comment is comment.
 * So neither can hide the rest of a query from the purge rule, and a
 * purge that only removes deleted rows still passes.
 *
 * The annotations are written out here, not taken from the check.
 */
class DaoRulesSqlTest {
    private val query = "Landroidx/room3/Query;"
    private val purgeMarker = "Lapp/shkriuss/core/data/PurgesDeletedRecords;"

    /** The problems of one DAO with one function, `purge`, with [sql] as its query, marked as a purge or not. */
    private fun problems(sql: String, marked: Boolean = true): List<String> {
        val annotations = listOf(ClassFileReader.Annotation(query, mapOf("value" to sql))) +
            if (marked) listOf(ClassFileReader.Annotation(purgeMarker, emptyMap())) else emptyList()
        val dao = ClassFileReader.ClassAnnotations(
            name = "app.shkriuss.feature.sample.IntakeDao",
            methods = listOf(ClassFileReader.MethodAnnotations("purge", annotations)),
            calls = emptyList(),
        )
        return CheckDaoRulesTask.daoRuleProblems(dao)
    }

    private fun assertNotAPurge(sql: String) {
        val problems = problems(sql)
        assertEquals(sql, 1, problems.size)
        assertTrue(problems.single(), "IntakeDao.purge is marked @PurgesDeletedRecords, but is not" in problems.single())
    }

    @Test
    fun dashesInSingleQuotesDoNotHideAnOr() =
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND '--' = '--' OR 1=1")

    @Test
    fun dashesInQuotedNamesDoNotHideAnOr() {
        assertNotAPurge("""DELETE FROM intake WHERE deletedAt IS NOT NULL AND "--" = "--" OR 1=1""")
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND `--` = `--` OR 1=1")
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND [--] = [--] OR 1=1")
    }

    @Test
    fun aBlockCommentStartInQuotesDoesNotHideAnOr() {
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND '/*' = '/*' OR 1=1 OR '*/' = '*/'")
        assertNotAPurge("""DELETE FROM intake WHERE deletedAt IS NOT NULL AND "/*" = "/*" OR 1=1 OR "*/" = "*/"""")
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND [/*] = 1 OR 1=1 OR [*/] = 1")
    }

    @Test
    fun aQuoteInsideACommentIsComment() {
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL /* it's */ OR 1=1 /* ' */")
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL -- don't\nOR 1=1 -- '")
    }

    @Test
    fun anEscapedQuoteDoesNotEndTheText() {
        assertNotAPurge("DELETE FROM intake WHERE deletedAt IS NOT NULL AND note = 'it''s -- ' OR 1=1")
        assertNotAPurge("""DELETE FROM intake WHERE deletedAt IS NOT NULL AND "a""--" = 1 OR 1=1""")
    }

    @Test
    fun aWritingQueryBehindQuotedDashesIsFound() {
        val problems = problems("WITH a AS (SELECT '--') DELETE FROM intake", marked = false)
        assertEquals(problems.toString(), 1, problems.size)
        assertTrue(problems.single(), "runs a writing query" in problems.single())
    }

    @Test
    fun aPurgeOfDeletedRowsPasses() {
        listOf(
            "DELETE FROM intake WHERE deletedAt IS NOT NULL",
            "DELETE FROM intake WHERE deletedAt IS NOT NULL;",
            """DELETE FROM "intake" WHERE [deletedAt] IS NOT NULL AND updatedAt < :before""",
            "DELETE FROM `intake` WHERE `deletedAt` IS NOT NULL AND note <> '-- or /* OR */'",
            "-- old rows\nDELETE FROM intake /* every table */ WHERE deletedAt IS NOT NULL AND deletedAt < :before -- or not",
        ).forEach { sql -> assertEquals(sql, emptyList<String>(), problems(sql)) }
    }

    @Test
    fun aReadWithWritingWordsInATextOrACommentPasses() =
        assertEquals(
            emptyList<String>(),
            problems("SELECT * FROM intake WHERE note <> 'update, delete, insert' -- or replace into\n AND deletedAt IS NULL", marked = false),
        )

    @Test
    fun theSqlIsReadInOnePass() {
        assertEquals(
            """SELECT '' AS a, "/*" AS b, [--] AS c FROM t WHERE x = 1""",
            CheckDaoRulesTask.plainSql("SELECT 'it''s -- no' AS a, \"/*\" AS b, [--] AS c -- c\nFROM t /* d ' */ WHERE x = 1;"),
        )
        assertEquals("SELECT 1", CheckDaoRulesTask.plainSql("SELECT 1 /* to the end"))
        assertEquals("SELECT 'never ends -- OR 1=1", CheckDaoRulesTask.plainSql("SELECT 'never ends -- OR 1=1"))
    }
}
