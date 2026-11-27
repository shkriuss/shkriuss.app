package app.shkriuss.core.crypto

import android.os.Bundle
import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.prf.PrfSet
import com.google.crypto.tink.signature.Ed25519PrivateKey
import com.google.crypto.tink.signature.Ed25519PublicKey
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.util.Bytes
import com.google.crypto.tink.util.SecretBytes
import java.nio.ByteBuffer
import java.security.GeneralSecurityException

/**
 * What the Sync app asks a data app to sign when this phone joins a sync
 * server: the mode "Sign a device" of the handover format, version 2
 * (crypto-design.md, "The handover format, version 2"). Nothing here is
 * secret.
 *
 * The request travels in the extras of the intent that opens the data
 * app's handover screen: [writeTo] and [readFrom]. Each value is checked
 * when it is made and when it is read, so a data app never signs a
 * statement with a value it could not show or the server could not take.
 */
class DeviceJoinRequest private constructor(
    serverId: ByteArray,
    /** The server's address: `https://`, the host name, and `:` and the port if it is not 443. */
    val address: String,
    devicePublicKey: ByteArray,
    /**
     * The key ID of the recovery key to sign with, or null for the current
     * one. The Sync app names an older key only when the server answered
     * that it holds that one (sync-protocol.md, "How the Sync app gets its
     * statement and its name key", point 8).
     */
    val keyId: KeyId?,
) {
    private val server = serverId.copyOf()
    private val device = devicePublicKey.copyOf()

    /** The server ID, 16 bytes. */
    val serverId: ByteArray get() = server.copyOf()

    /** The device's public key, 65 bytes. */
    val devicePublicKey: ByteArray get() = device.copyOf()

    /** The address without `https://`, as the data app's screen names the server: `sync.example.workers.dev`. */
    val host: String get() = address.removePrefix(SyncAddress.SCHEME)

    /** Puts the request into [extras]. */
    fun writeTo(extras: Bundle) {
        extras.putByteArray(SERVER_ID_KEY, server.copyOf())
        extras.putString(ADDRESS_KEY, address)
        extras.putByteArray(DEVICE_KEY_KEY, device.copyOf())
        keyId?.let { extras.putInt(KEY_ID_KEY, it.value) }
    }

    /** True if [other] asks for exactly the same. */
    internal fun sameAs(other: DeviceJoinRequest): Boolean = other.server.contentEquals(server) &&
        other.address == address && other.device.contentEquals(device) && other.keyId == keyId

    override fun toString(): String = "DeviceJoinRequest($host)"

    companion object {
        /** The length of a server ID. */
        const val SERVER_ID_BYTES: Int = 16

        private const val PREFIX = "app.shkriuss.handover."
        private const val SERVER_ID_KEY = PREFIX + "SERVER_ID"
        private const val ADDRESS_KEY = PREFIX + "SERVER_ADDRESS"
        private const val DEVICE_KEY_KEY = PREFIX + "DEVICE_PUBLIC_KEY"
        private const val KEY_ID_KEY = PREFIX + "KEY_ID"

        /**
         * The request for the server [serverId] at [address], for the device
         * key [devicePublicKey], signed with the recovery key [keyId] or the
         * current one. Null if a value is not one a statement can hold: a
         * server ID that is not 16 bytes, an address that breaks the rules
         * of [SyncAddress], or a public key that is not a point of P-256.
         */
        fun of(serverId: ByteArray, address: String, devicePublicKey: ByteArray, keyId: KeyId? = null): DeviceJoinRequest? {
            TinkSetup.ready()
            if (serverId.size != SERVER_ID_BYTES || !SyncAddress.isValid(address) || !P256.isPublicKey(devicePublicKey)) {
                return null
            }
            return DeviceJoinRequest(serverId, address, devicePublicKey, keyId)
        }

        /**
         * Reads the request from [extras], or null if a value is missing, of
         * another type, or fails the checks of [of]. Other entries are
         * ignored.
         */
        fun readFrom(extras: Bundle): DeviceJoinRequest? = try {
            val serverId = extras.getByteArray(SERVER_ID_KEY)
            val address = extras.getString(ADDRESS_KEY)
            val device = extras.getByteArray(DEVICE_KEY_KEY)
            val keyId = if (extras.containsKey(KEY_ID_KEY)) {
                // A value of another type makes a bundle return each default it is given.
                val withZero = extras.getInt(KEY_ID_KEY, 0)
                if (withZero != extras.getInt(KEY_ID_KEY, 1)) return null
                KeyId(withZero)
            } else {
                null
            }
            if (serverId == null || address == null || device == null) null else of(serverId, address, device, keyId)
        } catch (_: RuntimeException) {
            null
        }
    }
}

