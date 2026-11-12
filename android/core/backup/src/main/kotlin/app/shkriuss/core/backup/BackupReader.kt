package app.shkriuss.core.backup

import java.io.InputStream

/**
 * Where a reader puts what it reads from the body of a backup: into the
 * staging folder for a restore, nowhere for a check. Nothing here is the
 * app's own data yet.
 */
internal interface BodySink {
    fun record(record: BackupRecord)

    /** Takes the file with the ID [id]. [content] ends after the file's last byte. */
    suspend fun file(id: String, content: BoundedInput)
}

/** Reads the body and keeps nothing. A check uses it. */
internal object NoSink : BodySink {
    override fun record(record: BackupRecord) = Unit

    override suspend fun file(id: String, content: BoundedInput) = Unit
}

/**
 * Reads the body of a backup from the decrypted stream and checks every
 * rule of "What a reader refuses in the body" in
 * docs/architecture/backup-format.md. It stops with [BackupRefused] at the
 * first rule that does not hold. It never guesses.
 */
internal class BackupReader(input: InputStream) {
    private val body = BodyInput(input)

    /** Reads the whole body into [sink]. Returns only when the body ended right after a good End. */
    suspend fun read(sink: BodySink): BackupSummary {
        if (body.tag() != BackupFormat.TAG_MANIFEST) damaged()
        val dataVersion = body.int()
        if (dataVersion < 1) damaged()
        val madeAt = body.long()

        var records = 0L
        var files = 0L
        while (true) {
            when (body.tag()) {
                BackupFormat.TAG_RECORD -> {
                    if (files > 0) damaged()
                    sink.record(RecordEntry.read(body))
                    records++
                }
                BackupFormat.TAG_FILE -> {
                    readFile(sink)
                    files++
                }
                BackupFormat.TAG_END -> {
                    readEnd(records, files)
                    return BackupSummary(dataVersion, madeAt, records, files)
                }
                // A second Manifest, a tag that is not known, and a body that ends before End.
                else -> damaged()
            }
        }
    }

    private suspend fun readFile(sink: BodySink) {
        val id = BackupIds.toText(body.bytes(BackupIds.BYTES))
        val length = body.long()
        if (length < 0) damaged()
        val content = body.stream(length)
        sink.file(id, content)
        content.skipRest()
    }

    private fun readEnd(records: Long, files: Long) {
        if (body.long() != records) damaged()
        if (body.long() != files) damaged()
        if (body.tag() >= 0) damaged()
    }
}
