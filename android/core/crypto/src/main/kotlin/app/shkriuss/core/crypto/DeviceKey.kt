package app.shkriuss.core.crypto

import com.google.crypto.tink.subtle.EllipticCurves
import java.math.BigInteger
import java.security.GeneralSecurityException
import java.security.MessageDigest

/**
 * One device key of the Sync app in the Android Keystore, by its number
 * (crypto-design.md, "The device key"). It is not one of the four kinds
 * of [HardwareKeyKind]: it signs and wraps no keyset, so the cleanup at
 * start never counts it.
 */
internal data class DeviceKeyRef(val number: Int) {
    init {
        require(number >= 1) { "A hardware key number starts at 1" }
    }

    /** The key's name in the Android Keystore, for example `shk.device.3`. */
    val alias: String get() = "$ALIAS_PREFIX$number"

    companion object {
        private const val ALIAS_PREFIX = "shk.device."
        private val ALIAS = Regex("""shk\.device\.([1-9][0-9]{0,9})""")

        /** The device key an alias names, or null if the alias is not a device key's. */
        fun ofAlias(alias: String): DeviceKeyRef? {
            val match = ALIAS.matchEntire(alias) ?: return null
            val number = match.groupValues[1].toLongOrNull()?.takeIf { it <= Int.MAX_VALUE } ?: return null
            return DeviceKeyRef(number.toInt())
        }
    }
}

/**
 * The ID of a device on a sync server: the first 16 bytes of the SHA-256
 * of its public key (sync-protocol.md, "The device key"). It is public.
 */
class DeviceId private constructor(private val bytes: ByteArray) {
    /** The 16 bytes. */
    fun toBytes(): ByteArray = bytes.copyOf()

    /** The 32 lower-case hex digits, as the header `shk-device` carries them. */
    fun toHex(): String = bytes.joinToString("") { "%02x".format(it) }

    /**
     * The same 16 bytes in the form of a record ID, so that a device's
     * name is sealed as a record under its device ID (sync-protocol.md,
     * "The name key", point 2).
     */
    internal fun toRecordId(): String {
        val hex = toHex()
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }

    override fun equals(other: Any?): Boolean = other is DeviceId && other.bytes.contentEquals(bytes)

    override fun hashCode(): Int = bytes.contentHashCode()

    override fun toString(): String = toHex()

    companion object {
        /** The length of a device ID in bytes. */
        const val BYTES: Int = 16

        private val HEX = Regex("[0-9a-f]{32}")

        /** The device ID of the 65-byte public key [publicKey]. Throws [IllegalArgumentException] for any other length. */
        fun ofPublicKey(publicKey: ByteArray): DeviceId {
            require(publicKey.size == P256.PUBLIC_KEY_BYTES) { "A public key is 65 bytes" }
            return DeviceId(MessageDigest.getInstance("SHA-256").digest(publicKey).copyOf(BYTES))
        }

        /** The device ID of [bytes], exactly 16 of them, or null. */
        fun ofBytes(bytes: ByteArray): DeviceId? = if (bytes.size == BYTES) DeviceId(bytes.copyOf()) else null

        /** The device ID of 32 lower-case hex digits, or null. */
        fun ofHex(hex: String): DeviceId? {
            if (!HEX.matches(hex)) return null
            return DeviceId(ByteArray(BYTES) { hex.substring(2 * it, 2 * it + 2).toInt(16).toByte() })
        }
    }
}

/**
 * The Sync app's device key in the Keystore: its [number], the `<number>`
 * of the alias `shk.device.<number>`, and its public key. Nothing here is
 * secret: the private key never leaves the Keystore.
 */
class DeviceKey internal constructor(val number: Int, publicKey: ByteArray) {
    private val key = publicKey.copyOf()

    init {
        require(P256.isPublicKey(key)) { "Not a public key of the curve P-256" }
    }

    /** The public key as 65 bytes: `04`, X, Y. */
    val publicKey: ByteArray get() = key.copyOf()

    /** The device ID of this key. */
    val deviceId: DeviceId = DeviceId.ofPublicKey(key)