/**
 * The address of a sync server as a statement holds it (sync-protocol.md,
 * "The statements", point 1): `https://`, a host name in lower-case ASCII,
 * and `:` and a port from 1 to 65,535 if it is not 443. Nothing after it.
 * 9 to 255 characters. The Sync app turns what the user types into this
 * form. Here it is only checked.
 */
object SyncAddress {
    /** How every address starts. */
    const val SCHEME: String = "https://"

    private const val SHORTEST = 9
    private const val LONGEST = 255
    private const val DEFAULT_PORT = 443
    private const val HIGHEST_PORT = 65_535
    private val LABEL = Regex("[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")
    private val PORT = Regex("[1-9][0-9]{0,4}")
    private val DIGITS = Regex("[0-9]+")

    /** True if [address] has exactly that form, and its host is not an IP address. */
    fun isValid(address: String): Boolean {
        if (address.length !in SHORTEST..LONGEST || !address.startsWith(SCHEME)) return false
        val rest = address.removePrefix(SCHEME)
        val host = rest.substringBefore(':')
        if (rest.contains(':')) {
            val port = rest.substringAfter(':')
            if (!PORT.matches(port) || port.toInt() > HIGHEST_PORT || port.toInt() == DEFAULT_PORT) return false
        }
        val labels = host.split('.')
        if (labels.any { !LABEL.matches(it) }) return false
        // Four labels of digits only is an IPv4 address. A host of digits and dots alone is never taken.
        return !labels.all { DIGITS.matches(it) }
    }
}

/**
 * A join statement and what came with it from the data app that signed
 * it: its signature, the account public key and the name key
 * (sync-protocol.md, "How the Sync app gets its statement and its name
 * key", point 5). The Sync app sends the first three in its `enrol` and
 * stores the name key ([SyncKeys.storeNameKey]).
 *
 * It travels back in a [Bundle], as the result of the handover format,
 * version 2: [writeTo] and [readFrom]. The bundle holds the name key, so
 * it is never shown or logged. [toString] never shows the key.
 */
