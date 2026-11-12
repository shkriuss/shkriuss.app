package app.shkriuss.core.data.sample

import androidx.room3.migration.Migration
import androidx.sqlite.execSQL

/**
 * The migrations of [SampleDatabase], one for each version step. The
 * example for the migrations of every app database.
 */
object SampleMigrations {
    /**
     * Version 1 to 2: a note can be pinned. Notes from version 1 are not
     * pinned. The migration changes the table, not the records, so it
     * leaves their record fields as they are.
     */
    val From1To2: Migration = Migration(startVersion = 1, endVersion = 2) { connection ->
        connection.execSQL("ALTER TABLE sample_note ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
    }

    /** Every migration, for the database builder and the migration tests. */
    val All: List<Migration> = listOf(From1To2)
}
