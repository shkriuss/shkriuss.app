package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.GeneralSecurityException

/**
 * File streams (kind 2) and backup streams (kind 3): the header, then
 * exactly what Tink's streaming AEAD writes for `AES256_GCM_HKDF_1MB`.
 * Tink sees the stream starting at byte 5.
 */
internal object Streams {
    /**
     * Writes the header to [output] and returns the stream that encrypts
     * what is written to it. Closing it writes the last segment and closes
     * [output]. A stream that is not closed is not whole.
     */
    fun encrypting(kind: BlobKind, keyset: KeysetHandle, associatedData: ByteArray, output: OutputStream): OutputStream {
        val streamingAead = KeysetCodec.streamingAead(keyset)
        output.write(Header.of(kind))
        try {
            return streamingAead.newEncryptingStream(output, associatedData)
        } catch (_: GeneralSecurityException) {
            throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        }
    }

    /**
     * Checks the header of [input] and returns the stream that decrypts
     * the rest. Each segment is released only after its tag is checked. A
     * damaged, cut or swapped segment makes the read fail with
     * [BlobException] "damaged or changed", at that segment. So what was
     * read counts as whole only when the stream has ended without an error.
     */
    fun decrypting(kind: BlobKind, keyset: KeysetHandle, associatedData: ByteArray, input: InputStream): InputStream {
        val streamingAead = KeysetCodec.streamingAead(keyset)
        val source = Source(input)
        val header = ByteArray(Header.SIZE)
        Header.check(header, source.readNBytes(header, 0, header.size), kind)
        try {
            return Decrypted(streamingAead.newDecryptingStream(source, associatedData), source)
        } catch (_: GeneralSecurityException) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }
    }

    /**
     * Remembers a failure of the underlying storage. Tink reports every
     * failure while it reads as a damaged stream, also a failed disk read.
     * With this, a failed read stays a failed read.
     */
    private class Source(input: InputStream) : FilterInputStream(input) {
        var failure: IOException? = null

        override fun read(): Int = remember { super.read() }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = remember { super.read(buffer, offset, length) }

        override fun skip(count: Long): Long = remember { super.skip(count) }

        private inline fun <T> remember(read: () -> T): T {
            try {
                return read()
            } catch (failed: IOException) {
                failure = failed
                throw failed
            }
        }
    }

    /** Turns every refusal of Tink into the one answer "damaged or changed". */
    private class Decrypted(decrypting: InputStream, private val source: Source) : FilterInputStream(decrypting) {
        override fun read(): Int = answer { super.read() }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = answer { super.read(buffer, offset, length) }

        override fun skip(count: Long): Long = answer { super.skip(count) }

        override fun available(): Int = answer { super.available() }

        /** A stream that only decrypts keeps no place to go back to. */
        override fun markSupported(): Boolean = false

        private inline fun <T> answer(read: () -> T): T {
            try {
                return read()
            } catch (_: IOException) {
                throw source.failure ?: BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            }
        }
    }
}
