package app.shkriuss.core.data

import android.content.Context
import androidx.room3.Room
import androidx.room3.RoomDatabase
import androidx.sqlite.driver.AndroidSQLiteDriver

/**
 * Starts the builder of a database file in the app's database folder, on
 * the system SQLite (ADR 0004). Every app database is built through this.
 *
 * The driver is `AndroidSQLiteDriver`: the SQLite of the Android system,
 * with no native code in the app. The database file is protected by
 * Android's file-based encryption. Room checks on open that a migration
 * exists for every version step, and stops if one is missing. Never call
 * `fallbackToDestructiveMigration` on the builder: it would delete records.
 */
inline fun <reified T : RoomDatabase> systemSqliteDatabaseBuilder(
    context: Context,
    name: String,
): RoomDatabase.Builder<T> =
    Room.databaseBuilder<T>(context, name).setDriver(AndroidSQLiteDriver())
