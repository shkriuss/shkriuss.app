package app.shkriuss.core.backup

import app.shkriuss.core.crypto.KeyId
import java.io.IOException

/**
 * What a check or a restore says about a file it does not take. These are
 * the answers of docs/architecture/backup-format.md, and nothing more
 * detailed. A screen turns each one into a sentence.
 *
 * No answer holds a record's content, a file's bytes or a key.
 */
sealed class BackupAnswer {
    /** The file does not start with the letters of a backup of the suite. */
    data object NotABackup : BackupAnswer()

    /**
     * A newer version of the app made it: the format version, the version
     * of the encrypted stream or the app's data version is higher than
     * this app knows.
     */
    data object NewerVersion : BackupAnswer()

    /** It is a backup of another app, named [appName] in the file. */
    data class OtherApp(val appName: String) : BackupAnswer()

    /** It was made with a recovery key this app does not have. [keyId] names that key. */
    data class OtherRecoveryKey(val keyId: KeyId) : BackupAnswer()

    /** The app has no backup keys yet, or cannot use them now, for example while the phone is locked. */
    data object NoKeysNow : BackupAnswer()

    /** The file is cut, changed, or breaks a rule of the format. */
    data object Damaged : BackupAnswer()
}

/** What a good backup says about itself. It is read from inside the file, after the file was checked. */
data class BackupSummary(
    /** The data version of the app that made the backup. */
    val dataVersion: Int,
    /** When the backup was made, in milliseconds since 1970-01-01T00:00:00Z. */
    val madeAt: Long,
    /** How many records it holds, deleted ones included. */
    val records: Long,
    /** How many files it holds. */
    val files: Long,
)

/** How writing a backup ended. A failed write of the document is not a result: it throws. */
sealed class ExportResult {
    /**
     * The backup is written. It holds [records] records and [files]
     * files. [filesLeftOut] files are not on this device and are not in
     * this backup. The file itself does not say that number.
     */
    data class Written(val records: Long, val files: Long, val filesLeftOut: Long) : ExportResult()

    /**
     * No backup can be made yet: the app has no keys from a recovery key,
     * or some file keys are still sealed by the key it had before.
     * Nothing was written.
     */
    data object NotReady : ExportResult()

    /** The backup keys cannot be used now, for example while the phone is locked. No backup was made. */
    data object NoKeysNow : ExportResult()
}

/** What a check of a backup found. The check changes nothing. */
sealed class CheckResult {
    /** The file is a whole backup of this app that this app can restore. */
    data class Good(val backup: BackupSummary) : CheckResult()

    /** The file is not taken. A restore would give the same [answer]. */
    data class Refused(val answer: BackupAnswer) : CheckResult()
}

/** How a restore ended. */
sealed class RestoreResult {
    /** The whole file was checked, and the app has taken its records and files. */
    data class Restored(val backup: BackupSummary) : RestoreResult()

    /** The file is not taken. Nothing in the app changed. */
    data class Refused(val answer: BackupAnswer) : RestoreResult()
}

/**
 * A restore could not put the backup aside in the app's own storage, for
 * example because the phone has no room. Nothing in the app changed.
 *
 * It is an [IOException], and so is a failed read of the document. Catch
 * this one first to tell the two apart.
 */
class BackupStagingException internal constructor(cause: IOException) :
    IOException("The backup could not be put aside in the app's storage", cause)

/** Stops the reading of a backup with the [answer] to give. Never leaves `core/backup`. */
internal class BackupRefused(val answer: BackupAnswer) : Exception()
