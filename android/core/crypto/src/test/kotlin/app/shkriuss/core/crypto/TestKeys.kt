package app.shkriuss.core.crypto

import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.aead.XChaCha20Poly1305Key
import com.google.crypto.tink.streamingaead.AesGcmHkdfStreamingKey
import com.google.crypto.tink.streamingaead.AesGcmHkdfStreamingParameters
import com.google.crypto.tink.util.SecretBytes
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Values and small helpers that many tests of this module share. */
internal object TestKeys {
    /** The app name of every vector in crypto-design.md. */
    val water: AppName = AppName.of("water")

    /** The recovery key of the vectors in crypto-design.md: the bytes 00 to 1f. */
    fun vectorRecoveryKey(): RecoveryKey = RecoveryKey.ofBytes(ByteArray(32) { it.toByte() })

    /** A `recovery` keyset with one recovery key. */
    fun recoveryKeyset(key: RecoveryKey): KeysetHandle = RecoveryKeyDeriver.recoveryKeyset(listOf(key), key)

    /** The three keysets of the app `water` for one recovery key. */
    fun derived(key: RecoveryKey): DerivedKeysets = RecoveryKeyDeriver.derive(recoveryKeyset(key), water)

    /** The raw bytes of every key in a keyset, in order, as hex. */
    fun keyBytes(keyset: KeysetHandle): List<String> = (0 until keyset.size()).map { index ->
        val secret = when (val key = keyset.getAt(index).key) {
            is XChaCha20Poly1305Key -> key.keyBytes
            is AesGcmHkdfStreamingKey -> key.initialKeyMaterial
            else -> error("unexpected key type")
        }
        secret.toByteArray(InsecureSecretKeyAccess.get()).toHex()
    }

    /** A file key with known bytes and a known key ID, as the vectors use it. */
    fun fileKeyOf(bytes: ByteArray, id: Int): FileKey {
        val key = AesGcmHkdfStreamingKey.create(
            KeysetType.STREAMING.parameters as AesGcmHkdfStreamingParameters,
            SecretBytes.copyFrom(bytes, InsecureSecretKeyAccess.get()),
        )
        val keyset = KeysetHandle.newBuilder().addEntry(KeysetHandle.importKey(key).withFixedId(id).makePrimary()).build()
        return FileKey(keyset)
    }

    /** The plaintext of the long stream vectors: byte number i is i mod 251. */
    fun pattern(size: Int): ByteArray = ByteArray(size) { (it % 251).toByte() }

    /** SHA-256 as hex. */
    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    /** Encrypts [plaintext] as the file [fileId] and returns the whole blob. */
    fun encryptFile(key: FileKey, fileId: String, plaintext: ByteArray): ByteArray {
        val blob = ByteArrayOutputStream()
        key.encryptingStream(fileId, blob).use { it.write(plaintext) }
        return blob.toByteArray()
    }

    /** Decrypts a whole file blob. Throws what the stream throws. */
    fun decryptFile(key: FileKey, fileId: String, blob: ByteArray): ByteArray =
        key.decryptingStream(fileId, ByteArrayInputStream(blob)).use { it.readBytes() }

    /** The answer a failing [block] gives, or null if it does not fail with a [BlobException]. */
    fun answerOf(block: () -> Unit): BlobAnswer? = try {
        block()
        null
    } catch (refused: BlobException) {
        refused.answer
    }
}
