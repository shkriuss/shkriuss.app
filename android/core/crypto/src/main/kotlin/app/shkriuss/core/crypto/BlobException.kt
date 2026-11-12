package app.shkriuss.core.crypto

import java.io.IOException

/**
 * The answers a reader gives when it cannot open a blob ("Reading a blob"
 * in crypto-design.md). A reader says one of these and nothing more
 * detailed, so an answer never tells an attacker what exactly failed.
 */
enum class BlobAnswer(internal val text: String) {
    /** The first three bytes are not `SHK`. */
    NOT_ONE_OF_OURS("Not one of ours"),

    /** The version byte is higher than this reader knows. */
    MADE_BY_A_NEWER_VERSION("Made by a newer version of the app"),

    /** The kind byte is not the one expected here. */
    WRONG_KIND("Wrong kind"),

    /** A sealed record or a wrapped file key names a key ID that is not in the keyset. */
    NEEDS_ANOTHER_RECOVERY_KEY("Needs another recovery key"),

    /** The keyset is not stored, its hardware key is gone or not usable now, or the app is locked. */
    NEEDS_KEYS_NOT_HERE_NOW("Needs keys this app does not have now"),

    /** Tink or the Keystore refused the blob, or the blob is cut or not well formed. */
    DAMAGED_OR_CHANGED("Damaged or changed"),
}

/**
 * Thrown when a blob cannot be opened, or cannot be made because the keys
 * are not there. It carries one [answer] and, for
 * [BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY], the public [keyId] the blob
 * names. It never carries a cause, key bytes or plaintext.
 *
 * It is an [IOException] so that a stream can throw it in the middle of a
 * read: a stream fails at the segment that is damaged, not before.
 */
class BlobException internal constructor(
    val answer: BlobAnswer,
    val keyId: KeyId? = null,
) : IOException(if (keyId == null) answer.text else "${answer.text}: $keyId")

/**
 * The four public bytes that name a recovery key, and every key derived
 * from it. It is not a secret: a backup file and every sealed record show
 * it in the clear.
 */
class KeyId(val value: Int) {
    /** The four bytes, as they stand in a blob. */
    fun toBytes(): ByteArray = byteArrayOf(
        (value ushr 24).toByte(),
        (value ushr 16).toByte(),
        (value ushr 8).toByte(),
        value.toByte(),
    )

    override fun equals(other: Any?): Boolean = other is KeyId && other.value == value

    override fun hashCode(): Int = value

    /** Eight lower-case hex digits, for example `b19d376f`. */
    override fun toString(): String = "%08x".format(value)

    internal companion object {
        /** Reads the four bytes at [offset] as a big-endian number. */
        fun fromBytes(bytes: ByteArray, offset: Int = 0): KeyId = KeyId(
            ((bytes[offset].toInt() and 0xff) shl 24) or
                ((bytes[offset + 1].toInt() and 0xff) shl 16) or
                ((bytes[offset + 2].toInt() and 0xff) shl 8) or
                (bytes[offset + 3].toInt() and 0xff),
        )
    }
}
