package app.shkriuss.core.crypto.fixtures

import android.security.keystore.KeyPermanentlyInvalidatedException
import app.shkriuss.core.crypto.CannotMakeHardwareKeyException
import app.shkriuss.core.crypto.HardwareBlobRefused
import app.shkriuss.core.crypto.HardwareKeyGone
import app.shkriuss.core.crypto.HardwareKeyKind
import app.shkriuss.core.crypto.HardwareKeyNotUsable
import app.shkriuss.core.crypto.HardwareKeyRef
import app.shkriuss.core.crypto.HardwareKeys
import app.shkriuss.core.crypto.SecurityLevel
import java.security.AlgorithmParameters
import java.security.Key
import java.security.Provider
import java.security.SecureRandom
import java.security.spec.AlgorithmParameterSpec
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.CipherSpi
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Hardware keys for unit tests, where no Android Keystore exists: ordinary
 * AES-256-GCM keys in memory, with the byte layout of the real ones (a
 * 12-byte IV, the ciphertext, a 16-byte tag).
 *
 * The switches make it behave like a phone in the states that the rules
 * for hardware keys are about.
 */
internal class SoftwareHardwareKeys : HardwareKeys {
    private val keys = LinkedHashMap<String, SecretKey>()
    private val random = SecureRandom()

    /** False for a phone with no screen lock. */
    var screenLock = true

    /** A locked phone: the Unlocked key cannot be used. */
    var phoneLocked = false

    /** A Keystore that fails for a moment: it cannot say anything, and its list comes back empty. */
    var keystoreFails = false

    /** Only the list fails, and comes back empty. */
    var listFails = false

    /** Aliases the list leaves out, for a list that comes back short. */
    val leftOutOfList = mutableSetOf<String>()

    /**
     * Aliases that Android says are permanently invalidated: the alias
     * stays, and starting a cipher of it fails as for a key that is gone.
     */
    val invalidated = mutableSetOf<String>()

    /**
     * Aliases whose cipher starts, and then, when the prompt has
     * succeeded, refuses its key as permanently invalidated.
     */
    val invalidatedAtFinish = mutableSetOf<String>()

    /** Android cannot make keys. */
    var cannotMake = false

    /** Every key that was made, in order. */
    val made = mutableListOf<HardwareKeyRef>()

    /** Every key that was deleted, in order. */
    val deleted = mutableListOf<HardwareKeyRef>()

    /** The aliases that really exist, whatever the list says. */
    fun existing(): Set<String> = keys.keys.toSet()

    /** Puts a key with known bytes under an alias, for the vectors. */
    fun put(key: HardwareKeyRef, bytes: ByteArray) {
        keys[key.alias] = SecretKeySpec(bytes, "AES")
    }

    /** What Android does when the screen lock is removed: the keys that need the prompt are deleted. */
    fun removeScreenLock() {
        screenLock = false
        keys.keys.removeAll { HardwareKeyRef.ofAlias(it)?.kind?.needsPrompt == true }
    }

    /** Loses one key, as if Android had deleted it. */
    fun lose(key: HardwareKeyRef) {
        keys.remove(key.alias)
    }

    override fun hasScreenLock(): Boolean = screenLock

    override fun aliases(): Set<String> =
        if (keystoreFails || listFails) emptySet() else keys.keys - leftOutOfList

    override fun exists(key: HardwareKeyRef): Boolean {
        if (keystoreFails) throw HardwareKeyNotUsable()
        return key.alias in keys
    }

    override fun make(key: HardwareKeyRef) {
        if (keystoreFails) throw HardwareKeyNotUsable()
        if (cannotMake || (key.kind.needsPrompt && !screenLock)) throw CannotMakeHardwareKeyException(null)
        check(key.alias !in keys) { "A key is never made under an alias that exists: ${key.alias}" }
        keys[key.alias] = SecretKeySpec(ByteArray(32).also { random.nextBytes(it) }, "AES")
        made += key
    }

    override fun delete(key: HardwareKeyRef) {
        if (keystoreFails) throw HardwareKeyNotUsable()
        if (keys.remove(key.alias) != null) deleted += key
    }

