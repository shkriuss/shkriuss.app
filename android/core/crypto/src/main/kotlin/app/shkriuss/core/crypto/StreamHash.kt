package app.shkriuss.core.crypto

import java.io.InputStream
import java.security.MessageDigest

/**
 * The SHA-256 of a file's stored stream, which names the stream in sync
 * (crypto-design.md, "Where Android does the work, not Tink";
 * sync-protocol.md, "Files"). The stream is ciphertext already: the hash
 * is not a secret, and it opens nothing.
 */
object StreamHash {
    /** The length of a hash in bytes. */
    const val BYTES: Int = 32

    /** The SHA-256 of everything [input] holds, read to its end. The caller closes [input]. */
    fun of(input: InputStream): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest()
    }
}
