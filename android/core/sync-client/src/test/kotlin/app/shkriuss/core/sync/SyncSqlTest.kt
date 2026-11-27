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
        val writes = statements.filterValues { WRITE_WORD.containsMatchIn(it) }
        assertTrue("there are writes to check", writes.size > 10)
        writes.forEach { (name, sql) ->
            val tables = tablesWritten(sql)
            assertTrue("$name: $sql", tables.isNotEmpty() && tables.all { it.startsWith("sync_") })
        }
    }

    @Test
    fun theCheckSeesEveryFormOfAWrite() {
        val forms = listOf(
            "INSERT INTO items (id) VALUES (?)",
            "INSERT OR IGNORE INTO items (id) VALUES (?)",
            "INSERT OR REPLACE INTO items (id) VALUES (?)",
            "insert or abort into items (id) values (?)",
            "REPLACE INTO items (id) VALUES (?)",
            "UPDATE items SET title = ?",
            "UPDATE OR FAIL items SET title = ?",
            "DELETE FROM items WHERE id = ?",
        )
        forms.forEach { sql -> assertEquals(sql, listOf("items"), tablesWritten(sql)) }
        assertEquals(
            listOf("sync_send"),
            tablesWritten("INSERT INTO sync_send (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind"),
        )
    }

    @Test
    fun theOnlyOtherTableItReadsIsTheChangeCounter() {
        val read = statements.values.flatMap { sql -> FROM.findAll(sql).map { it.groupValues[1] } }.toSet()
        assertEquals(setOf("change_counter"), read.filterNot { it.startsWith("sync_") }.toSet())
    }

    /** The tables that [sql] writes. Fails if a word that writes is in a form the check does not read. */
    private fun tablesWritten(sql: String): List<String> {
        val tables = WRITE.findAll(sql).map { it.groupValues[2] }.toList()
        assertEquals("every write in: $sql", WRITE_WORD.findAll(sql).count(), tables.size)
        return tables
    }

    private companion object {
        /**
         * A write and its table, with or without a conflict clause such as
         * `OR IGNORE`. The `DO UPDATE SET` of an upsert names no table of
         * its own.
         */
        val WRITE = Regex(
            """\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|(?<!DO\s)UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+(\w+)""",
            RegexOption.IGNORE_CASE,
        )

        /** Each word that starts a write. The `REPLACE` of `INSERT OR REPLACE` is part of its `INSERT`. */
        val WRITE_WORD = Regex("""\b(INSERT|(?<!OR\s)REPLACE|(?<!DO\s)UPDATE|DELETE)\b""", RegexOption.IGNORE_CASE)
        val FROM = Regex("""\bFROM\s+(\w+)""", RegexOption.IGNORE_CASE)
    }
}
