package app.shkriuss.core.testing

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.sqlite.execSQL
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Checks that [recordConventionProblems] passes a table that follows the
 * record conventions and names every way a table can break them.
 */
@RunWith(RobolectricTestRunner::class)
class RecordConventionsTest {
    private val connection: SQLiteConnection = AndroidSQLiteDriver().open(":memory:")

    @After
    fun close() {
        connection.close()
    }

    @Test
    fun aTableThatFollowsTheConventionsHasNoProblems() {
        createGoodTable("note")
        connection.execSQL("CREATE TABLE room_master_table (id INTEGER PRIMARY KEY, identity_hash TEXT)")

        assertEquals(emptyList<String>(), recordConventionProblems(connection))
    }

    @Test
    fun aMissingColumnIsNamed() {
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL PRIMARY KEY, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)",
        )
        connection.execSQL("CREATE INDEX note_changes ON note (updatedAt, id)")

        assertEquals(listOf("note has no column deletedAt"), recordConventionProblems(connection))
    }

    @Test
    fun wrongTypesAndNullabilityAreNamed() {
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL PRIMARY KEY, createdAt TEXT NOT NULL, " +
                "updatedAt INTEGER, deletedAt INTEGER NOT NULL)",
        )
        connection.execSQL("CREATE INDEX note_changes ON note (updatedAt, id)")

        val expected = listOf(
            "note.createdAt is TEXT, not INTEGER",
            "note.updatedAt must be NOT NULL",
            "note.deletedAt must allow null",
        )
        assertEquals(expected, recordConventionProblems(connection))
    }

    @Test
    fun aDifferentPrimaryKeyIsNamed() {
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL, " +
                "updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (id, title))",
        )
        connection.execSQL("CREATE INDEX note_changes ON note (updatedAt, id)")

        assertEquals(listOf("note has the primary key [id, title], not [id]"), recordConventionProblems(connection))
    }

    @Test
    fun aMissingOrWrongChangeIndexIsNamed() {
        createGoodTable("note", withIndex = false)
        connection.execSQL("CREATE INDEX note_wrong_order ON note (id, updatedAt)")

        assertEquals(listOf("note has no index on (updatedAt, id)"), recordConventionProblems(connection))
    }

    @Test
    fun exceptedTablesAreSkipped() {
        connection.execSQL("CREATE TABLE note_search (content TEXT)")

        assertEquals(emptyList<String>(), recordConventionProblems(connection, exceptTables = setOf("note_search")))
    }

    private fun createGoodTable(name: String, withIndex: Boolean = true) {
        connection.execSQL(
            "CREATE TABLE $name (title TEXT NOT NULL, id TEXT NOT NULL, createdAt INTEGER NOT NULL, " +
                "updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (id))",
        )
        if (withIndex) connection.execSQL("CREATE INDEX index_${name}_updatedAt_id ON $name (updatedAt, id)")
    }
}
