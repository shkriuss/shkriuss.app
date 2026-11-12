package app.shkriuss.core.testing

import androidx.sqlite.SQLiteConnection
import app.shkriuss.core.data.ChangeCounter

/**
 * What is wrong with the shape of a database, measured against the record
 * conventions in docs/architecture/data.md. An empty list means it follows
 * them:
 *
 * - The database has the `change_counter` table: `id INTEGER` as its
 *   primary key and `lastNumber INTEGER NOT NULL`.
 * - In every other table, `id` is `TEXT NOT NULL` and the only primary key
 *   column; `createdAt`, `updatedAt` and `changeNumber` are
 *   `INTEGER NOT NULL`; `deletedAt` is `INTEGER` and may be null.
 * - Every such table has a unique index on `changeNumber` alone, which
 *   serves the "changed since" query.
 *
 * Room's and SQLite's own tables are skipped, and so are [exceptTables].
 */
fun recordConventionProblems(connection: SQLiteConnection, exceptTables: Set<String> = emptySet()): List<String> {
    val tables = tableNames(connection)
    val counterProblems = if (ChangeCounter.TABLE in tables) {
        counterTableProblems(connection)
    } else {
        listOf("the database has no ${ChangeCounter.TABLE} table")
    }
    return counterProblems + recordTables(tables, exceptTables).flatMap { table ->
        columnProblems(connection, table, RECORD_COLUMNS, primaryKey = listOf("id")) + indexProblems(connection, table)
    }
}

/**
 * What is wrong with the change numbers stored in a database. An empty
 * list means every record has a change number from 1 up to the counter,
 * and no two records share one, in any table. Use it after a migration
 * test has moved rows, and in tests that write records.
 */
fun changeNumberProblems(connection: SQLiteConnection, exceptTables: Set<String> = emptySet()): List<String> {
    val counter = connection.prepare(ChangeCounter.READ_SQL).use { if (it.step()) it.getLong(0) else 0L }
    val owners = mutableMapOf<Long, String>()
    val problems = mutableListOf<String>()
    for (table in recordTables(tableNames(connection), exceptTables)) {
        connection.prepare("SELECT id, changeNumber FROM ${quoted(table)}").use { statement ->
            while (statement.step()) {
                val record = "$table ${statement.getText(0)}"
                val number = statement.getLong(1)
                if (number < 1 || number > counter) problems += "$record has change number $number, outside 1 to $counter"
                owners.put(number, record)?.let { other -> problems += "$record and $other share change number $number" }
            }
        }
    }
    return problems
}

private data class Column(val name: String, val type: String, val notNull: Boolean, val primaryKeyPosition: Int)

private data class ExpectedColumn(val name: String, val type: String, val notNull: Boolean)

private val RECORD_COLUMNS = listOf(
    ExpectedColumn("id", "TEXT", notNull = true),
    ExpectedColumn("createdAt", "INTEGER", notNull = true),
    ExpectedColumn("updatedAt", "INTEGER", notNull = true),
    ExpectedColumn("deletedAt", "INTEGER", notNull = false),
    ExpectedColumn("changeNumber", "INTEGER", notNull = true),
)

private val COUNTER_COLUMNS = listOf(
    ExpectedColumn("id", "INTEGER", notNull = true),
    ExpectedColumn("lastNumber", "INTEGER", notNull = true),
)

private val INTERNAL_TABLES = setOf("room_master_table", "android_metadata", ChangeCounter.TABLE)

private const val SQLITE_PREFIX = "sqlite_"

private fun recordTables(tables: List<String>, exceptTables: Set<String>): List<String> =
    tables.filterNot { it in exceptTables || it in INTERNAL_TABLES || it.startsWith(SQLITE_PREFIX) }

private fun tableNames(connection: SQLiteConnection): List<String> =
    connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").use { statement ->
        buildList { while (statement.step()) add(statement.getText(0)) }
    }

private fun counterTableProblems(connection: SQLiteConnection): List<String> =
    columnProblems(connection, ChangeCounter.TABLE, COUNTER_COLUMNS, primaryKey = listOf("id"))

/** Compares a table's columns and primary key with [expected] and [primaryKey]. */
private fun columnProblems(
    connection: SQLiteConnection,
    table: String,
    expected: List<ExpectedColumn>,
    primaryKey: List<String>,
): List<String> {
    val columns = connection.prepare("PRAGMA table_info(${quoted(table)})").use { statement ->
        buildMap {
            while (statement.step()) {
                val column = Column(
                    name = statement.getText(1),
                    type = statement.getText(2),
                    notNull = statement.getLong(3) != 0L,
                    primaryKeyPosition = statement.getLong(5).toInt(),
                )
                put(column.name, column)
            }
        }
    }
    val problems = expected.mapNotNull { want ->
        val column = columns[want.name]
        when {
            column == null -> "$table has no column ${want.name}"
            !column.type.equals(want.type, ignoreCase = true) -> "$table.${want.name} is ${column.type}, not ${want.type}"
            column.notNull != want.notNull ->
                "$table.${want.name} must ${if (want.notNull) "be NOT NULL" else "allow null"}"
            else -> null
        }
    }
    val actualKey = columns.values.filter { it.primaryKeyPosition > 0 }.sortedBy { it.primaryKeyPosition }.map { it.name }
    return if (actualKey == primaryKey) problems else problems + "$table has the primary key $actualKey, not $primaryKey"
}

private fun indexProblems(connection: SQLiteConnection, table: String): List<String> {
    val uniqueIndexes = connection.prepare("PRAGMA index_list(${quoted(table)})").use { statement ->
        buildList {
            while (statement.step()) {
                val unique = statement.getLong(2) != 0L
                val partial = statement.getLong(4) != 0L
                if (unique && !partial) add(statement.getText(1))
            }
        }
    }
    val hasChangeIndex = uniqueIndexes.any { index -> indexColumns(connection, index) == listOf("changeNumber") }
    return if (hasChangeIndex) emptyList() else listOf("$table has no unique index on changeNumber")
}

private fun indexColumns(connection: SQLiteConnection, index: String): List<String> =
    connection.prepare("PRAGMA index_info(${quoted(index)})").use { statement ->
        buildList { while (statement.step()) add(statement.getText(2)) }
    }

/** An SQL identifier in double quotes, safe for any table or index name. */
private fun quoted(name: String): String = "\"" + name.replace("\"", "\"\"") + "\""
