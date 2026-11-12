package app.shkriuss.core.crypto

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A stream larger than memory, encrypted and decrypted without loading it
 * (item 2 of "What the tests must cover" in crypto-design.md). The stream
 * is longer than all the memory the test JVM may use, so it could never be
 * held.
 */
class LargeStreamTest {
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    @Test
    fun aStreamLargerThanMemoryGoesThroughWithoutBeingHeld() {
        val size = Runtime.getRuntime().maxMemory() + 2 * 1_048_576 + 17
        assertTrue(size > Runtime.getRuntime().maxMemory())
        val key = FileKey(KeysetCodec.newRandom(KeysetType.STREAMING))
        val encrypted = EncryptedSource(key, fileId, size)

        val read = MessageDigest.getInstance("SHA-256")
        var count = 0L
        key.decryptingStream(fileId, encrypted).use { stream ->
            val buffer = ByteArray(1 shl 16)
            while (true) {
                val length = stream.read(buffer)
                if (length < 0) break
                read.update(buffer, 0, length)
                count += length
            }
        }

        assertEquals(size, count)
        assertEquals(encrypted.plaintextHash(), read.digest().toHex())
        // 5 + 40 + P, plus 16 for each segment.
        val segments = 1 + (size - 1_048_520 + 1_048_560 - 1) / 1_048_560
        assertEquals(5 + 40 + size + 16 * segments, encrypted.encryptedBytes)
    }

    /**
     * The encrypted file as a stream to read from, made while it is read:
     * each read encrypts a little more plaintext into a small buffer. No
     * thread and no file is needed, and nothing but that buffer is held.
     */
    private class EncryptedSource(key: FileKey, fileId: String, private val size: Long) : InputStream() {
        private val buffer = Buffer()
        private val encrypting: OutputStream = key.encryptingStream(fileId, buffer)
        private val written = MessageDigest.getInstance("SHA-256")
        private val chunk = TestKeys.pattern(251 * 1_024)
        private var plaintextLeft = size
        private var closed = false

        /** How many encrypted bytes were produced. */
        var encryptedBytes = 0L
            private set

        /** The SHA-256 of the plaintext that was encrypted. */
        fun plaintextHash(): String = written.digest().toHex()

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(target: ByteArray, offset: Int, length: Int): Int {
            while (buffer.isEmpty() && !closed) encryptSomeMore()
            if (buffer.isEmpty()) return -1
            return buffer.take(target, offset, length).also { encryptedBytes += it }
        }

        private fun encryptSomeMore() {
            if (plaintextLeft == 0L) {
                encrypting.close()
                closed = true
                return
            }
            val length = minOf(chunk.size.toLong(), plaintextLeft).toInt()
            encrypting.write(chunk, 0, length)
            written.update(chunk, 0, length)
            plaintextLeft -= length
        }
    }

    /** Where the encrypting stream writes to, and the reads take from. */
    private class Buffer : OutputStream() {
        private var bytes = ByteArray(2 * 1_048_576)
        private var start = 0
        private var end = 0

        fun isEmpty(): Boolean = start == end

        fun take(target: ByteArray, offset: Int, length: Int): Int {
            val count = minOf(length, end - start)
            System.arraycopy(bytes, start, target, offset, count)
            start += count
            if (start == end) {
                start = 0
                end = 0
            }
            return count
        }

        override fun write(value: Int) = write(byteArrayOf(value.toByte()), 0, 1)

        override fun write(source: ByteArray, offset: Int, length: Int) {
            if (end + length > bytes.size) bytes = bytes.copyOf(maxOf(2 * bytes.size, end + length))
            System.arraycopy(source, offset, bytes, end, length)
            end += length
        }
    }
}
