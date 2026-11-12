package app.shkriuss.core.crypto

import com.google.crypto.tink.Aead
import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.KeyStatus
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.Parameters
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.StreamingAead
import com.google.crypto.tink.TinkProtoKeysetFormat
import com.google.crypto.tink.aead.XChaCha20Poly1305Parameters
import com.google.crypto.tink.prf.HkdfPrfParameters
import com.google.crypto.tink.streamingaead.PredefinedStreamingAeadParameters
import java.security.GeneralSecurityException

/**
 * The three kinds of Tink key this module stores in keysets, with the
 * exact parameters of the table "Keysets" in crypto-design.md.
 */
internal enum class KeysetType(val parameters: Parameters) {
    /** `XChaCha20Poly1305Key`, variant `TINK`: seals records and file keys. */
    SEALING(XChaCha20Poly1305Parameters.create(XChaCha20Poly1305Parameters.Variant.TINK)),

    /** `AesGcmHkdfStreamingKey`, `AES256_GCM_HKDF_1MB`: files and backups. */
    STREAMING(PredefinedStreamingAeadParameters.AES256_GCM_HKDF_1MB),

    /** `HkdfPrfKey`: HKDF-SHA256, a 32-byte key, no salt. Its key is a recovery key. */
    RECOVERY(
        HkdfPrfParameters.builder()
            .setKeySizeBytes(KeysetCodec.KEY_BYTES)
            .setHashType(HkdfPrfParameters.HashType.SHA256)
            .build(),
    ),
}

/**
 * Turns Tink keysets into bytes and back, makes new ones, and builds the
 * Tink primitives. After a keyset is read, it is checked: it may hold only
 * keys of the expected type and parameters. Anything else is refused.
 */
internal object KeysetCodec {
    /** Every key of this module is 32 bytes long. */
    const val KEY_BYTES = 32

    /** The keyset as Tink's binary keyset. The bytes hold the keys in the clear. */
    fun serialize(keyset: KeysetHandle): ByteArray {
        TinkSetup.ready()
        return TinkProtoKeysetFormat.serializeKeyset(keyset, InsecureSecretKeyAccess.get(), RegistryConfiguration.get())
    }

    /**
     * Reads Tink's binary keyset and checks that it holds only enabled keys
     * of [type], and a primary. A file key holds exactly [exactCount] 1 key.
     * Throws [BlobException] "damaged or changed" for anything else.
     */
    fun parse(bytes: ByteArray, type: KeysetType, exactCount: Int? = null): KeysetHandle {
        TinkSetup.ready()
        try {
            val keyset =
                TinkProtoKeysetFormat.parseKeyset(bytes, InsecureSecretKeyAccess.get(), RegistryConfiguration.get())
            check(keyset.size() >= 1 && (exactCount == null || keyset.size() == exactCount))
            for (index in 0 until keyset.size()) {
                val entry = keyset.getAt(index)
                check(entry.status == KeyStatus.ENABLED && entry.key.parameters == type.parameters)
            }
            keyset.primary
            return keyset
        } catch (_: GeneralSecurityException) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        } catch (_: RuntimeException) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }
    }

    /** A keyset with one new random key of [type], with a random ID from Tink. */
    fun newRandom(type: KeysetType): KeysetHandle {
        TinkSetup.ready()
        return KeysetHandle.newBuilder()
            .addEntry(KeysetHandle.generateEntryFromParameters(type.parameters).withRandomId().makePrimary())
            .build()
    }

    /** The IDs of every key in the keyset. */
    fun keyIds(keyset: KeysetHandle): List<KeyId> = (0 until keyset.size()).map { KeyId(keyset.getAt(it).id) }

    /** The ID of the keyset's primary key, the one that encrypts. */
    fun primaryId(keyset: KeysetHandle): KeyId = KeyId(keyset.primary.id)

    /**
     * True if every key of [wanted] is in [stored] under the same ID, and
     * both name the same primary. For keysets from one recovery key this is
     * plain equality.
     */
    fun holdsAll(stored: KeysetHandle, wanted: KeysetHandle): Boolean {
        if (stored.primary.id != wanted.primary.id) return false
        return (0 until wanted.size()).all { index ->
            val entry = wanted.getAt(index)
            (0 until stored.size()).any { stored.getAt(it).id == entry.id && stored.getAt(it).key.equalsKey(entry.key) }
        }
    }

    /** Tink's AEAD for a [KeysetType.SEALING] keyset. */
    fun aead(keyset: KeysetHandle): Aead {
        TinkSetup.ready()
        return keyset.getPrimitive(RegistryConfiguration.get(), Aead::class.java)
    }

    /** Tink's streaming AEAD for a [KeysetType.STREAMING] keyset. */
    fun streamingAead(keyset: KeysetHandle): StreamingAead {
        TinkSetup.ready()
        return keyset.getPrimitive(RegistryConfiguration.get(), StreamingAead::class.java)
    }
}
