package app.shkriuss.core.crypto

import android.os.Bundle

/**
 * The three keysets a keeper app makes for another app of the suite, from
 * the recovery key it keeps ("Setting up a second app on the same phone"
 * in crypto-design.md, ADR 0041). The asking app stores them with
 * [KeySetup.storeHandedOverKeys]. It never gets the recovery key.
 *
 * The keys travel between the two apps in a [Bundle], as version 1 of the
 * handover format: [writeTo] and [readFrom]. Nothing else may read or
 * write them. [toString] never shows them. A bundle's own `toString`
 * lists the bytes it holds, so a bundle or an intent with these keys is
 * never shown or logged.
 */
class HandedOverKeys internal constructor(
    internal val derived: DerivedKeysets,
    /**
     * True if the keeper checked four of the recovery words against its
     * kept key just before ([KeySetup.handOverAfterWords]). Only then can
     * [KeySetup.checkWordsAtKeeper] give a proof for the app lock.
     */
    val wordsChecked: Boolean,
) {
    /** The public ID of the recovery key the keys come from. */
    val keyId: KeyId get() = KeysetCodec.primaryId(derived.record)

    /** Puts the keys into [bundle], as version 1 of the handover format. */
    fun writeTo(bundle: Bundle) {
        bundle.putInt(VERSION_KEY, VERSION)
        bundle.putByteArray(RECORD_KEY, KeysetCodec.serialize(derived.record))
        bundle.putByteArray(BACKUP_KEY, KeysetCodec.serialize(derived.backup))
        bundle.putByteArray(FILE_KEY_KEY, KeysetCodec.serialize(derived.fileKey))
        bundle.putBoolean(WORDS_CHECKED_KEY, wordsChecked)
    }

    /** Says only what it is. */
    override fun toString(): String = "HandedOverKeys"

    companion object {
        /** The version of the handover format that [writeTo] writes and [readFrom] reads. */
        const val VERSION = 1

        private const val PREFIX = "app.shkriuss.handover."
        private const val VERSION_KEY = PREFIX + "VERSION"
        private const val RECORD_KEY = PREFIX + "RECORD"
        private const val BACKUP_KEY = PREFIX + "BACKUP"
        private const val FILE_KEY_KEY = PREFIX + "FILE_KEY"
        private const val WORDS_CHECKED_KEY = PREFIX + "WORDS_CHECKED"

        /**
         * Reads the keys that a keeper put into [bundle] with [writeTo].
         * They are taken only if the version is 1, each keyset holds only
         * keys of its type and parameters, each under its own ID, and all
         * three hold the same key IDs with the same primary.
         *
         * Throws [BlobException]: "made by a newer version" for a higher
         * version, "damaged or changed" for anything else. Other entries
         * of the bundle are ignored.
         */
        fun readFrom(bundle: Bundle): HandedOverKeys {
            val version = try {
                bundle.getInt(VERSION_KEY, 0)
            } catch (_: RuntimeException) {
                throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            }
            if (version > VERSION) throw BlobException(BlobAnswer.MADE_BY_A_NEWER_VERSION)
            if (version != VERSION) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            val derived = DerivedKeysets(
                record = KeysetCodec.parse(bytesOf(bundle, RECORD_KEY), KeysetType.SEALING),
                backup = KeysetCodec.parse(bytesOf(bundle, BACKUP_KEY), KeysetType.STREAMING),
                fileKey = KeysetCodec.parse(bytesOf(bundle, FILE_KEY_KEY), KeysetType.SEALING),
            )
            val ids = KeysetCodec.keyIds(derived.record).toSet()
            val primary = KeysetCodec.primaryId(derived.record)
            val fits = listOf(derived.backup, derived.fileKey).all {
                KeysetCodec.keyIds(it).toSet() == ids && KeysetCodec.primaryId(it) == primary
            }
            if (!fits) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            return HandedOverKeys(derived, wordsCheckedOf(bundle))
        }

        /**
         * The flag of [WORDS_CHECKED_KEY]: false if it is missing. A value of
         * another type makes a bundle return each default it is given, so
         * two reads with two defaults tell it apart.
         */
        private fun wordsCheckedOf(bundle: Bundle): Boolean = try {
            val withFalse = bundle.getBoolean(WORDS_CHECKED_KEY, false)
            val withTrue = bundle.getBoolean(WORDS_CHECKED_KEY, true)
            if (withFalse != withTrue && bundle.containsKey(WORDS_CHECKED_KEY)) {
                throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            }
            withFalse
        } catch (_: RuntimeException) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }

        private fun bytesOf(bundle: Bundle, key: String): ByteArray = try {
            bundle.getByteArray(key)
        } catch (_: RuntimeException) {
            null
        } ?: throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
    }
}
