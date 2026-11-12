package app.shkriuss.core.backup

import app.shkriuss.core.testing.TestIdSource
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A very large file is never held in memory (item 6 of "What the tests
 * must cover" in backup-format.md). Three proofs:
 *
 * 1. A file longer than all the memory the test may use goes into a
 *    backup and through the check. Nothing is stored, so it needs no
 *    disk. Neither the writer nor the reader can have held the file.
 * 2. While a backup is written, the bytes taken from a file never run
 *    more than a few megabytes ahead of the bytes written to the document.
 * 3. While a backup is restored, the bytes read from the document never
 *    run more than a few megabytes ahead of the bytes put into staging.
 */
class LargeFileTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val fileId = TestIdSource.idNumber(1)

    /** An app with one record and one file of [size] bytes, which is made while it is read. */
    private fun appWithOneFile(size: Long, source: (Long) -> InputStream = { PatternStream(it) }) = object : BackupContent {
        override val dataVersion = 1

        override suspend fun list(into: BackupSink) {
            into.record(record(1, type = "file"))
            into.file(fileId, size, source(size))
        }

        override suspend fun restore(from: CheckedBackup) = error("not restored in this test")
    }

    private fun engineFor(device: Device, content: BackupContent) =
        BackupEngine(device.keys.crypto.backups, WATER, content, BackupStaging(device.stagingFolder), device.clock)

    @Test(timeout = 600_000)
    fun aFileLargerThanMemoryGoesIntoABackupAndThroughTheCheck() {
        val size = Runtime.getRuntime().maxMemory() + 2 * MIB + 17
        assertTrue(size > Runtime.getRuntime().maxMemory())
        val device = Device(temporary).also { it.giveKeys() }
        val engine = engineFor(device, appWithOneFile(size))
        val pipe = Pipe()

        var written: Result<ExportResult>? = null
        val writer = thread { written = runCatching { runBlocking { engine.write { pipe.output } } } }
        val checked = pipe.input.use { runBlocking { engine.check(it) } }
        writer.join()

        assertEquals(ExportResult.Written(records = 1, files = 1, filesLeftOut = 0), written?.getOrThrow())
        val summary = BackupSummary(dataVersion = 1, madeAt = device.clock.nowMillis, records = 1, files = 1)
        assertEquals(CheckResult.Good(summary), checked)
        val body = 13 + (39 + 4 + "content 1".length) + (25 + size) + 17
        assertEquals("every byte of the backup went through the pipe", expectedFileSize(body), pipe.bytesRead)
        assertEquals("nothing was put aside", emptyList<String>(), device.stagingFolder.list().orEmpty().toList())
    }

    @Test
    fun aBackupIsWrittenWithoutHoldingAFile() {
        val size = 64L * MIB
        val device = Device(temporary).also { it.giveKeys() }
        var taken = 0L
        var largestLead = 0L
        val document = object : OutputStream() {
            var written = 0L

            override fun write(value: Int) {
                written++
            }

            override fun write(source: ByteArray, offset: Int, length: Int) {
                written += length
            }
        }
        // Before every read of the file: how much of it is on its way and not yet in the document.
        val watched = { length: Long ->
            object : PatternStream(length) {
                override fun read(target: ByteArray, offset: Int, count: Int): Int {
                    largestLead = maxOf(largestLead, taken - document.written)
                    return super.read(target, offset, count).also { if (it > 0) taken += it }
                }
            }
        }

        val result = runBlocking { engineFor(device, appWithOneFile(size, watched)).write { document } }

        assertEquals(ExportResult.Written(records = 1, files = 1, filesLeftOut = 0), result)
        assertEquals(size, taken)
        assertTrue("the file ran $largestLead bytes ahead of the document", largestLead in 1..LARGEST_LEAD)
    }

    @Test
    fun aBackupIsRestoredWithoutHoldingAFile() {
        val size = 64 * MIB.toInt()
        val maker = Device(temporary)
        val recoveryKey = maker.giveKeys()
        val made = ByteArrayOutputStream(size + MIB.toInt())
        runBlocking { engineFor(maker, appWithOneFile(size.toLong())).write { made } }
        val file = made.toByteArray()

        val device = Device(temporary)
        device.giveKeys(recoveryKey)
        var read = 0L
        var largestLead = 0L
        // Before every read of the document: how much of it was read and is not yet in staging.
        val document = object : ByteArrayInputStream(file) {
            override fun read(): Int = super.read().also { if (it >= 0) read++ }

            override fun read(target: ByteArray, offset: Int, count: Int): Int {
                largestLead = maxOf(largestLead, read - bytesIn(device.stagingFolder))
                return super.read(target, offset, count).also { if (it > 0) read += it }
            }
        }

        val result = runBlocking { device.engine.restore(document) }

        assertTrue("$result", result is RestoreResult.Restored)
        assertEquals(file.size.toLong(), read)
        assertTrue("the document ran $largestLead bytes ahead of staging", largestLead in 1..LARGEST_LEAD)
        assertEquals(listOf(fileId), device.app.fileIds())
        assertEquals(sha256Of(PatternStream(size.toLong())), device.app.snapshot().getValue("file $fileId"))
        assertEquals("nothing is left in staging", 0L, bytesIn(device.stagingFolder))
    }

    /** The bytes of every file under [folder]. */
    private fun bytesIn(folder: File): Long = folder.walkTopDown().filter { it.isFile }.sumOf { it.length() }

    private fun sha256Of(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(1 shl 16)
        while (true) {
            val count = stream.read(buffer, 0, buffer.size)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
        return digest.digest().toHex()
    }

    /** A file of [size] bytes that is made while it is read: byte number i is i mod 251. Nothing but one small block is held. */
    private open class PatternStream(private val size: Long) : InputStream() {
        private var position = 0L

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(target: ByteArray, offset: Int, count: Int): Int {
            if (count == 0) return 0
            if (position == size) return -1
            val from = (position % BLOCK.size).toInt()
            val length = minOf(count.toLong(), size - position, (BLOCK.size - from).toLong()).toInt()
            System.arraycopy(BLOCK, from, target, offset, length)
            position += length
            return length
        }

        private companion object {
            /** A whole number of rounds of the pattern, so the pattern goes on at every block start. */
            val BLOCK = pattern(251 * 1_024)
        }
    }

    /**
     * Joins a writer and a reader that run at the same time. At most
     * [QUEUED] chunks wait between them, so the backup is never held here
     * either. If the reader goes away, the writer fails instead of waiting
     * for ever.
     */
    private class Pipe {
        private val queue = ArrayBlockingQueue<ByteArray>(QUEUED)

        @Volatile
        private var readerGone = false

        /** How many bytes the reader took. */
        @Volatile
        var bytesRead = 0L
            private set

        val output: OutputStream = object : OutputStream() {
            override fun write(value: Int) = put(byteArrayOf(value.toByte()))

            override fun write(source: ByteArray, offset: Int, length: Int) {
                if (length > 0) put(source.copyOfRange(offset, offset + length))
            }

            override fun close() = put(END)
        }

        val input: InputStream = object : InputStream() {
            private var chunk = ByteArray(0)
            private var at = 0
            private var ended = false

            override fun read(): Int {
                val one = ByteArray(1)
                return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
            }

            override fun read(target: ByteArray, offset: Int, count: Int): Int {
                if (count == 0) return 0
                while (at == chunk.size) {
                    if (ended) return -1
                    val next = queue.take()
                    if (next === END) {
                        ended = true
                        return -1
                    }
                    chunk = next
                    at = 0
                }
                val length = minOf(count, chunk.size - at)
                System.arraycopy(chunk, at, target, offset, length)
                at += length
                bytesRead += length
                return length
            }

            override fun close() {
                readerGone = true
            }
        }

        private fun put(chunk: ByteArray) {
            while (!queue.offer(chunk, 200, TimeUnit.MILLISECONDS)) {
                if (readerGone) throw IOException("The reader of the pipe went away")
            }
        }

        private companion object {
            const val QUEUED = 8
            val END = ByteArray(0)
        }
    }

    private companion object {
        const val MIB = 1_048_576L

        /**
         * The most that may be on its way at one moment: one segment of the
         * stream and the copy buffers, with room to spare. A file that was
         * held would be 64 MiB ahead.
         */
        const val LARGEST_LEAD = 4 * MIB

        fun expectedFileSize(body: Long): Long {
            val segments = if (body <= 1_048_520) 1 else 1 + (body - 1_048_520 + 1_048_560 - 1) / 1_048_560
            return 17 + 5 + 40 + body + 16 * segments
        }
    }
}
