package app.shkriuss.feature.tasks

import android.database.SQLException
import android.net.Uri
import app.shkriuss.core.backup.BackupAnswer
import app.shkriuss.core.backup.BackupDocuments
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
import app.shkriuss.feature.tasks.data.TaskEntity
import java.io.IOException
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Where the recovery key of the app stands (docs/apps/water/spec.md, "What Settings shows before it", as Tasks' spec says). */
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

/** Why Tasks does not take a file, as docs/user/backup.md names it ("If the app does not take a file"). */
sealed interface BackupRefusal {
    /** The file is something else, for example a photo. */
    data object NotABackup : BackupRefusal

    /** A newer version of Tasks made it. */
    data object NewerVersion : BackupRefusal

    /** It is a backup of the app [name]. */
    data class OtherApp(val name: String) : BackupRefusal

    /** It was made with other recovery words. [shortName] is the short name of the key it needs. */
    data class OtherRecoveryKey(val shortName: String) : BackupRefusal

    /** Tasks has no keys from a recovery key, or cannot use them now. */
    data object NoKeys : BackupRefusal

    /** The file is cut short or was changed. */
    data object Damaged : BackupRefusal
}

/**
 * Where a backup or a restore stands, or how it ended
 * (docs/apps/water/spec.md, "Backup and restore screens", as
 * docs/apps/tasks/spec.md, "As in Water and Reminders", says). Each is one dialog.
 * No step holds a title, a record or a file name.
 */
sealed interface BackupStep {
    /** "Writing the backup". */
    data object Writing : BackupStep

    /** "Checking the backup": the file just written, or the file picked for a restore. */
    data object Checking : BackupStep

    /** "Restoring the backup". */
    data object Restoring : BackupStep

    /** The backup is written, and the file was read again and is whole. It holds [tasks] tasks that are not deleted. */
    data class Written(val tasks: Long) : BackupStep

    /** The file was written, but it does not pass the check. It must not be relied on. */
    data object WrittenNotUsable : BackupStep

    /**
     * The backup is written, but it was not checked: the file could not be
     * read again, or what was read is not the backup just written, such as
     * an older copy that a storage app handed back.
     */
    data object WrittenNotChecked : BackupStep

    /** Writing the file failed, for example because the storage is full. */
    data object NotWritten : BackupStep

    /** No backup was made: Tasks cannot use its keys now. */
    data object NoKeys : BackupStep

    /**
     * "Restore this backup?" The file passed the check. It was made at
     * [madeAt], local time, and holds [tasks] tasks. [backup] is
     * what the check read: **Restore** takes only that backup.
     */
    data class Question(val madeAt: LocalDateTime, val tasks: Long, val backup: BackupSummary) : BackupStep

    /** "Backup restored". */
    data object Restored : BackupStep

    /** The file is not taken, for [reason]. Nothing in Tasks changed. */
    data class Refused(val reason: BackupRefusal) : BackupStep

    /** Reading the file failed. Nothing in Tasks changed. */
    data object NotRead : BackupStep

    /** The backup could not be put aside on the phone, for example because there is no room. Nothing in Tasks changed. */
    data object NoRoom : BackupStep

    /** The backup holds something this version of Tasks cannot read. Nothing in Tasks changed. */
    data object Unreadable : BackupStep
}

/**
 * Backup and restore of Tasks, on `Backups` of `core/backup`, as in
 * Water and Reminders (docs/apps/tasks/spec.md, "As in Water and
 * Reminders" and "Backup contents"), and what Settings shows about the
 * keys. `BackupViewModel` turns what it gives into dialogs.
 *
 * - A backup is checked right after it is written: the file is read again
 *   to its last byte, as in Water.
 * - After a restore, each task it took counts from that moment, and the
 *   notifications follow. `TasksBackupContent` hands the tasks it took to
 *   `TasksRepository.afterRestore` as soon as its transaction is written,
 *   inside [restore].
 * - A pending move of the file keys is finished here, in [keys], because
 *   Tasks stores no files (spec, "As in Water and Reminders", files).
 *
 * [work] is where the keys are read, off the main thread: a hardware key
 * can be slow. `Backups` reads and writes on a thread of its own.
 */
class TasksBackups(
    private val backups: Backups,
    private val crypto: ShkCrypto,
    private val time: TasksTime,
    private val clock: Clock,
    private val zone: () -> ZoneId,
    private val work: CoroutineContext,
) {
    private val keysLock = Mutex()

    /**
     * Call once when the app starts. It is `Backups.start()`: it deletes
     * what a restore left in the staging folder when the app stopped in the
     * middle of it.
     */
    fun start() = backups.start()

    /**
     * What Settings shows about the keys now, or null if they cannot be
     * read now. Before it answers, it finishes a pending move of the file
     * keys ([finishPendingFileKeyMove]). Tasks calls it when it starts,
     * each time its screen starts, which is also the way back from a screen
     * of `core/security`, and before it goes on after the recovery key was
     * first needed.
     */
    suspend fun keys(): KeysNow? = withContext(work) {
        keysLock.withLock {
            try {
                finishPendingFileKeyMove()
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

    /**
     * Asks `fileKeyMoveIsPending()`. If it is, and the app has its keys
     * from a recovery key, it finishes the move at once
     * (docs/apps/water/spec.md, "Files", point 3, which Tasks follows).
     * Without those keys the old keyset stays: `core/crypto` refuses to
     * delete it then.
     */
    private fun finishPendingFileKeyMove() {
        if (!crypto.setup.fileKeyMoveIsPending()) return
        if (!crypto.status().hasDerivedKeys) return
        // ONLY BECAUSE TASKS STORES NO FILES (docs/apps/tasks/spec.md, "As in Water and Reminders", files).
        //
        // Tasks may finish a pending move at once only because no row of
        // Tasks holds a wrapped file key. A later version of Tasks
        // that stores files MUST TAKE THIS CALL OUT FIRST. It must seal every
        // file key again under the new `file-key`, as
        // docs/security/crypto-design.md says ("The file-key keyset without a
        // recovery key"), before it calls finishFileKeyMove(). Otherwise the
        // files sealed with the old key can never be opened again: they are
        // lost.
        crypto.setup.finishFileKeyMove()
    }

    /** The name suggested for a new backup, such as `tasks-2026-11-16.shkbackup`. The user may change it. */
    fun suggestedName(): String = BackupDocuments.fileName(TasksServices.APP_NAME, clock.nowMillis(), zone())

    /**
     * Writes a backup into the document [to], and then reads it again and
     * checks everything a restore checks, so that a backup that cannot be
     * restored is found on the day it is made. [checking] runs between the
     * two, so the screen can say so. Returns how it ended.
     */
    suspend fun write(to: Uri, checking: () -> Unit): BackupStep {
        val export = try {
            when (val result = backups.export(to)) {
                is ExportResult.Written -> result
                ExportResult.NotReady, ExportResult.NoKeysNow -> return BackupStep.NoKeys
            }
        } catch (_: IOException) {
            return BackupStep.NotWritten
        }
        checking()
        return checkWritten(to, export)
    }

    /**
     * Reads the document [written] again, right after [export] wrote it.
     * What is read must be that backup: when it was made, to the
     * millisecond, and the same counts. A storage app that hands back an
     * older copy of the document has not let the new one be checked.
     */
    private suspend fun checkWritten(written: Uri, export: ExportResult.Written): BackupStep = try {
        when (val checked = backups.check(written)) {
            is CheckResult.Good ->
                if (export.isThe(checked.backup)) BackupStep.Written(tasksOf(checked.backup)) else BackupStep.WrittenNotChecked
            is CheckResult.Refused -> BackupStep.WrittenNotUsable
        }
    } catch (_: IOException) {
        // Not every storage app lets a file be read right after it was written.
        BackupStep.WrittenNotChecked
    }

    /** Checks the document [picked] before a restore. A good one gives the question, with what the backup says about itself. */
    suspend fun look(picked: Uri): BackupStep = try {
        when (val checked = backups.check(picked)) {
            is CheckResult.Good -> questionOf(checked.backup)
            is CheckResult.Refused -> BackupStep.Refused(refusalOf(checked.answer))
        }
    } catch (_: IOException) {
        BackupStep.NotRead
    }

    /**
     * Restores the document [picked], if it still holds the backup that
     * [question] showed. The tasks it took then count from that
     * moment and the notifications follow (spec, "Backup contents", point
     * 3), inside the restore. The two are one step: it is not cut between
     * them when the screen goes away. If the document now holds another
     * backup, nothing changes, and the answer is the question again, with
     * what the document holds now. If the database refuses the records, as
     * on a full disk, the transaction rolls back and the answer is that the
     * phone has not enough room.
     */
    suspend fun restore(picked: Uri, question: BackupStep.Question): BackupStep = withContext(NonCancellable) {
        try {
            when (val restored = backups.restore(picked, question.backup)) {
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

    /** The question before a restore of [backup]: when it was made, as the phone's clock shows it now, and how many tasks it holds. */
    private fun questionOf(backup: BackupSummary): BackupStep.Question =
        BackupStep.Question(time.reading().local(backup.madeAt), tasksOf(backup), backup)

    /** How many tasks a backup holds, without the deleted ones. */
    private fun tasksOf(backup: BackupSummary): Long = backup.notDeleted[TaskEntity.TABLE] ?: 0L

    private fun refusalOf(answer: BackupAnswer): BackupRefusal = when (answer) {
        BackupAnswer.NotABackup -> BackupRefusal.NotABackup
        BackupAnswer.NewerVersion -> BackupRefusal.NewerVersion
        is BackupAnswer.OtherApp -> BackupRefusal.OtherApp(answer.appName)
        is BackupAnswer.OtherRecoveryKey -> BackupRefusal.OtherRecoveryKey(answer.keyId.toString())
        BackupAnswer.NoKeysNow -> BackupRefusal.NoKeys
        BackupAnswer.Damaged -> BackupRefusal.Damaged
    }
}
