package app.shkriuss.core.crypto

import android.hardware.biometrics.BiometricPrompt
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.security.GeneralSecurityException
import javax.crypto.BadPaddingException
import javax.crypto.Cipher

/**
 * How well Android protects a hardware key ("StrongBox and other
 * hardware" in crypto-design.md). Android's answers "software" and
 * "unknown" both count as [SOFTWARE].
 */
enum class SecurityLevel {
    /** A separate secure chip. */
    STRONGBOX,

    /** The trusted execution environment of the main processor. */
    TEE,

    /** Secure hardware, but Android does not say which kind. */
    SECURE_KIND_UNKNOWN,

    /** No hardware protection. Emulators are such phones. */
    SOFTWARE,
}

/**
 * The hardware keys of one app, as `core/crypto` uses them. The real ones
 * live in the Android Keystore ([AndroidHardwareKeys]). Unit tests run
 * where no Keystore exists, so the rest of the module takes this interface
 * through its constructor, and the tests pass a software one with the same
 * byte layout.
 *
 * Every function may throw [HardwareKeyNotUsable]. Only [HardwareKeyGone]
 * means a key is lost for good.
 */
internal interface HardwareKeys {
    /** True on Android 15 and later, where an Unlocked key may exist. */
    val unlockedKeyAllowed: Boolean

    /** Whether the phone has a screen lock. Keys that need the prompt can only be made with one. */
    fun hasScreenLock(): Boolean

    /**
     * The aliases the Keystore lists. When the Keystore fails, the list is
     * short or empty. So it is never proof that a key is gone. It serves
     * only to pick the next number and to find keys that no file names.
     */
    fun aliases(): Set<String>

    /**
     * Whether a key exists under exactly this alias. False only when the
     * Keystore says "not found". If it cannot say, this throws
     * [HardwareKeyNotUsable].
     */
    fun exists(key: HardwareKeyRef): Boolean

    /**
     * Makes the key, in StrongBox where the phone has it, else once more
     * without. Throws [CannotMakeHardwareKeyException]. The caller has
     * checked with [exists] that the alias is free.
     */
    fun make(key: HardwareKeyRef)

    /** Deletes the key. */
    fun delete(key: HardwareKeyRef)

    /** Where the key lives. */
    fun securityLevel(key: HardwareKeyRef): SecurityLevel

    /** For a key that needs no prompt: the IV, the ciphertext and the tag. */
    fun encrypt(key: HardwareKeyRef, plaintext: ByteArray, associatedData: ByteArray): ByteArray

    /** For a key that needs no prompt: opens what [encrypt] made. Throws [HardwareBlobRefused]. */
    fun decrypt(key: HardwareKeyRef, ivCiphertextTag: ByteArray, associatedData: ByteArray): ByteArray

    /**
     * For a key that needs the prompt: a started `AES/GCM/NoPadding`
     * cipher. With [iv] it decrypts, with a 128-bit tag. Without, it
     * encrypts and the Keystore picks the IV. Associated data is not given
     * yet: the Keystore refuses it before the user has answered the prompt.
     */
    fun startCipher(key: HardwareKeyRef, iv: ByteArray?): Cipher
}

/** Why an operation with a hardware key failed. The three cases are handled differently, never mixed up. */
internal sealed class HardwareKeyFailure(message: String) : Exception(message)

/** The alias does not exist, or Android says the key is permanently invalidated. */
internal class HardwareKeyGone : HardwareKeyFailure("The hardware key is gone")

/** Any other failure: the phone is locked, the prompt was not answered, or the Keystore is busy. Nothing is lost. */
internal class HardwareKeyNotUsable : HardwareKeyFailure("The hardware key is not usable now")

/** The Keystore checked the tag of a blob and refused it. */
internal class HardwareBlobRefused : HardwareKeyFailure("The Keystore refused the blob")

/**
 * Thrown when Android could not make a hardware key, with StrongBox and
 * without. Nothing was made and nothing was changed. The cause is
 * Android's own error, for the app to show.
 */
class CannotMakeHardwareKeyException internal constructor(cause: Throwable?) :
    Exception("Android could not make a hardware key", cause)

/**
 * One cipher for one system prompt, with a key that needs the prompt for
 * every use. The order of calls is fixed by Android ("Where Android does
 * the work" in crypto-design.md):
 *
 * 1. The cipher is started before the prompt ([HardwareKeys.startCipher]).
 * 2. The prompt gets the [cryptoObject].
 * 3. Only after the prompt succeeds: [finish] gives the associated data,
 *    then the data. After encrypting it reads the IV from the cipher.
 *
 * If the prompt is cancelled or fails, the cipher is thrown away.
 */
internal class PromptCipher(private val cipher: Cipher, private val encrypts: Boolean) {
    /** What the screen code hands to Android's `BiometricPrompt`. */
    val cryptoObject: BiometricPrompt.CryptoObject = BiometricPrompt.CryptoObject(cipher)

    /**
     * Encrypting: returns the IV, the ciphertext and the tag. Decrypting:
     * [input] is the ciphertext and the tag, and the plaintext is returned.
     */
    fun finish(input: ByteArray, associatedData: ByteArray): ByteArray {
        try {
            cipher.updateAAD(associatedData)
            val output = cipher.doFinal(input)
            if (!encrypts) return output
            val iv = cipher.iv
            if (iv == null || iv.size != WrappedKeyset.IV_SIZE) throw HardwareKeyNotUsable()
            return iv + output
        } catch (_: BadPaddingException) {
            throw HardwareBlobRefused()
        } catch (_: KeyPermanentlyInvalidatedException) {
            throw HardwareKeyGone()
        } catch (_: GeneralSecurityException) {
            throw HardwareKeyNotUsable()
        } catch (_: RuntimeException) {
            throw HardwareKeyNotUsable()
        }
    }
}
