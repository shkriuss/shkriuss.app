package app.shkriuss.core.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sync writes only its own tables (docs/architecture/data.md, "Rules for
 * DAOs", point 5): every statement of [SyncSql] that writes names a table
 * whose name starts with `sync_`. It reads the change counter, and writes
 * no other table.
 */
class SyncSqlTest {
    private val statements: Map<String, String> = SyncSql::class.java.declaredFields
        .filter { it.type == String::class.java && java.lang.reflect.Modifier.isStatic(it.modifiers) }
        .associate { field -> field.name to (field.apply { isAccessible = true }.get(null) as String) }

    @Test
    fun everyWriteNamesASyncTable() {
        val writes = statements.filterValues { WRITE.containsMatchIn(it) }
        assertTrue("there are writes to check", writes.size > 10)
        writes.forEach { (name, sql) ->
            val tables = WRITE.findAll(sql).map { it.groupValues[2] }.toList()
            assertTrue("$name: $sql", tables.isNotEmpty() && tables.all { it.startsWith("sync_") })
        }
    }

    @Test
    fun theOnlyOtherTableItReadsIsTheChangeCounter() {
        val read = statements.values.flatMap { sql -> FROM.findAll(sql).map { it.groupValues[1] } }.toSet()
        assertEquals(setOf("change_counter"), read.filterNot { it.startsWith("sync_") }.toSet())
    }

    private companion object {
        /** A write and its table. The `DO UPDATE SET` of an upsert names no table of its own. */
        val WRITE = Regex("""\b(INSERT\s+INTO|(?<!DO\s)UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(\w+)""", RegexOption.IGNORE_CASE)
        val FROM = Regex("""\bFROM\s+(\w+)""", RegexOption.IGNORE_CASE)
    }
}
