package app.shkriuss.feature.notes

import android.database.SQLException
import android.net.Uri
import app.shkriuss.core.backup.BackupAnswer
import app.shkriuss.core.backup.BackupDocuments
import app.shkriuss.core.backup.BackupProgress
import app.shkriuss.core.backup.BackupStagingException
import app.shkriuss.core.backup.BackupSummary
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckResult
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.backup.RestoreResult
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.IOException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlin.math.floor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Where the recovery key of the app stands (docs/apps/water/spec.md, "What Settings shows before it", as Notes' spec says). */
enum class RecoveryKeyLine {
    /** The app has no recovery key. Settings says "Not set up". */
    NOT_SET_UP,

    /** A setup stopped half way. Settings says "Setup not finished". */
    UNFINISHED,

    /** The app has its keys from a recovery key. Settings says "Set up". */
    SET_UP,
}

/** What Settings shows about the keys: the recovery key, and whether the app lock is on. */
data class KeysNow(val recoveryKey: RecoveryKeyLine, val appLockOn: Boolean)

/** Why Notes does not take a file, as docs/user/backup.md names it ("If the app does not take a file"). */
sealed interface BackupRefusal {
    /** The file is something else, for example a photo. */
    data object NotABackup : BackupRefusal

    /** A newer version of Notes made it. */
    data object NewerVersion : BackupRefusal

    /** It is a backup of the app [name]. */
    data class OtherApp(val name: String) : BackupRefusal

    /** It was made with other recovery words. [shortName] is the short name of the key it needs. */
    data class OtherRecoveryKey(val shortName: String) : BackupRefusal

    /** Notes has no keys from a recovery key, or cannot use them now. */
    data object NoKeys : BackupRefusal

    /** The file is cut short or was changed. */
    data object Damaged : BackupRefusal
}

/**
 * Where a backup or a restore stands, or how it ended
 * (docs/apps/water/spec.md, "Backup and restore screens", as
 * docs/apps/notes/spec.md, "As in Water and Tasks" and "Writing", says).
 * Each is one dialog. No step holds a title, a record or a file name.
 */
sealed interface BackupStep {
    /** "Writing the backup", at [percent] of the files, or with the circle while it is not known (null). */
    data class Writing(val percent: Int? = null) : BackupStep

    /** "Checking the backup": the file just written, or the file picked for a restore, at [percent] of it, or with the circle. */
    data class Checking(val percent: Int? = null) : BackupStep

    /** "Restoring the backup", at [percent] of the file read, or with the circle. */
    data class Restoring(val percent: Int? = null) : BackupStep

    /**
     * The backup is written, and the file was read again and is whole. It
     * holds [notes] notes that are not deleted and [files] files.
     * [leftOut] files are not on this phone or are damaged, and are not in
     * it.
     */
    data class Written(val notes: Long, val files: Long, val leftOut: Long) : BackupStep

    /** The file was written, but it does not pass the check. It must not be relied on. */
    data object WrittenNotUsable : BackupStep

    /**
     * The backup is written, but it was not checked: the file could not be
     * read again, or what was read is not the backup just written, such as
     * an older copy that a storage app handed back. [leftOut] files are not
     * on this phone or are damaged, and are not in it.
     */
    data class WrittenNotChecked(val leftOut: Long) : BackupStep

    /** Writing the file failed, for example because the storage is full. */
    data object NotWritten : BackupStep

    /** No backup was made: Notes could not finish wiping what was deleted first (spec, "Writing", point 1). */
    data object NotWiped : BackupStep

    /** No backup was made: Notes cannot use its keys now. */
    data object NoKeys : BackupStep

    /** No backup was made: some file keys are still sealed by the key Notes had before its recovery key, and cannot move now. */
    data object FilesStillMoving : BackupStep

    /**
     * "Restore this backup?" The file passed the check. It was made at
     * [madeAt], local time, and holds [notes] notes and [files] files.
     * [backup] is what the check read: **Restore** takes only that backup.
     */
    data class Question(val madeAt: LocalDateTime, val notes: Long, val files: Long, val backup: BackupSummary) : BackupStep

    /** "Backup restored". */
    data object Restored : BackupStep

    /** The file is not taken, for [reason]. Nothing in Notes changed. */
    data class Refused(val reason: BackupRefusal) : BackupStep

    /** Reading the file failed. Nothing in Notes changed. */
    data object NotRead : BackupStep

    /** The backup could not be put aside on the phone, for example because there is no room. Nothing in Notes changed. */
    data object NoRoom : BackupStep

    /** The backup holds something this version of Notes cannot read. Nothing in Notes changed. */
    data object Unreadable : BackupStep
}

/** True while a backup, its check or a restore runs: its dialog has no button, and the screen stays on. */
val BackupStep.isWorking: Boolean
    get() = this is BackupStep.Writing || this is BackupStep.Checking || this is BackupStep.Restoring

/**
 * Backup and restore of Notes, on `Backups` of `core/backup`, as in Water
 * and Tasks (docs/apps/notes/spec.md, "Backup contents"), and what
 * Settings shows about the keys. `BackupViewModel` turns what it gives
 * into dialogs.
 *
 * - Before a backup, Notes wipes every deleted record that is not wiped
 *   yet, through the sweep of every start. If that fails, no backup is
 *   made (spec, "Writing", point 1).
 * - The move of the file keys runs whenever the keys are read ([keys]),
 *   and before a backup. Notes never finishes a pending move at once: only
 *   [FileKeyMove] ends it, once every file key is sealed again (spec,
 *   "Before the recovery key: the file key move").
 * - A backup is checked right after it is written: the file is read again
 *   to its last byte, as in Water.
 * - Each of the three shows how far it has come: its step is told again
 *   each time the whole percent changes ([BackupProgress]).
 * - After a restore, the sweep runs, inside `NotesBackupContent.restore`.
 *
 * [work] is where the keys are read, off the main thread: a hardware key
 * can be slow. `Backups` reads and writes on a thread of its own.
 */
class NotesBackups(
    private val backups: Backups,
    private val crypto: ShkCrypto,
    private val repository: NotesRepository,
    private val turns: UndoTurns,
    private val keyMove: FileKeyMove,
    private val clock: Clock,
    private val zone: () -> ZoneId,
    private val work: CoroutineContext,
) {
    private val keysLock = Mutex()

    /** The deletion of what a stopped restore left in the staging folder, once [start] began it. A restore waits for it. */
    @Volatile
    private var clearing: Job? = null

    /**
     * Call once when the app starts. In [scope], off the main thread, it
     * runs `Backups.start()`: it deletes what a restore left in the staging
     * folder when the app stopped in the middle of it. That can be the
     * streams of thousands of files, so the first screen does not wait for
     * it. A restore waits until it is done, so it never deletes what a new
     * restore puts aside.
     */
    fun start(scope: CoroutineScope) {
        clearing = scope.launch(work) { backups.start() }
    }

    /**
     * What Settings shows about the keys now, or null if they cannot be
     * read now. Before it answers, the move of the file keys goes on, if
     * one is pending. Notes calls it each time its screen starts, which is
     * also the way back from a screen of `core/security`, and before it
     * goes on after the recovery key was first needed.
     */
    suspend fun keys(): KeysNow? = withContext(work) {
        keysLock.withLock {
            keyMove.run()
            try {
                val status = crypto.status()
                val line = when {
                    status.setupIsUnfinished -> RecoveryKeyLine.UNFINISHED
                    status.hasDerivedKeys -> RecoveryKeyLine.SET_UP
                    else -> RecoveryKeyLine.NOT_SET_UP
                }
                KeysNow(line, appLockOn = status.appLock == AppLockState.ON)
            } catch (_: BlobException) {
                // The keys cannot be read now. Settings keeps what it showed, and the next start of the screen asks again.
                null
            }
        }
    }

    /** The name suggested for a new backup, such as `notes-2026-11-24.shkbackup`. The user may change it. */
    fun suggestedName(): String = BackupDocuments.fileName(NotesServices.APP_NAME, clock.nowMillis(), zone())

    /**
     * Writes a backup into the document [to], and then reads it again and
     * checks everything a restore checks, so that a backup that cannot be
     * restored is found on the day it is made. First the deleted records
     * are wiped, and the move of the file keys goes on. [show] gets the
     * steps on the way, "Writing the backup" and "Checking the backup",
     * with their percent. Returns how it ended.
     */
    suspend fun write(to: Uri, show: (BackupStep) -> Unit): BackupStep {
        if (!wipedFirst()) return BackupStep.NotWiped
        keyMove.run()
        val export = try {
            when (val result = backups.export(to) { show(BackupStep.Writing(percentOf(it))) }) {
                is ExportResult.Written -> result
                ExportResult.NotReady -> return if (fileKeysStillMove()) BackupStep.FilesStillMoving else BackupStep.NoKeys
                ExportResult.NoKeysNow -> return BackupStep.NoKeys
            }
        } catch (_: NotWipedException) {
            return BackupStep.NotWiped
        } catch (_: IOException) {
            return BackupStep.NotWritten
        }
        show(BackupStep.Checking())
        return checkWritten(to, export, show)
    }

    /**
     * Wipes every deleted record that is not wiped yet, removes the
     * streams no record needs and checkpoints the write-ahead file, as at
     * every start. False if any of it could not be done now: then no backup
     * is made (spec, "A write fails").
     */
    private suspend fun wipedFirst(): Boolean = withContext(work) {
        try {
            repository.sweep(turns)
        } catch (_: SQLException) {
            false
        }
    }

    /** True if some file keys are still sealed by the key Notes had before its recovery key. */
    private suspend fun fileKeysStillMove(): Boolean = withContext(work) {
        try {
            crypto.setup.fileKeyMoveIsPending()
        } catch (_: Exception) {
            // The keys cannot be read now: they cannot be used now either.
            false
        }
    }

    /**
     * Reads the document [written] again, right after [export] wrote it.
     * What is read must be that backup: when it was made, to the
     * millisecond, and the same counts. A storage app that hands back an
     * older copy of the document has not let the new one be checked.
     */
    private suspend fun checkWritten(written: Uri, export: ExportResult.Written, show: (BackupStep) -> Unit): BackupStep = try {
        when (val checked = backups.check(written) { show(BackupStep.Checking(percentOf(it))) }) {
            is CheckResult.Good -> if (export.isThe(checked.backup)) {
                BackupStep.Written(notesOf(checked.backup), checked.backup.files, export.filesLeftOut)
            } else {
                BackupStep.WrittenNotChecked(export.filesLeftOut)
            }
            is CheckResult.Refused -> BackupStep.WrittenNotUsable
        }
    } catch (_: IOException) {
        // Not every storage app lets a file be read right after it was written.
        BackupStep.WrittenNotChecked(export.filesLeftOut)
    }

    /**
     * Checks the document [picked] before a restore, with [show] told
     * "Checking the backup" and its percent. A good one gives the question,
     * with what the backup says about itself.
     */
    suspend fun look(picked: Uri, show: (BackupStep) -> Unit): BackupStep = try {
        when (val checked = backups.check(picked) { show(BackupStep.Checking(percentOf(it))) }) {
            is CheckResult.Good -> questionOf(checked.backup)
            is CheckResult.Refused -> BackupStep.Refused(refusalOf(checked.answer))
        }
    } catch (_: IOException) {
        BackupStep.NotRead
    }

    /**
     * Restores the document [picked], if it still holds the backup that
     * [question] showed, with [show] told "Restoring the backup" and its
     * percent. The streams move in and the sweep runs inside the restore:
     * it is not cut when the screen goes away. If the document now holds
     * another backup, nothing changes, and the answer is the question
     * again, with what the document holds now. If the database refuses
     * the records, as on a full disk, the transaction rolls back and the
     * answer is that the phone has not enough room.
     */
    suspend fun restore(picked: Uri, question: BackupStep.Question, show: (BackupStep) -> Unit): BackupStep =
        withContext(NonCancellable) {
            clearing?.join()
            try {
                when (val restored = backups.restore(picked, question.backup) { show(BackupStep.Restoring(percentOf(it))) }) {
                    is RestoreResult.Restored -> BackupStep.Restored
                    is RestoreResult.Changed -> questionOf(restored.backup)
                    is RestoreResult.Refused -> BackupStep.Refused(refusalOf(restored.answer))
                }
            } catch (_: UnreadableBackupException) {
                BackupStep.Unreadable
            } catch (_: BackupStagingException) {
                BackupStep.NoRoom
            } catch (_: SQLException) {
                // The database refused the restore's writes, as on a full disk: its transaction rolled back.
                BackupStep.NoRoom
            } catch (_: IOException) {
                BackupStep.NotRead
            }
        }

    /** The question before a restore of [backup]: when it was made, in the phone's time zone now, and what it holds. */
    private fun questionOf(backup: BackupSummary): BackupStep.Question = BackupStep.Question(
        LocalDateTime.ofInstant(Instant.ofEpochMilli(backup.madeAt), zone()),
        notesOf(backup),
        backup.files,
        backup,
    )

    /** How many notes a backup holds, without the deleted ones. */
    private fun notesOf(backup: BackupSummary): Long = backup.notDeleted[NoteEntity.TABLE] ?: 0L

    private fun refusalOf(answer: BackupAnswer): BackupRefusal = when (answer) {
        BackupAnswer.NotABackup -> BackupRefusal.NotABackup
        BackupAnswer.NewerVersion -> BackupRefusal.NewerVersion
        is BackupAnswer.OtherApp -> BackupRefusal.OtherApp(answer.appName)
        is BackupAnswer.OtherRecoveryKey -> BackupRefusal.OtherRecoveryKey(answer.keyId.toString())
        BackupAnswer.NoKeysNow -> BackupRefusal.NoKeys
        BackupAnswer.Damaged -> BackupRefusal.Damaged
    }

    private companion object {
        /** The whole percent of [progress], rounded down so that 100 means done, or null while its total is not known. */
        fun percentOf(progress: BackupProgress): Int? = progress.fraction?.let { floor(it * PERCENT).toInt() }

        const val PERCENT = 100.0
    }
}
