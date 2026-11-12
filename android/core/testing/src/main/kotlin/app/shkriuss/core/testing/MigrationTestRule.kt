package app.shkriuss.core.testing

import android.app.Instrumentation
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import androidx.room3.testing.MigrationTestHelper
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.AndroidSQLiteDriver
import kotlin.reflect.KClass
import kotlinx.coroutines.runBlocking
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * A JUnit rule for database migration tests, on the system SQLite driver
 * the apps use. It wraps Room's `MigrationTestHelper`.
 *
 * It creates a database at an old version from that version's committed
 * schema file in the module's `schemas/` folder, runs migrations on it,
 * and checks that the result matches the committed schema of the new
 * version exactly. The `shkriuss.android.room` plugin gives unit tests the
 * committed schema files.
 *
 * In a Robolectric test:
 * ```
 * @get:Rule
 * val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), NoteDatabase::class)
 * ```
 * Each test starts and ends with no database file.
 */
class MigrationTestRule(
    private val instrumentation: Instrumentation,
    private val databaseClass: KClass<out RoomDatabase>,
) : TestRule {
    /**
     * The name of the database file in the app's database folder. A test
     * can open it with Room after a migration, as the app would.
     */
    val databaseName: String = FILE_NAME

    private val helper = MigrationTestHelper(
        instrumentation = instrumentation,
        file = instrumentation.targetContext.getDatabasePath(FILE_NAME),
        driver = AndroidSQLiteDriver(),
        databaseClass = databaseClass,
    )

    override fun apply(base: Statement, description: Description): Statement {
        val withHelper = helper.apply(base, description)
        return object : Statement() {
            override fun evaluate() {
                deleteDatabaseFile()
                try {
                    withHelper.evaluate()
                } finally {
                    deleteDatabaseFile()
                }
            }
        }
    }

    /**
     * Creates the database at [version] from its committed schema file. Add
     * the rows the migration must keep, then close the connection.
     */
    fun createDatabase(version: Int): SQLiteConnection = runBlocking { helper.createDatabase(version) }

    /**
     * Runs [migrations] on the database that [createDatabase] made, up to
     * [version]. Fails unless the result matches the committed schema of
     * [version]. Returns a connection to check the rows, which the caller
     * closes.
     */
    fun runMigrationsAndValidate(version: Int, migrations: List<Migration>): SQLiteConnection =
        runBlocking { helper.runMigrationsAndValidate(version, migrations) }

    /** The versions that have a committed schema file, oldest first. */
    fun committedVersions(): List<Int> {
        val folder = checkNotNull(databaseClass.qualifiedName)
        val files = instrumentation.context.assets.list(folder).orEmpty()
        val versions = files.mapNotNull { it.removeSuffix(SCHEMA_SUFFIX).toIntOrNull() }.sorted()
        check(versions.isNotEmpty()) { "No committed schema files for $folder" }
        return versions
    }

    /**
     * Checks that an empty database of every older committed version
     * migrates to the newest one with [migrations]. This finds a missing
     * step anywhere in the chain, which Room would only find on a user's
     * phone.
     */
    fun checkEveryVersionMigratesToNewest(migrations: List<Migration>) {
        val versions = committedVersions()
        val newest = versions.last()
        for (version in versions.dropLast(1)) {
            deleteDatabaseFile()
            createDatabase(version).close()
            runMigrationsAndValidate(newest, migrations).close()
        }
        deleteDatabaseFile()
    }

    /**
     * Checks that every table of the newest committed schema follows the
     * record conventions ([recordConventionProblems]). [exceptTables] names
     * tables that are allowed not to, each with a reason in the test.
     */
    fun checkNewestFollowsRecordConventions(exceptTables: Set<String> = emptySet()) {
        deleteDatabaseFile()
        val problems = createDatabase(committedVersions().last()).use { connection ->
            recordConventionProblems(connection, exceptTables)
        }
        deleteDatabaseFile()
        check(problems.isEmpty()) {
            "The schema breaks the record conventions (docs/architecture/data.md):\n" +
                problems.joinToString("\n") { "- $it" }
        }
    }

    private fun deleteDatabaseFile() {
        instrumentation.targetContext.deleteDatabase(FILE_NAME)
    }

    private companion object {
        const val FILE_NAME = "migration-test.db"
        const val SCHEMA_SUFFIX = ".json"
    }
}
