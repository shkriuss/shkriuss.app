package app.shkriuss.core.backup

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BackupCrypto
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.data.Clock
import java.io.BufferedOutputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Writes, checks and restores a backup on plain streams, in the order
 * docs/architecture/backup-format.md gives. [Backups] puts the system file
 * picker's documents around it.
 *
 * It adds no cryptography. The stream comes from [crypto], with the backup
 * header as its context.
 */
internal class BackupEngine(
    private val crypto: BackupCrypto,
    private val appName: AppName,
    private val content: BackupContent,
    private val staging: BackupStaging,
    private val clock: Clock,
) {
    init {
        require(BackupFormat.isAppName(appName.value)) { "The app name does not fit into a backup header" }
    }

    /**
     * Writes a backup. [open] is called only when a backup can be made,
     * and gives the place to write to, which is closed here. If this
     * throws, or the result is not [ExportResult.Written], what was
     * written is not a backup and never passes a check.
     */
    suspend fun write(open: () -> OutputStream): ExportResult {
        if (!crypto.mayMakeBackup()) return ExportResult.NotReady
        val header = try {
            BackupHeader.of(crypto.keyId(), appName.value)
        } catch (_: BlobException) {
            return ExportResult.NoKeysNow
        }

        val document = open()
        var whole = false
        try {
            document.write(header.bytes)
            val encrypting = try {
                crypto.encryptingStream(header.bytes, document)
            } catch (_: BlobException) {
                return ExportResult.NoKeysNow
            }
            val body = DataOutputStream(BufferedOutputStream(encrypting, BackupFormat.COPY_BUFFER))
            val writer = BackupWriter(body)
            writer.manifest(content.dataVersion, clock.nowMillis())
            content.list(writer)
            writer.end()
            // Closing writes the last segment. Only now is the stream whole.
            body.close()
            whole = true
            return ExportResult.Written(writer.records, writer.files, writer.filesLeftOut)
        } finally {
            // A backup that failed is left cut: its stream is never closed as a whole one.
            if (!whole) runCatching { document.close() }
        }
    }

    /** Checks the backup in [input] as a restore would, and changes nothing. */
    suspend fun check(input: InputStream): CheckResult = try {
        CheckResult.Good(read(input, NoSink))
    } catch (refused: BackupRefused) {
        CheckResult.Refused(refused.answer)
    }

    /**
     * Restores the backup in [input]. The whole of it is read, checked and
     * put aside first. Only then does the app's own code get it.
     */
    suspend fun restore(input: InputStream): RestoreResult {
        val staged = staging.newRun()
        try {
            val summary = try {
                read(input, staged)
            } catch (refused: BackupRefused) {
                return RestoreResult.Refused(refused.answer)
            }
            staged.finish()
            content.restore(staged.checked(summary))
            return RestoreResult.Restored(summary)
        } finally {
            staged.delete()
        }
    }

    /**
     * Reads a backup to its end into [sink] and checks every rule. Throws
     * [BackupRefused] with the answer of the first rule that does not
     * hold. A read of [input] that fails stays the failure it was.
     */
    private suspend fun read(input: InputStream, sink: BodySink): BackupSummary {
        val header = BackupHeader.read(input)
        if (header.appName != appName.value) throw BackupRefused(BackupAnswer.OtherApp(header.appName))
        val hasKey = try {
            crypto.hasKey(header.keyId)
        } catch (_: BlobException) {
            throw BackupRefused(BackupAnswer.NoKeysNow)
        }
        if (!hasKey) throw BackupRefused(BackupAnswer.OtherRecoveryKey(header.keyId))

        val summary = try {
            val body = crypto.decryptingStream(header.bytes, input).buffered(BackupFormat.COPY_BUFFER)
            BackupReader(body).read(sink)
        } catch (refused: BlobException) {
            throw BackupRefused(answerOf(refused.answer))
        }
        if (summary.dataVersion > content.dataVersion) throw BackupRefused(BackupAnswer.NewerVersion)
        return summary
    }

    /**
     * What an answer of `core/crypto` about the stream means for the
     * backup. After a good backup header, a stream that is not a backup
     * stream is a damaged file.
     */
    private fun answerOf(answer: BlobAnswer): BackupAnswer = when (answer) {
        BlobAnswer.MADE_BY_A_NEWER_VERSION -> BackupAnswer.NewerVersion
        BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW -> BackupAnswer.NoKeysNow
        BlobAnswer.NOT_ONE_OF_OURS,
        BlobAnswer.WRONG_KIND,
        BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY,
        BlobAnswer.DAMAGED_OR_CHANGED,
        -> BackupAnswer.Damaged
    }
}