class SignedJoin internal constructor(
    statement: ByteArray,
    signature: ByteArray,
    accountPublicKey: ByteArray,
    internal val nameKey: KeysetHandle,
) {
    private val statementBytes = statement.copyOf()
    private val signatureBytes = signature.copyOf()
    private val accountKey = accountPublicKey.copyOf()
    private val parsed = JoinStatement.parse(statementBytes) ?: throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)

    /** The statement's bytes, as the server checks them. */
    val statement: ByteArray get() = statementBytes.copyOf()

    /** Its Ed25519 signature, 64 bytes. */
    val signature: ByteArray get() = signatureBytes.copyOf()

    /** The account public key, 32 bytes. */
    val accountPublicKey: ByteArray get() = accountKey.copyOf()

    /** The key ID of the recovery key that signed it. */
    val keyId: KeyId get() = parsed.keyId

    /** When it was made, in milliseconds since 1970 UTC, by the clock of the app that signed it. */
    val time: Long get() = parsed.time

    /** True if it says what [request] asked for: the same server ID, address and device key, and the key ID asked for. */
    fun isFor(request: DeviceJoinRequest): Boolean =
        parsed.request.serverId.contentEquals(request.serverId) && parsed.request.address == request.address &&
            parsed.request.devicePublicKey.contentEquals(request.devicePublicKey) &&
            (request.keyId == null || request.keyId == parsed.keyId)

    /** Puts it into [bundle], as version 2 of the handover format. */
    fun writeTo(bundle: Bundle) {
        bundle.putInt(VERSION_KEY, VERSION)
        bundle.putByteArray(STATEMENT_KEY, statementBytes.copyOf())
        bundle.putByteArray(SIGNATURE_KEY, signatureBytes.copyOf())
        bundle.putByteArray(ACCOUNT_KEY_KEY, accountKey.copyOf())
        bundle.putByteArray(NAME_KEY_KEY, KeysetCodec.serialize(nameKey))
    }

    /** Says only what it is. */
    override fun toString(): String = "SignedJoin"

    companion object {
        /** The version of the handover format that [writeTo] writes and [readFrom] reads. */
        const val VERSION: Int = 2

        private const val PREFIX = "app.shkriuss.handover."
        private const val VERSION_KEY = PREFIX + "VERSION"
        private const val STATEMENT_KEY = PREFIX + "STATEMENT"
        private const val SIGNATURE_KEY = PREFIX + "SIGNATURE"
        private const val ACCOUNT_KEY_KEY = PREFIX + "ACCOUNT_PUBLIC_KEY"
        private const val NAME_KEY_KEY = PREFIX + "NAME_KEY"

        /**
         * Reads what a data app put into [bundle] with [writeTo]. It is taken
         * only if the version is 2, the statement is a join statement of the
         * protocol's layout, the signature is the account key's on it, and
         * the name key is one key of the record type under the statement's
         * key ID.
         *
         * Throws [BlobException]: "made by a newer version" for a higher
         * version, "damaged or changed" for anything else. Other entries are
         * ignored.
         */
        fun readFrom(bundle: Bundle): SignedJoin {
            TinkSetup.ready()
            val version = try {
                bundle.getInt(VERSION_KEY, 0)
            } catch (_: RuntimeException) {
                throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            }
            if (version > VERSION) throw BlobException(BlobAnswer.MADE_BY_A_NEWER_VERSION)
            if (version != VERSION) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            val statement = bytesOf(bundle, STATEMENT_KEY)
            val signature = bytesOf(bundle, SIGNATURE_KEY)
            val accountKey = bytesOf(bundle, ACCOUNT_KEY_KEY)
            val nameKey = KeysetCodec.parse(bytesOf(bundle, NAME_KEY_KEY), KeysetType.SEALING, exactCount = 1)
            val signed = SignedJoin(statement, signature, accountKey, nameKey)
            if (!AccountKey.verifies(accountKey, statement, signature) || KeysetCodec.primaryId(nameKey) != signed.keyId) {
                throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            }
            return signed
        }

        private fun bytesOf(bundle: Bundle, key: String): ByteArray = try {
            bundle.getByteArray(key)
        } catch (_: RuntimeException) {
            null
        } ?: throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)

        /**
         * Signs that the device of [request] may join its server, with the
         * recovery key [signer], at the time [now]: the join statement, its
         * signature, the account public key and the name key
         * (sync-protocol.md, "How the Sync app gets its statement and its
         * name key", point 4). The account key leaves memory at once.
         */
        internal fun sign(signer: RecoveryKey, request: DeviceJoinRequest, now: Long): SignedJoin {
            val statement = JoinStatement.bytes(request, signer.keyId, now)
            val (publicKey, signature) = AccountKey.sign(signer, statement)
            return SignedJoin(statement, signature, publicKey, RecoveryKeyDeriver.nameKey(signer))
        }
    }
}

/**
 * The join statement of sync-protocol.md, "The statements": what the
 * account key signs, so that a device may join one server.
 */
internal object JoinStatement {
    private val MAGIC = "SHKSYNC".toByteArray(Charsets.US_ASCII)
    private const val LAYOUT_VERSION: Byte = 1
    private const val TYPE_JOIN: Byte = 1
    private const val FIXED_BYTES = 38

    /** What a statement read back says. */
    class Parsed(val request: DeviceJoinRequest, val keyId: KeyId, val time: Long)

