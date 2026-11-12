package app.shkriuss.core.testing

import androidx.sqlite.SQLiteConnection

/**
 * What is wrong with the tables of a database, measured against the record
 * conventions in docs/architecture/data.md. An empty list means every table
 * follows them:
 *
 * - `id` is `TEXT NOT NULL` and the only primary key column.
 * - `createdAt` and `updatedAt` are `INTEGER NOT NULL`.
 * - `deletedAt` is `INTEGER` and may be null.
 * - An index on (`updatedAt`, `id`), in that order, serves the "changed
 *   since" query.
 *
 * Room's and SQLite's own tables are skipped, and so are [exceptTables].
 */
fun recordConventionProblems(connection: SQLiteConnection, exceptTables: Set<String> = emptySet()): List<String> =
    tableNames(connection)
        .filterNot { it in exceptTables || it in INTERNAL_TABLES || it.startsWith(SQLITE_PREFIX) }
        .flatMap { table -> columnProblems(connection, table) + indexProblems(connection, table) }

private data class Column(val name: String, val type: String, val notNull: Boolean, val primaryKeyPosition: Int)

private data class ExpectedColumn(val name: String, val type: String, val notNull: Boolean)

private val EXPECTED_COLUMNS = listOf(
    ExpectedColumn("id", "TEXT", notNull = true),
    ExpectedColumn("createdAt", "INTEGER", notNull = true),
    ExpectedColumn("updatedAt", "INTEGER", notNull = true),
    ExpectedColumn("deletedAt", "INTEGER", notNull = false),
)

private val CHANGE_INDEX_COLUMNS = listOf("updatedAt", "id")

private val INTERNAL_TABLES = setOf("room_master_table", "android_metadata")

private const val SQLITE_PREFIX = "sqlite_"

private fun tableNames(connection: SQLiteConnection): List<String> =
    connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").use { statement ->
        buildList { while (statement.step()) add(statement.getText(0)) }
    }

private fun columnProblems(connection: SQLiteConnection, table: String): List<String> {
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
    val problems = EXPECTED_COLUMNS.mapNotNull { expected ->
        val column = columns[expected.name]
        when {
            column == null -> "$table has no column ${expected.name}"
            !column.type.equals(expected.type, ignoreCase = true) ->
                "$table.${expected.name} is ${column.type}, not ${expected.type}"
            column.notNull != expected.notNull ->
                "$table.${expected.name} must ${if (expected.notNull) "be NOT NULL" else "allow null"}"
            else -> null
        }
    }
    val primaryKey = columns.values.filter { it.primaryKeyPosition > 0 }.sortedBy { it.primaryKeyPosition }.map { it.name }
    return if (primaryKey == listOf("id")) problems else problems + "$table has the primary key $primaryKey, not [id]"
}

private fun indexProblems(connection: SQLiteConnection, table: String): List<String> {
    val indexes = connection.prepare("PRAGMA index_list(${quoted(table)})").use { statement ->
        buildList { while (statement.step()) add(statement.getText(1)) }
    }
    val hasChangeIndex = indexes.any { index -> indexColumns(connection, index) == CHANGE_INDEX_COLUMNS }
    return if (hasChangeIndex) emptyList() else listOf("$table has no index on (updatedAt, id)")
}

private fun indexColumns(connection: SQLiteConnection, index: String): List<String> =
    connection.prepare("PRAGMA index_info(${quoted(index)})").use { statement ->
        buildList { while (statement.step()) add(statement.getText(2)) }
    }

/** An SQL identifier in double quotes, safe for any table or index name. */
private fun quoted(name: String): String = "\"" + name.replace("\"", "\"\"") + "\""
