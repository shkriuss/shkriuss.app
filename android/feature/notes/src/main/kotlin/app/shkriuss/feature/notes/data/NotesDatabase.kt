package app.shkriuss.feature.notes.data

import android.content.Context
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import androidx.room3.useWriterConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder

/**
 * Notes' one database, `notes.db`, on the system SQLite
 * (docs/apps/notes/spec.md, "As in Water and Tasks", the database). Two
 * record tables, `note` and `attachment`, and the [ChangeCounter]. Every
 * write goes through a `RecordWriter` (`NotesRepository`).
 *
 * Notes wipes the content of deleted records (ADR 0042), so the database
 * is opened with SQLite's `secure_delete` on ([SecureDelete]): the bytes
 * a write clears are written over in `notes.db`. After a wipe, and at
 * every start, [checkpoint] moves the write-ahead file into `notes.db`
 * and cuts it to zero.
 *
 * A schema change bumps [Database.version], adds a step to
 * [NotesMigrations], a migration test, and the exported schema file
 * (docs/architecture/data.md, "How to change a schema").
 */
@Database(
    entities = [NoteEntity::class, AttachmentEntity::class, ChangeCounter::class],
    version = 1,
)
abstract class NotesDatabase : RoomDatabase() {
    /** The notes. */
    abstract fun notes(): NoteDao

    /** The files of the notes. */
    abstract fun attachments(): AttachmentDao

    /** How the app opens its database. */
    companion object {
        /** The file name, in the app's database folder. */
        const val FILE_NAME: String = "notes.db"

        /** Opens `notes.db` with every migration and `secure_delete` on. Room stops if a step is missing; nothing is ever deleted. */
        fun open(context: Context): NotesDatabase =
            systemSqliteDatabaseBuilder<NotesDatabase>(context, FILE_NAME)
                .addMigrations(*NotesMigrations.All.toTypedArray())
                .addCallback(SecureDelete)
                .build()
    }
}

/**
 * Turns SQLite's `secure_delete` on when the database opens. On the
 * system SQLite every write runs on the one connection that the pragma
 * reaches, so every page a write frees or changes is written over.
 * `NotesDatabaseTest` checks it on that connection.
 */
object SecureDelete : RoomDatabase.Callback() {
    override suspend fun onOpen(connection: SQLiteConnection) {
        connection.execSQL("PRAGMA secure_delete = ON")
    }
}

/**
 * Moves every frame of the write-ahead file into `notes.db` and cuts the
 * file to zero (docs/apps/notes/spec.md, "Removing a file, and the
 * wipe", point 4). It waits for open reads as long as SQLite's busy time
 * allows. Returns false if a read stayed open, so the checkpoint could not
 * finish: the app tries again at the next wipe or start. Cutting the file
 * does not write over its old frames, which stay in the phone's storage
 * under Android's file-based encryption.
 */
suspend fun NotesDatabase.checkpoint(): Boolean = useWriterConnection { connection ->
    connection.usePrepared("PRAGMA wal_checkpoint(TRUNCATE)") { statement ->
        // One row: busy (1 if it could not finish), the frames in the file, the frames moved.
        !statement.step() || statement.getLong(0) == 0L
    }
}

/** The migrations of [NotesDatabase], one for each version step. Version 1 has none. */
object NotesMigrations {
    /** Every migration, for the database builder and the migration tests. */
    val All: List<Migration> = emptyList()
}
