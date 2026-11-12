package app.shkriuss.core.crypto

import java.io.ByteArrayOutputStream
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * A second, separate build of the stream layout of kinds 2 and 3, for the
 * vectors. Tink cannot be told which salt and nonce prefix to use, so the
 * tests build the blobs of crypto-design.md here, from HMAC and AES-GCM
 * alone, and then let the module open them.
 *
 * The layout ("Kind 2: file stream"): the header, the byte `28`, a 32-byte
 * salt, a 7-byte nonce prefix, then segments. The stream key is
 * HKDF-SHA256 of the key with the salt and the associated data. Segment i
 * is AES-256-GCM with the nonce prefix, i as 4 bytes, and `01` for the
 * last segment or `00`. A segment of ciphertext is 1 MiB with its tag, and
 * the first one also holds the 40 bytes before it.
 */
internal object ReferenceStream {
    private const val SEGMENT = 1_048_576
    private const val TAG = 16
    private const val TINK_HEADER = 40

    /** The whole blob for [plaintext]. */
    fun build(
        kind: BlobKind,
        key: ByteArray,
        salt: ByteArray,
        noncePrefix: ByteArray,
        associatedData: ByteArray,
        plaintext: ByteArray,
    ): ByteArray {
        val streamKey = SecretKeySpec(streamKey(key, salt, associatedData), "AES")
        val blob = ByteArrayOutputStream()
        blob.write(Header.of(kind))
        blob.write(TINK_HEADER)
        blob.write(salt)
        blob.write(noncePrefix)
        var offset = 0
        var segment = 0
        var room = SEGMENT - TINK_HEADER - TAG
        do {
            val end = minOf(plaintext.size, offset + room)
            val last = end == plaintext.size
            val nonce = noncePrefix + byteArrayOf(
                (segment ushr 24).toByte(),
                (segment ushr 16).toByte(),
                (segment ushr 8).toByte(),
                segment.toByte(),
                if (last) 1 else 0,
            )
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, streamKey, GCMParameterSpec(8 * TAG, nonce))
            blob.write(cipher.doFinal(plaintext, offset, end - offset))
            offset = end
            segment++
            room = SEGMENT - TAG
        } while (!last)
        return blob.toByteArray()
    }

    /** HKDF-SHA256 (RFC 5869) of [key] with [salt] and [info], 32 bytes, from HMAC alone. */
    fun streamKey(key: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val pseudoRandomKey = hmac(salt, key)
        return hmac(pseudoRandomKey, info + 1)
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }
}
