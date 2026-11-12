package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.keyderivation.KeysetDeriver
import com.google.crypto.tink.keyderivation.PrfBasedKeyDerivationKey
import com.google.crypto.tink.keyderivation.PrfBasedKeyDerivationParameters
import com.google.crypto.tink.prf.HkdfPrfKey
import com.google.crypto.tink.prf.HkdfPrfParameters

/** The three keysets an app derives from its recovery keys. */
internal class DerivedKeysets(val record: KeysetHandle, val backup: KeysetHandle, val fileKey: KeysetHandle) {
    override fun toString(): String = "DerivedKeysets"
}

/**
 * The `recovery` keyset and what is derived from it ("Deriving keys" in
 * crypto-design.md). A `recovery` keyset holds one `HkdfPrfKey` per
 * recovery key, each under its key ID, and one of them is the primary.
 */
internal object RecoveryKeyDeriver {
    private const val LABEL_PREFIX = "shkriuss.app/v1/"

    /** The `recovery` keyset for these recovery keys, with [primary] as the one new blobs use. */
    fun recoveryKeyset(keys: List<RecoveryKey>, primary: RecoveryKey): KeysetHandle {
        TinkSetup.ready()
        require(keys.any { it.sameKeyAs(primary) }) { "The primary must be one of the keys" }
        val builder = KeysetHandle.newBuilder()
        keys.forEach { key ->
            val entry = KeysetHandle.importKey(key.prfKey).withFixedId(key.keyId.value)
            builder.addEntry(if (key.sameKeyAs(primary)) entry.makePrimary() else entry)
        }
        return builder.build()
    }

    /** The recovery keys of a `recovery` keyset, the primary first. */
    fun recoveryKeys(recovery: KeysetHandle): List<RecoveryKey> {
        val entries = (0 until recovery.size()).map { recovery.getAt(it) }
        return entries.sortedByDescending { it.isPrimary }.map { RecoveryKey(it.key as HkdfPrfKey) }
    }

    /**
     * The `record`, `backup` and `file-key` keysets of [app]. Each derived
     * keyset gets one key per recovery key, with that recovery key's ID and
     * primary flag. Throws for an app that holds no data keys.
     */
    fun derive(recovery: KeysetHandle, app: AppName): DerivedKeysets {
        require(app.holdsDataKeys) { "No keys are derived for this app" }
        return DerivedKeysets(
            record = derive(recovery, KeysetType.SEALING, label(app, KeysetName.RECORD)),
            backup = derive(recovery, KeysetType.STREAMING, label(app, KeysetName.BACKUP)),
            fileKey = derive(recovery, KeysetType.SEALING, label(app, KeysetName.FILE_KEY)),
        )
    }

    /** The label of a derived keyset, for example `shkriuss.app/v1/water/record`. */
    private fun label(app: AppName, name: KeysetName): String = "$LABEL_PREFIX${app.value}/${name.text}"

    /**
     * Tink's `KeysetDeriver`: for each recovery key one
     * `PrfBasedKeyDerivationKey` with the derived key type and the same key
     * ID. The label is what Tink calls `salt`. It is HKDF's `info`.
     */
    private fun derive(recovery: KeysetHandle, type: KeysetType, label: String): KeysetHandle {
        TinkSetup.ready()
        val parameters = PrfBasedKeyDerivationParameters.builder()
            .setPrfParameters(KeysetType.RECOVERY.parameters as HkdfPrfParameters)
            .setDerivedKeyParameters(type.parameters)
            .build()
        val builder = KeysetHandle.newBuilder()
        for (index in 0 until recovery.size()) {
            val source = recovery.getAt(index)
            val idRequirement = if (type.parameters.hasIdRequirement()) source.id else null
            val key = PrfBasedKeyDerivationKey.create(parameters, source.key as HkdfPrfKey, idRequirement)
            val entry = KeysetHandle.importKey(key).withFixedId(source.id)
            builder.addEntry(if (source.isPrimary) entry.makePrimary() else entry)
        }
        val deriver = builder.build().getPrimitive(RegistryConfiguration.get(), KeysetDeriver::class.java)
        return deriver.deriveKeyset(label.toByteArray(Charsets.US_ASCII))
    }
}
