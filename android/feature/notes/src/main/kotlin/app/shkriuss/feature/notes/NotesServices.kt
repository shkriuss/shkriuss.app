package app.shkriuss.feature.notes

import android.app.Activity
import android.content.Context
import android.database.SQLException
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.feature.notes.data.NotesDatabase
import java.io.File
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * Everything of Notes that lives as long as the app: its database, the
 * folder of streams, the repository on them, the adds of files, the reads
 * of files, the one snackbar and the move of the file keys. The app class
 * builds one, calls [start] when the app starts, and hands it out through
 * [NotesHost]. Nothing here is found by a lookup: the ViewModels get what
 * they need through their constructors.
 *
 * [crypto] is the app's one `ShkCrypto`, made with [APP_NAME]: its file
 * keys seal the key of every file. [gateOpen] is true while the gate of
 * the app lock is open; with [onScreen] it says when an add may start.
 * [work] runs the reads and writes off the main thread. Tests pass their
 * own.
 */
class NotesServices(
    context: Context,
    /** The app's one database. */
    val database: NotesDatabase,
    clock: Clock,
    ids: IdSource,
    private val crypto: ShkCrypto,
    gateOpen: Flow<Boolean>,
    work: CoroutineContext = Dispatchers.IO,
) {
    private val scope = CoroutineScope(SupervisorJob() + work)

    /** True while a screen of Notes is on the screen, from its start to its stop. */
    private val shown = MutableStateFlow(false)

    /**
     * Held by each add of a file from its key to its record, and by the
     * move of the file keys while it finishes, so the move never ends while
     * a key is wrapped before its record exists.
     */
    private val fileKeys = Mutex()

    /** The notes and the records of their files, and the folder of their streams. */
    val repository: NotesRepository =
        NotesRepository(database, clock, ids, NoteFileStore(File(context.noBackupFilesDir, ATTACHMENTS_FOLDER)))

    /** The one snackbar of Notes. When its Undo ends, the move of the file keys goes on. */
    val snackbars: NotesSnackbars = NotesSnackbars(repository, { keyMove.run() }, scope, work)

    /** The move of the file keys to the recovery key. */
    val keyMove: FileKeyMove = FileKeyMove(repository, crypto, fileKeys, snackbars, work)

    /** The adds of files, one at a time, while Notes is on the screen and the gate is open. */
    val adds: FileAdds = FileAdds(
        repository,
        crypto.files,
        combine(shown, gateOpen) { onScreen, open -> onScreen && open },
        fileKeys,
        { problem -> snackbars.show(NotesMessage.NotAdded(problem)) },
        scope,
        work,
    )

    /** The state of each file, the images and **Save a copy**. */
    val reader: FileReader = FileReader(repository, crypto.files, ::aKeysetIsDamaged, work)

    /**
     * Call once in the app class's `onCreate`. Off the main thread, it
     * sweeps (`NotesRepository.sweep`): files of deleted notes are marked
     * deleted, deleted records are wiped, streams that no record needs and
     * every part go, and the write-ahead file is checkpointed. Then it goes
     * on with a pending move of the file keys. What fails is tried again
     * at the next start.
     */
    fun start() {
        scope.launch {
            try {
                repository.sweep()
            } catch (_: SQLException) {
                // Tried again at the next start (docs/apps/notes/spec.md, "A write fails").
            }
            keyMove.run()
        }
    }

    /** Call from the activity's `onStart` with true and its `onStop` with false. Adds start only while it is true. */
    fun onScreen(isShown: Boolean) {
        shown.value = isShown
    }

    /** True if a keyset file that seals file keys, or one the words repair, is damaged: no file opens until it is put right. */
    private fun aKeysetIsDamaged(): Boolean = try {
        val status = crypto.status()
        status.needsRepair || status.filesCanBeGivenUp
    } catch (_: BlobException) {
        false
    }

    companion object {
        /** The name of the app in keys and backups (docs/apps/notes/spec.md). The app class makes its `ShkCrypto` with it. */
        val APP_NAME: AppName = AppName.of("notes")

        /** The folder of the streams, in the no-backup files folder. */
        const val ATTACHMENTS_FOLDER: String = "attachments"
    }
}

/**
 * The app class of Notes. Android creates the screens itself, so they
 * reach [NotesServices] through the app class, as the screens of
 * `core/security` reach its `SecurityHost`.
 */
interface NotesHost {
    /** The app's one [NotesServices]. */
    val notes: NotesServices
}

/** The [NotesServices] of the app this screen belongs to. */
val Activity.notesServices: NotesServices
    get() = (application as? NotesHost ?: error("The app class must implement NotesHost")).notes
