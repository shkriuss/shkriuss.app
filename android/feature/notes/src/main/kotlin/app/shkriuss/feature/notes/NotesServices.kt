package app.shkriuss.feature.notes

import android.app.Activity
import android.content.Context
import android.database.SQLException
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.feature.notes.data.NotesDatabase
import java.io.File
import java.time.ZoneId
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
 * of files, the images, the one snackbar, the move of the file keys, the
 * clock of the screens, and backup and restore. The app class builds one,
 * calls [start] when the app starts, and hands it out through [NotesHost].
 * Nothing here is found by a lookup: the ViewModels get what they need
 * through their constructors.
 *
 * [crypto] is the app's one `ShkCrypto`, made with [APP_NAME]: its file
 * keys seal the key of every file, and its backup keys lock a backup.
 * [gateOpen] is true while the gate of
 * the app lock is open; with [onScreen] it says when an add may start.
 * [work] runs the reads and writes off the main thread, and [zone] is the
 * phone's time zone for the screens. Tests pass their own.
 */
class NotesServices(
    context: Context,
    /** The app's one database. */
    val database: NotesDatabase,
    clock: Clock,
    ids: IdSource,
    private val crypto: ShkCrypto,
    /** True while the gate of the app lock is open. */
    val gateOpen: Flow<Boolean>,
    work: CoroutineContext = Dispatchers.IO,
    zone: () -> ZoneId = ZoneId::systemDefault,
) {
    /**
     * The scope of the work that outlives a screen, such as the save when
     * Notes leaves the screen, which an open note's ViewModel runs here.
     */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + work)

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
        NotesRepository(database, clock, ids, NoteFileStore(File(context.noBackupFilesDir, ATTACHMENTS_FOLDER)), background = scope)

    /** The one snackbar of Notes. When its Undo ends, the move of the file keys goes on. */
    val snackbars: NotesSnackbars = NotesSnackbars(repository, { keyMove.run() }, scope, work, isAdding = { adds.isAddingTo(it) })

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
        afterLastAdd = { noteId -> snackbars.lookAgain(noteId) },
    )

    /** The state of each file, the images and **Save a copy**. */
    val reader: FileReader = FileReader(repository, crypto.files, ::aKeysetIsDamaged, work)

    /** The images of files, decoded in memory for the screens. */
    val images: NoteImages = NoteImages(reader, work)

    /** The phone's clock for the screens: a last change shows as a time today, else as a date. */
    val now: NotesNow = NotesNow(clock, scope, zone)

    /** Backup and restore, and what Settings shows about the recovery key and the app lock. */
    val backups: NotesBackups = NotesBackups(
        Backups(
            context.contentResolver,
            crypto.backups,
            APP_NAME,
            // After a restore, the sweep of every start: files of deleted notes are marked deleted, and wiped.
            NotesBackupContent(database, repository, clock, ids, afterRestore = ::sweep),
            // In the no-backup files folder, next to the keys and the streams, and not in the cache folder, which
            // Android may empty at any time. On the same file system as the streams, so a stream moves in by a rename
            // (docs/architecture/backup-format.md, "Staging").
            File(context.noBackupFilesDir, STAGING_FOLDER),
            clock,
            work,
        ),
        crypto,
        repository,
        snackbars,
        keyMove,
        clock,
        zone,
        work,
    )

    /**
     * Call once in the app class's `onCreate`. Off the main thread, it
     * empties what a restore left behind when the app stopped in the middle
     * of it (`NotesBackups.start`). It sweeps (`NotesRepository.sweep`):
     * files of deleted notes are marked deleted, deleted records are wiped,
     * streams that no record needs and every part go, and the write-ahead
     * file is checkpointed. Then it goes on with a pending move of the file
     * keys. What fails is tried again at the next start.
     */
    fun start() {
        backups.start(scope)
        scope.launch {
            sweep()
            keyMove.run()
        }
    }

    /** The sweep of every start, also after a restore. What fails is tried again at the next start. */
    private suspend fun sweep() {
        try {
            repository.sweep(snackbars)
        } catch (_: SQLException) {
            // Tried again at the next start (docs/apps/notes/spec.md, "A write fails").
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

        /** The folder a restore puts a backup aside in, until the whole of it was checked. Only `Backups` uses it. */
        private const val STAGING_FOLDER = "shk-restore"
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
