package app.shkriuss.feature.tasks.data

import android.content.Context
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder

/**
 * Tasks' one database, `tasks.db`, on the system SQLite
 * (docs/apps/tasks/spec.md, "As in Water and Reminders", the database).
 * Two record tables, `task_list` and `task`, and the [ChangeCounter].
 * Every write goes through a `RecordWriter` (`TasksRepository`).
 *
 * A schema change bumps [Database.version], adds a step to
 * [TasksMigrations], a migration test, and the exported schema file
 * (docs/architecture/data.md, "How to change a schema").
 */
@Database(
    entities = [TaskListEntity::class, TaskEntity::class, ChangeCounter::class],
    version = 1,
)
abstract class TasksDatabase : RoomDatabase() {
    /** The lists. */
    abstract fun lists(): TaskListDao

    /** The tasks. */
    abstract fun tasks(): TaskDao

    /** How the app opens its database. */
    companion object {
        /** The file name, in the app's database folder. */
        const val FILE_NAME: String = "tasks.db"

        /** Opens `tasks.db` with every migration. Room stops if a step is missing; nothing is ever deleted. */
        fun open(context: Context): TasksDatabase =
            systemSqliteDatabaseBuilder<TasksDatabase>(context, FILE_NAME)
                .addMigrations(*TasksMigrations.All.toTypedArray())
                .build()
    }
}

/** The migrations of [TasksDatabase], one for each version step. Version 1 has none. */
object TasksMigrations {
    /** Every migration, for the database builder and the migration tests. */
    val All: List<Migration> = emptyList()
}