    override fun securityLevel(key: HardwareKeyRef): SecurityLevel {
        usable(key)
        return SecurityLevel.SOFTWARE
    }

    override fun encrypt(key: HardwareKeyRef, plaintext: ByteArray, associatedData: ByteArray): ByteArray {
        check(!key.kind.needsPrompt) { "A key that needs the prompt is used through startCipher" }
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, usable(key), GCMParameterSpec(128, iv))
        cipher.updateAAD(associatedData)
        return iv + cipher.doFinal(plaintext)
    }

    override fun decrypt(key: HardwareKeyRef, ivCiphertextTag: ByteArray, associatedData: ByteArray): ByteArray {
        check(!key.kind.needsPrompt) { "A key that needs the prompt is used through startCipher" }
        val secret = usable(key)
        if (ivCiphertextTag.size < 12 + 16) throw HardwareBlobRefused()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, ivCiphertextTag, 0, 12))
        cipher.updateAAD(associatedData)
        try {
            return cipher.doFinal(ivCiphertextTag, 12, ivCiphertextTag.size - 12)
        } catch (_: AEADBadTagException) {
            throw HardwareBlobRefused()
        }
    }

    override fun startCipher(key: HardwareKeyRef, iv: ByteArray?): Cipher {
        check(key.kind.needsPrompt) { "Only a key that needs the prompt is used through startCipher" }
        val secret = usable(key)
        if (key.alias in invalidated) throw HardwareKeyGone()
        if (key.alias in invalidatedAtFinish) return InvalidatedAtFinish.cipher()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        if (iv == null) {
            cipher.init(Cipher.ENCRYPT_MODE, secret)
        } else {
            cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, iv))
        }
        return cipher
    }

    private fun usable(key: HardwareKeyRef): SecretKey {
        if (keystoreFails) throw HardwareKeyNotUsable()
        val secret = keys[key.alias] ?: throw HardwareKeyGone()
        if (phoneLocked && key.kind == HardwareKeyKind.UNLOCKED) throw HardwareKeyNotUsable()
        return secret
    }
}

/**
 * A cipher that starts, and refuses its key as permanently invalidated
 * when it finishes, as Android's Keystore can. It comes from a provider of
 * its own, which only the tests know.
 */
internal object InvalidatedAtFinish : Provider("ShkInvalidatedAtFinish", 1.0, "A cipher whose key turns out invalidated") {
    private const val NAME = "ShkInvalidatedAtFinish"

    init {
        put("Cipher.$NAME", Spi::class.java.name)
    }

    /** A started cipher of this kind. */
    fun cipher(): Cipher = Cipher.getInstance(NAME, this).apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(ByteArray(32), "AES")) }

    /** What the cipher does: everything but its finish works. */
    class Spi : CipherSpi() {
        override fun engineSetMode(mode: String?) = Unit

        override fun engineSetPadding(padding: String?) = Unit

        override fun engineGetBlockSize(): Int = 0

        override fun engineGetOutputSize(inputLen: Int): Int = inputLen

        override fun engineGetIV(): ByteArray? = null

        override fun engineGetParameters(): AlgorithmParameters? = null

        override fun engineInit(opmode: Int, key: Key?, random: SecureRandom?) = Unit

        override fun engineInit(opmode: Int, key: Key?, params: AlgorithmParameterSpec?, random: SecureRandom?) = Unit

        override fun engineInit(opmode: Int, key: Key?, params: AlgorithmParameters?, random: SecureRandom?) = Unit

        override fun engineUpdate(input: ByteArray?, inputOffset: Int, inputLen: Int): ByteArray = ByteArray(0)

        override fun engineUpdate(input: ByteArray?, inputOffset: Int, inputLen: Int, output: ByteArray?, outputOffset: Int): Int = 0

        override fun engineUpdateAAD(src: ByteArray?, offset: Int, len: Int) = Unit

        override fun engineDoFinal(input: ByteArray?, inputOffset: Int, inputLen: Int): ByteArray =
            throw KeyPermanentlyInvalidatedException()

        override fun engineDoFinal(input: ByteArray?, inputOffset: Int, inputLen: Int, output: ByteArray?, outputOffset: Int): Int =
            throw KeyPermanentlyInvalidatedException()
    }
}
