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
 * Checks that [recordConventionProblems] passes a database that follows
 * the record conventions and names every way one can break them, and that
 * [changeNumberProblems] finds wrong change numbers.
 */
@RunWith(RobolectricTestRunner::class)
class RecordConventionsTest {
    private val connection: SQLiteConnection = AndroidSQLiteDriver().open(":memory:")

    @After
    fun close() {
        connection.close()
    }

    @Test
    fun aDatabaseThatFollowsTheConventionsHasNoProblems() {
        createCounter()
        createGoodTable("note")
        connection.execSQL("CREATE TABLE room_master_table (id INTEGER PRIMARY KEY, identity_hash TEXT)")

        assertEquals(emptyList<String>(), recordConventionProblems(connection))
    }

    @Test
    fun aMissingCounterTableIsNamed() {
        createGoodTable("note")

        assertEquals(listOf("the database has no change_counter table"), recordConventionProblems(connection))
    }

    @Test
    fun aWrongCounterTableIsNamed() {
        connection.execSQL("CREATE TABLE change_counter (id INTEGER NOT NULL, lastNumber TEXT NOT NULL, PRIMARY KEY(id))")
        createGoodTable("note")

        assertEquals(listOf("change_counter.lastNumber is TEXT, not INTEGER"), recordConventionProblems(connection))
    }

    @Test
    fun aMissingColumnIsNamed() {
        createCounter()
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL PRIMARY KEY, createdAt INTEGER NOT NULL, " +
                "updatedAt INTEGER NOT NULL, deletedAt INTEGER)",
        )

        val expected = listOf("note has no column changeNumber", "note has no unique index on changeNumber")
        assertEquals(expected, recordConventionProblems(connection))
    }

    @Test
    fun wrongTypesAndNullabilityAreNamed() {
        createCounter()
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL PRIMARY KEY, createdAt TEXT NOT NULL, " +
                "updatedAt INTEGER, deletedAt INTEGER NOT NULL, changeNumber INTEGER)",
        )
        connection.execSQL("CREATE UNIQUE INDEX note_changes ON note (changeNumber)")

        val expected = listOf(
            "note.createdAt is TEXT, not INTEGER",
            "note.updatedAt must be NOT NULL",
            "note.deletedAt must allow null",
            "note.changeNumber must be NOT NULL",
        )
        assertEquals(expected, recordConventionProblems(connection))
    }

    @Test
    fun aDifferentPrimaryKeyIsNamed() {
        createCounter()
        connection.execSQL(
            "CREATE TABLE note (id TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL, " +
                "updatedAt INTEGER NOT NULL, deletedAt INTEGER, changeNumber INTEGER NOT NULL, PRIMARY KEY (id, title))",
        )
        connection.execSQL("CREATE UNIQUE INDEX note_changes ON note (changeNumber)")

        assertEquals(listOf("note has the primary key [id, title], not [id]"), recordConventionProblems(connection))
    }

    @Test
    fun aChangeIndexThatIsNotUniqueIsNamed() {
        createCounter()
        createGoodTable("note", withIndex = false)
        connection.execSQL("CREATE INDEX note_changes ON note (changeNumber)")
        connection.execSQL("CREATE UNIQUE INDEX note_other ON note (changeNumber, id)")

        assertEquals(listOf("note has no unique index on changeNumber"), recordConventionProblems(connection))
    }

    @Test
    fun exceptedTablesAreSkipped() {
        createCounter()
        connection.execSQL("CREATE TABLE note_search (content TEXT)")

        assertEquals(emptyList<String>(), recordConventionProblems(connection, exceptTables = setOf("note_search")))
    }

    @Test
    fun goodChangeNumbersHaveNoProblems() {
        createCounter()
        createGoodTable("note")
        createGoodTable("tag")
        insert("note", "a", changeNumber = 1)
        insert("tag", "b", changeNumber = 3)
        connection.execSQL("INSERT INTO change_counter (id, lastNumber) VALUES (1, 3)")

        assertEquals(emptyList<String>(), changeNumberProblems(connection))
    }

    @Test
    fun aSharedOrTooHighChangeNumberIsNamed() {
        createCounter()
        createGoodTable("note")
        createGoodTable("tag")
        insert("note", "a", changeNumber = 2)
        insert("tag", "b", changeNumber = 2)
        insert("tag", "c", changeNumber = 5)
        connection.execSQL("INSERT INTO change_counter (id, lastNumber) VALUES (1, 4)")

        val expected = listOf("tag b and note a share change number 2", "tag c has change number 5, outside 1 to 4")
        assertEquals(expected, changeNumberProblems(connection))
    }

    private fun createCounter() {
        connection.execSQL("CREATE TABLE change_counter (id INTEGER NOT NULL, lastNumber INTEGER NOT NULL, PRIMARY KEY(id))")
    }

    private fun createGoodTable(name: String, withIndex: Boolean = true) {
        connection.execSQL(
            "CREATE TABLE $name (changeNumber INTEGER NOT NULL, title TEXT NOT NULL, id TEXT NOT NULL, " +
                "createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (id))",
        )
        if (withIndex) connection.execSQL("CREATE UNIQUE INDEX index_${name}_changeNumber ON $name (changeNumber)")
    }

    private fun insert(table: String, id: String, changeNumber: Long) {
        connection.execSQL(
            "INSERT INTO $table (changeNumber, title, id, createdAt, updatedAt, deletedAt) " +
                "VALUES ($changeNumber, 'x', '$id', 1, 1, NULL)",
        )
    }
}