    /** The bytes of the statement that the device of [request] may join, made at [time] with the recovery key [keyId]. */
    fun bytes(request: DeviceJoinRequest, keyId: KeyId, time: Long): ByteArray {
        require(time >= 0) { "A time is not before 1970" }
        val address = request.address.toByteArray(Charsets.US_ASCII)
        return ByteBuffer.allocate(FIXED_BYTES + address.size + P256.PUBLIC_KEY_BYTES)
            .put(MAGIC)
            .put(LAYOUT_VERSION)
            .put(TYPE_JOIN)
            .put(request.serverId)
            .put(keyId.toBytes())
            .putLong(time)
            .put(address.size.toByte())
            .put(address)
            .put(request.devicePublicKey)
            .array()
    }

    /** Reads a join statement, or null if it is not exactly one, with values the checks of [DeviceJoinRequest.of] take. */
    fun parse(bytes: ByteArray): Parsed? {
        if (bytes.size < FIXED_BYTES) return null
        if (!bytes.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return null
        if (bytes[7] != LAYOUT_VERSION || bytes[8] != TYPE_JOIN) return null
        val serverId = bytes.copyOfRange(9, 25)
        val keyId = KeyId.fromBytes(bytes, 25)
        val time = ByteBuffer.wrap(bytes, 29, 8).long
        val length = bytes[37].toInt() and 0xff
        if (time < 0 || bytes.size != FIXED_BYTES + length + P256.PUBLIC_KEY_BYTES) return null
        val address = String(bytes, FIXED_BYTES, length, Charsets.US_ASCII)
        val device = bytes.copyOfRange(FIXED_BYTES + length, bytes.size)
        val request = DeviceJoinRequest.of(serverId, address, device, keyId) ?: return null
        return Parsed(request, keyId, time)
    }
}

/**
 * The account key (crypto-design.md, "The account key"): an Ed25519 key
 * whose 32 private bytes come from the recovery key with the label
 * `shkriuss.app/v1/sync/account`. It is made for one signature, here
 * only, and dropped.
 */
internal object AccountKey {
    private const val LABEL = "shkriuss.app/v1/sync/account"
    private const val PRIVATE_BYTES = 32
    private const val PUBLIC_BYTES = 32
    private const val SIGNATURE_BYTES = 64

    /** Signs [statement] with the account key of [recoveryKey]. Returns the public key and the signature. */
    fun sign(recoveryKey: RecoveryKey, statement: ByteArray): Pair<ByteArray, ByteArray> {
        val seed = privateBytes(recoveryKey)
        try {
            val publicBytes = Ed25519Sign.KeyPair.newKeyPairFromSeed(seed).publicKey
            val publicKey = Ed25519PublicKey.create(Bytes.copyFrom(publicBytes))
            val privateKey = Ed25519PrivateKey.create(publicKey, SecretBytes.copyFrom(seed, InsecureSecretKeyAccess.get()))
            return publicBytes to Ed25519Sign.create(privateKey).sign(statement)
        } finally {
            seed.fill(0)
        }
    }

    /** True if [signature] is the signature of the account key [publicKey] on [statement]. */
    fun verifies(publicKey: ByteArray, statement: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != PUBLIC_BYTES || signature.size != SIGNATURE_BYTES) return false
        return try {
            Ed25519Verify.create(Ed25519PublicKey.create(Bytes.copyFrom(publicKey))).verify(signature, statement)
            true
        } catch (_: GeneralSecurityException) {
            false
        }
    }

    /**
     * The 32 private bytes: HKDF-SHA256 of the recovery key with an empty
     * salt and the label as `info`, through Tink's PRF on the recovery
     * key, as for its key ID. The caller wipes them.
     */
    internal fun privateBytes(recoveryKey: RecoveryKey): ByteArray {
        TinkSetup.ready()
        val keyset = KeysetHandle.newBuilder()
            .addEntry(KeysetHandle.importKey(recoveryKey.prfKey).withFixedId(1).makePrimary())
            .build()
        val prf = keyset.getPrimitive(RegistryConfiguration.get(), PrfSet::class.java)
        return prf.computePrimary(LABEL.toByteArray(Charsets.US_ASCII), PRIVATE_BYTES)
    }
}
