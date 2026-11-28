package app.shkriuss.core.crypto

import com.google.crypto.tink.subtle.Random
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.security.MessageDigest

/**
 * The keys of the Sync app (crypto-design.md, "Sync keys"): the device
 * key, which signs every request to the server, and the name key, which
 * seals the names of devices. The setup code is made here too, from
 * Tink's random source.
 *
 * Only the Sync app has these. In any other app every function throws
 * [IllegalStateException], so that no data app ever stores a name key
 * over its own `record` keyset.
 *
 * Every function runs under the lock of the app's keys. One that cannot
 * use the Keystore now throws [BlobException] "needs keys this app does
 * not have now": nothing was changed, and a later try may work.
 */
class SyncKeys internal constructor(private val vault: KeyVault) {
    /**
     * The number for a new device key: one above every `shk.device.<n>`
     * that the Keystore lists, and never the number of a key that exists
     * (crypto-design.md, "Hardware keys", rule 4). Nothing is made. The
     * Sync app stores the number first, then makes the key with
     * [makeDeviceKey].
     */
    fun newDeviceKeyNumber(): Int = sync {
        val listed = vault.hardware.aliases().mapNotNull { DeviceKeyRef.ofAlias(it)?.number }
        var number = listed.maxOrNull()?.plus(1) ?: 1
        while (vault.hardware.exists(DeviceKeyRef(number))) number++
        number
    }

    /**
     * The device key under [number], made now if there is none: in
     * StrongBox first, and without it if that fails. A key that exists is
     * never made again. Throws [CannotMakeHardwareKeyException] if Android
     * could make none.
     */
    fun makeDeviceKey(number: Int): DeviceKey = sync {
        val key = DeviceKeyRef(number)
        if (!vault.hardware.exists(key)) vault.hardware.make(key)
        DeviceKey(number, vault.hardware.publicKey(key))
    }

    /**
     * The device key under [number], or null if it is gone: its alias does
     * not exist, or Android says it is permanently invalidated.
     */
    fun deviceKey(number: Int): DeviceKey? = sync {
        val key = DeviceKeyRef(number)
        try {
            if (vault.hardware.exists(key)) DeviceKey(number, vault.hardware.publicKey(key)) else null
        } catch (_: HardwareKeyGone) {
            null
        }
    }

    /**
     * Signs one request to the server [serverId] with [key]
     * (sync-protocol.md, "Signed requests"): the signed bytes are put
     * together here, with type `10`, so that a device key never signs
     * anything else. [pathAndQuery] is exactly what is sent, in ASCII.
     * [signedBody] is the signed part of the body, empty for none.
     *
     * Returns the 64 bytes r and s. Throws [DeviceKeyGoneException] if the
     * key is gone for good.
     */
    fun signRequest(
        key: DeviceKey,
        serverId: ByteArray,
        time: Long,
        method: RequestMethod,
        pathAndQuery: String,
        signedBody: ByteArray,
    ): ByteArray {
        val bytes = SignedRequest.bytes(serverId, key.deviceId, time, method, pathAndQuery, signedBody)
        return sync {
            val ref = DeviceKeyRef(key.number)
            val der = try {
                // The key under this alias must still be this key, not one made under the same number later.
                if (!vault.hardware.publicKey(ref).contentEquals(key.publicKey)) throw HardwareKeyGone()
                vault.hardware.sign(ref, bytes)
            } catch (_: HardwareKeyGone) {
                throw DeviceKeyGoneException()
            }
            P256.derToRaw(der)
        }
    }

    /** Deletes the device key under [number], if there is one. */
    fun deleteDeviceKey(number: Int) = sync {
        val key = DeviceKeyRef(number)
        if (vault.hardware.exists(key)) vault.hardware.delete(key)
    }

    /**
     * Deletes every device key that the Keystore lists but [keep], the one
     * the Sync app's state names, or every one when it names none. Call it
     * at start, after [ShkCrypto.start] (crypto-design.md, "Hardware keys",
     * rule 8). Only keys that the list shows are deleted, so a list that
     * failed deletes nothing. A key that cannot be deleted now waits for
     * the next start.
     */
    fun deleteOtherDeviceKeys(keep: Int?) = sync {
        vault.hardware.aliases().mapNotNull { DeviceKeyRef.ofAlias(it) }.filter { it.number != keep }.forEach { key ->
            try {
                vault.hardware.delete(key)
            } catch (_: HardwareKeyFailure) {
                // Tried again at the next start.
            }
        }
    }

