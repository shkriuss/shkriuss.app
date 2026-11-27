package app.shkriuss.core.crypto

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Test

/** The hash that names a stream in sync is SHA-256, also over many reads of a long stream. */
class StreamHashTest {
    @Test
    fun theHashIsSha256() {
        // FIPS 180-2, appendix B.1 and B.3.
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex(StreamHash.of(ByteArrayInputStream("abc".toByteArray()))))
        val million = ByteArrayInputStream(ByteArray(1_000_000) { 'a'.code.toByte() })
        assertEquals("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", hex(StreamHash.of(million)))
        assertEquals(StreamHash.BYTES, StreamHash.of(ByteArrayInputStream(ByteArray(0))).size)
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
