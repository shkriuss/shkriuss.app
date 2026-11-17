package app.shkriuss.feature.reminders.data

import android.content.Context
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder

/**
 * Reminders' one database, `reminders.db`, on the system SQLite
 * (docs/apps/reminders/spec.md, "As in Water", the database). One record
 * table and the [ChangeCounter]. Every write goes through a
 * `RecordWriter` (`RemindersRepository`).
 *
 * A schema change bumps [Database.version], adds a step to
 * [RemindersMigrations], a migration test, and the exported schema file
 * (docs/architecture/data.md, "How to change a schema").
 */
@Database(
    entities = [ReminderEntity::class, ChangeCounter::class],
    version = 1,
)
abstract class RemindersDatabase : RoomDatabase() {
    /** The reminders. */
    abstract fun reminders(): ReminderDao

    /** How the app opens its database. */
    companion object {
        /** The file name, in the app's database folder. */
        const val FILE_NAME: String = "reminders.db"

        /** Opens `reminders.db` with every migration. Room stops if a step is missing; nothing is ever deleted. */
        fun open(context: Context): RemindersDatabase =
            systemSqliteDatabaseBuilder<RemindersDatabase>(context, FILE_NAME)
                .addMigrations(*RemindersMigrations.All.toTypedArray())
                .build()
    }
}

/** The migrations of [RemindersDatabase], one for each version step. Version 1 has none. */
object RemindersMigrations {
    /** Every migration, for the database builder and the migration tests. */
    val All: List<Migration> = emptyList()
}