    /**
     * Stores the name key that came with [signed], as this app's `record`
     * keyset under its Background key (crypto-design.md, "The name key",
     * point 2). A stored name key that is damaged is first copied to the
     * set-aside folder. Throws [BlobException] if what is stored cannot be
     * judged now.
     */
    fun storeNameKey(signed: SignedJoin) = sync {
        when (vault.look(KeysetName.RECORD)) {
            is Stored.NotUsableNow -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
            is Stored.Damaged -> vault.setAside(KeysetName.RECORD)
            else -> Unit
        }
        val old = vault.namedKeyOrNull(KeysetName.RECORD)
        vault.wrapAndStore(KeysetName.RECORD, signed.nameKey, vault.keyFor(HardwareKeyKind.BACKGROUND))
        if (old != null && old != vault.namedKeyOrNull(KeysetName.RECORD)) vault.deleteIfUnnamed(old)
    }

    /** Whether the name key is stored, and whether it opens now. */
    fun nameKeyState(): NameKeyState = sync {
        when (vault.look(KeysetName.RECORD)) {
            is Stored.Open -> NameKeyState.STORED
            is Stored.Missing -> NameKeyState.MISSING
            is Stored.NotUsableNow -> NameKeyState.NOT_USABLE_NOW
            else -> NameKeyState.LOST
        }
    }

    /**
     * Deletes the name key and the Background key that wraps it. A damaged
     * file is first copied to the set-aside folder.
     */
    fun deleteNameKey() = sync {
        val key = vault.namedKeyOrNull(KeysetName.RECORD)
        if (vault.look(KeysetName.RECORD) is Stored.Damaged) vault.setAside(KeysetName.RECORD)
        if (vault.isStored(KeysetName.RECORD)) vault.remove(KeysetName.RECORD)
        key?.let { vault.deleteIfUnnamed(it) }
    }

    /**
     * Seals [name], the name of the device [deviceId], with the name key:
     * a sealed record under the device ID whose plaintext is `01` and the
     * name in UTF-8 (sync-protocol.md, "The name key", point 2). The name
     * must pass [DeviceNames.isValid]; otherwise this throws
     * [IllegalArgumentException]. Throws [BlobException] if there is no
     * name key, or it cannot be used now.
     */
    fun sealName(deviceId: DeviceId, name: String): ByteArray {
        require(DeviceNames.isValid(name)) { "Not a name a device can have" }
        val plaintext = byteArrayOf(NAME_VERSION) + name.toByteArray(Charsets.UTF_8)
        return sync {
            val associatedData = AssociatedData.forId(BlobKind.SEALED_RECORD, deviceId.toRecordId())
            SealedBlobs.seal(BlobKind.SEALED_RECORD, vault.recordKeyset(), associatedData, plaintext)
        }
    }

    /**
     * Opens the sealed name [blob] of the device [deviceId]. Throws
     * [BlobException]: as for any sealed record, and "damaged or changed"
     * when what it holds is not `01` and a name that [DeviceNames.isValid]
     * takes.
     */
    fun openName(deviceId: DeviceId, blob: ByteArray): String = sync {
        val associatedData = AssociatedData.forId(BlobKind.SEALED_RECORD, deviceId.toRecordId())
        val plaintext = SealedBlobs.open(BlobKind.SEALED_RECORD, vault.recordKeyset(), associatedData, blob)
        if (plaintext.isEmpty() || plaintext[0] != NAME_VERSION) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        val name = DeviceNames.decode(plaintext.copyOfRange(1, plaintext.size)) ?: throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        if (!DeviceNames.isValid(name)) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        name
    }

    /**
     * A new setup code: 26 characters, each picked at random from the 32
     * letters and digits of the code alphabet, `A` to `Z` without `I` and
     * `O`, and `2` to `9` (sync-protocol.md, "Joining"). 130 bits.
     */
    fun newSetupCode(): String = sync { String(CharArray(SETUP_CODE_LENGTH) { CODE_ALPHABET[Random.randInt(CODE_ALPHABET.length)] }) }

