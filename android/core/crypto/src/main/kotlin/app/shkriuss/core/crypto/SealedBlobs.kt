package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import java.security.GeneralSecurityException

/**
 * Sealed records (kind 1) and wrapped file keys (kind 4): the header, then
 * exactly what Tink's AEAD returns for an XChaCha20-Poly1305 key of variant
 * `TINK`. That is the byte `01`, the four-byte key ID, a 24-byte nonce, the
 * ciphertext and a 16-byte tag.
 */
internal object SealedBlobs {
    private const val TINK_PREFIX: Byte = 1
    private const val KEY_ID_OFFSET = Header.SIZE + 1
    private const val SMALLEST = Header.SIZE + 1 + 4 + 24 + 16

    /** Seals [plaintext] with the keyset's primary key. Tink makes the nonce. */
    fun seal(kind: BlobKind, keyset: KeysetHandle, associatedData: ByteArray, plaintext: ByteArray): ByteArray =
        Header.of(kind) + KeysetCodec.aead(keyset).encrypt(plaintext, associatedData)

    /**
     * The ID of the key that sealed [blob], after the header is checked.
     * Throws [BlobException] if the blob cannot be one of [kind].
     */
    fun keyIdOf(kind: BlobKind, blob: ByteArray): KeyId {
        Header.check(blob, blob.size, kind)
        if (blob.size < SMALLEST || blob[Header.SIZE] != TINK_PREFIX) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }
        return KeyId.fromBytes(blob, KEY_ID_OFFSET)
    }

    /**
     * Opens [blob]. Throws [BlobException]: "needs another recovery key"
     * with the key ID if the keyset has no key of that ID, "damaged or
     * changed" if Tink refuses the blob.
     */
    fun open(kind: BlobKind, keyset: KeysetHandle, associatedData: ByteArray, blob: ByteArray): ByteArray {
        val keyId = keyIdOf(kind, blob)
        if (keyId !in KeysetCodec.keyIds(keyset)) {
            throw BlobException(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, keyId)
        }
        try {
            return KeysetCodec.aead(keyset).decrypt(blob.copyOfRange(Header.SIZE, blob.size), associatedData)
        } catch (_: GeneralSecurityException) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }
    }
}