    override fun toString(): String = "DeviceKey($number, $deviceId)"
}

/**
 * Thrown when the Sync app's device key is gone for good: its alias does
 * not exist, or Android says it is permanently invalidated. The device
 * then joins again with a new key (crypto-design.md, "The device key",
 * point 6).
 */
class DeviceKeyGoneException internal constructor() : Exception("The device key is gone")

/** The method of a signed request, as its byte in the signed bytes (sync-protocol.md, "Signed requests"). */
enum class RequestMethod(internal val byte: Byte) {
    GET(1),
    POST(2),
}

/** The curve P-256 for device keys: points on the wire, and signatures as the server checks them. */
internal object P256 {
    /** `04`, then X and Y of 32 bytes each. */
    const val PUBLIC_KEY_BYTES = 65

    /** r, then s, 32 bytes each. */
    const val SIGNATURE_BYTES = 64

    private const val COORDINATE_BYTES = 32
    private const val SEQUENCE: Int = 0x30
    private const val INTEGER: Int = 0x02

    /** True if [bytes] is an uncompressed point of P-256 that is on the curve. Tink checks the point. */
    fun isPublicKey(bytes: ByteArray): Boolean {
        if (bytes.size != PUBLIC_KEY_BYTES || bytes[0] != 4.toByte()) return false
        return try {
            EllipticCurves.pointDecode(
                EllipticCurves.CurveType.NIST_P256,
                EllipticCurves.PointFormatType.UNCOMPRESSED,
                bytes,
            )
            true
        } catch (_: GeneralSecurityException) {
            false
        } catch (_: RuntimeException) {
            false
        }
    }

    /** The 65 bytes of the point (x, y). */
    fun encode(x: BigInteger, y: BigInteger): ByteArray = byteArrayOf(4) + fixed(x) + fixed(y)

    /**
     * The signature that the Keystore gives in its DER form, as the 64
     * bytes r and s that the server checks (crypto-design.md, "The device
     * key", point 5). Only a well-formed DER sequence of two positive
     * integers that fit in 32 bytes is taken. Throws
     * [IllegalArgumentException] for anything else.
     */
    fun derToRaw(der: ByteArray): ByteArray {
        var at = 0
        fun next(): Int {
            require(at < der.size) { "The signature ends too early" }
            return der[at++].toInt() and 0xff
        }

        fun length(): Int {
            val first = next()
            if (first < 0x80) return first
            require(first == 0x81) { "The signature's length has a form that is not allowed" }
            val long = next()
            require(long >= 0x80) { "The signature's length is not in its shortest form" }
            return long
        }

        fun integer(): ByteArray {
            require(next() == INTEGER) { "The signature holds something other than an integer" }
            val size = length()
            require(size in 1..COORDINATE_BYTES + 1 && at + size <= der.size) { "An integer of the signature has a wrong length" }
            val value = der.copyOfRange(at, at + size)
            at += size
            require(value[0] >= 0) { "An integer of the signature is negative" }
            require(size == 1 || value[0] != 0.toByte() || value[1] < 0) { "An integer of the signature is not in its shortest form" }
            val magnitude = if (value[0] == 0.toByte() && size > 1) value.copyOfRange(1, size) else value
            require(magnitude.size <= COORDINATE_BYTES) { "An integer of the signature is too large" }
            return ByteArray(COORDINATE_BYTES - magnitude.size) + magnitude
        }

        require(next() == SEQUENCE) { "The signature is not a sequence" }
        val size = length()
        require(at + size == der.size) { "The signature has a wrong length" }
        val r = integer()
        val s = integer()
        require(at == der.size) { "The signature holds more than two integers" }
        require(r.any { it != 0.toByte() } && s.any { it != 0.toByte() }) { "An integer of the signature is zero" }
        return r + s
    }

    private fun fixed(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        val magnitude = if (bytes.size > COORDINATE_BYTES && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
        require(magnitude.size <= COORDINATE_BYTES) { "A coordinate is larger than 32 bytes" }
        return ByteArray(COORDINATE_BYTES - magnitude.size) + magnitude
    }
}