    private fun <T> sync(action: () -> T): T {
        check(vault.app == RecoveryKeyDeriver.SYNC) { "Only the Sync app has these keys" }
        return vault.locked(action)
    }

    internal companion object {
        /** The letters and digits of a setup code and a device code. */
        const val CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        /** The length of a setup code. */
        const val SETUP_CODE_LENGTH = 26

        /** The version of the plaintext of a sealed name. */
        private const val NAME_VERSION: Byte = 1
    }
}

/** What [SyncKeys.nameKeyState] found. */
enum class NameKeyState {
    /** It is stored and opens. */
    STORED,

    /** No name key is stored. */
    MISSING,

    /** It cannot be read now. Nothing is lost. */
    NOT_USABLE_NOW,

    /** Its hardware key is gone, or the file is damaged. The phone joins again. */
    LOST,
}

/**
 * The rules for a device's name (sync-protocol.md, "The name key", point
 * 2; Sync's specification, "Limits and defaults"): 1 to 40 code points,
 * at most 160 bytes in UTF-8, one line, no space at either end. One line
 * means no control character and no line or paragraph separator.
 */
object DeviceNames {
    /** The most code points of a name. */
    const val LONGEST: Int = 40

    private const val MOST_BYTES = 160

    /** True if [name] is one a device can have. */
    fun isValid(name: String): Boolean {
        val points = name.codePointCount(0, name.length)
        if (points !in 1..LONGEST || name.toByteArray(Charsets.UTF_8).size > MOST_BYTES) return false
        if (!isWellFormed(name)) return false
        if (name.any { it.isISOControl() || it == ' ' || it == ' ' }) return false
        return !isSpace(name.codePointAt(0)) && !isSpace(name.codePointBefore(name.length))
    }

    /** The text of [bytes] if they are well-formed UTF-8, else null. */
    internal fun decode(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: CharacterCodingException) {
        null
    }

    /** False for a text with a lone surrogate, which UTF-8 cannot hold. */
    private fun isWellFormed(name: String): Boolean {
        var index = 0
        while (index < name.length) {
            val char = name[index]
            if (char.isHighSurrogate()) {
                if (index + 1 >= name.length || !name[index + 1].isLowSurrogate()) return false
                index += 2
            } else {
                if (char.isLowSurrogate()) return false
                index++
            }
        }
        return true
    }

    private fun isSpace(codePoint: Int): Boolean = Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint)
}

/** The bytes that a device key signs for one request (sync-protocol.md, "Signed requests"). */
internal object SignedRequest {
    private val MAGIC = "SHKSYNC".toByteArray(Charsets.US_ASCII)
    private const val LAYOUT_VERSION: Byte = 1
    private const val TYPE_REQUEST: Byte = 0x10
    private const val FIXED_BYTES = 52
    private const val HASH_BYTES = 32
    private const val LONGEST_PATH = 0xffff

    /** The bytes, with the SHA-256 of [signedBody]. Throws [IllegalArgumentException] for a value the layout cannot hold. */
    fun bytes(
        serverId: ByteArray,
        deviceId: DeviceId,
        time: Long,
        method: RequestMethod,
        pathAndQuery: String,
        signedBody: ByteArray,
    ): ByteArray {
        require(serverId.size == DeviceJoinRequest.SERVER_ID_BYTES) { "A server ID is 16 bytes" }
        require(time >= 0) { "A time is not before 1970" }
        require(pathAndQuery.startsWith("/") && pathAndQuery.all { it.code in 0x21..0x7e }) {
            "A path is printable ASCII that starts with /"
        }
        val path = pathAndQuery.toByteArray(Charsets.US_ASCII)
        require(path.size <= LONGEST_PATH) { "A path has at most 65,535 bytes" }
        return ByteBuffer.allocate(FIXED_BYTES + path.size + HASH_BYTES)
            .put(MAGIC)
            .put(LAYOUT_VERSION)
            .put(TYPE_REQUEST)
            .put(serverId)
            .put(deviceId.toBytes())
            .putLong(time)
            .put(method.byte)
            .putShort(path.size.toShort())
            .put(path)
            .put(MessageDigest.getInstance("SHA-256").digest(signedBody))
            .array()
    }
}
