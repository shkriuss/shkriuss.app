package app.shkriuss.feature.water.data

import android.content.Context
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder

/**
 * Water's one database, `water.db`, on the system SQLite
 * (docs/apps/water/spec.md, "The database"). Three record tables share one
 * [ChangeCounter]. Every write goes through a `RecordWriter`
 * ([WaterRepository]).
 *
 * A schema change bumps [Database.version], adds a step to
 * [WaterMigrations], a migration test, and the exported schema file
 * (docs/architecture/data.md, "How to change a schema").
 */
@Database(
    entities = [IntakeEntity::class, GoalEntity::class, SettingsEntity::class, ChangeCounter::class],
    version = 1,
)
abstract class WaterDatabase : RoomDatabase() {
    /** The drinks. */
    abstract fun intake(): IntakeDao

    /** The changes of the daily goal. */
    abstract fun goals(): GoalDao

    /** The settings records. */
    abstract fun settings(): SettingsDao

    /** How the app opens its database. */
    companion object {
        /** The file name, in the app's database folder. */
        const val FILE_NAME: String = "water.db"

        /** Opens `water.db` with every migration. Room stops if a step is missing; nothing is ever deleted. */
        fun open(context: Context): WaterDatabase =
            systemSqliteDatabaseBuilder<WaterDatabase>(context, FILE_NAME)
                .addMigrations(*WaterMigrations.All.toTypedArray())
                .build()
    }
}

/** The migrations of [WaterDatabase], one for each version step. Version 1 has none. */
object WaterMigrations {
    /** Every migration, for the database builder and the migration tests. */
    val All: List<Migration> = emptyList()
}
