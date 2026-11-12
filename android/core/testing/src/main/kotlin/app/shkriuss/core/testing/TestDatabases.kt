package app.shkriuss.core.testing

import android.content.Context
import androidx.room3.Room
import androidx.room3.RoomDatabase
import androidx.sqlite.driver.AndroidSQLiteDriver

/**
 * Starts the builder of a database that lives in memory only, on the same
 * system SQLite driver the apps use. For tests of DAOs and repositories.
 * Close the database at the end of the test.
 */
inline fun <reified T : RoomDatabase> inMemoryTestDatabaseBuilder(context: Context): RoomDatabase.Builder<T> =
    Room.inMemoryDatabaseBuilder<T>(context).setDriver(AndroidSQLiteDriver())
