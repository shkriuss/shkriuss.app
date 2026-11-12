package app.shkriuss.core.crypto

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import com.google.crypto.tink.integration.android.AndroidKeystore
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * The hardware keys in the Android Keystore. It uses Tink's
 * `AndroidKeystore` helper where it can, and calls Android directly where
 * the table "Where Android does the work" in crypto-design.md says so:
 *
 * - the cipher of a key that needs the prompt,
 * - reading a key's security level,
 * - listing the app's keys (`KeyStore.aliases`),
 * - asking whether one key exists (`KeyStore.getKey`). Tink's `hasKey`
 *   also answers "no" when the Keystore only failed for a moment.
 *
 * No Keystore exists where unit tests run. This class is first proven by
 * the emulator tests (step 1.4, session C). It is kept thin for that
 * reason: every rule about hardware keys is in [KeyVault], which the unit
 * tests cover.
 */
internal class AndroidHardwareKeys(
    private val context: Context,
    /** The Android version this app runs on. */
    private val androidVersion: Int = Build.VERSION.SDK_INT,
) : HardwareKeys {
    /**
     * Android 12 to 14 delete keys that need an unlocked phone when the
     * screen lock is removed, and cannot make them without one. Android 15
     * fixed this, so there is an Unlocked key only from Android 15.
     */
    override val unlockedKeyAllowed: Boolean
        get() = androidVersion >= Build.VERSION_CODES.VANILLA_ICE_CREAM

    override fun hasScreenLock(): Boolean =
        context.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    override fun aliases(): Set<String> = try {
        keyStore().aliases().toList().toSet()
    } catch (_: Exception) {
        emptySet()
    }

    override fun exists(key: HardwareKeyRef): Boolean = secretKey(key) != null

    override fun make(key: HardwareKeyRef) {
        var failure: Exception? = null
        if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
            failure = tryToMake(key, strongBox = true) ?: return
            // A key is never made under an alias that exists.
            if (exists(key)) throw CannotMakeHardwareKeyException(failure)
        }
        failure = tryToMake(key, strongBox = false) ?: return
        throw CannotMakeHardwareKeyException(failure)
    }

    private fun tryToMake(key: HardwareKeyRef, strongBox: Boolean): Exception? = try {
        AndroidKeystore.generateNewKeyWithSpec(HardwareKeySpecs.spec(key, strongBox))
        null
    } catch (failed: Exception) {
        failed
    }

    override fun delete(key: HardwareKeyRef) {
        try {
            AndroidKeystore.deleteKey(key.alias)
        } catch (_: Exception) {
            throw HardwareKeyNotUsable()
        }
    }

    override fun securityLevel(key: HardwareKeyRef): SecurityLevel {
        val secret = secretKey(key) ?: throw HardwareKeyGone()
        val level = try {
            val factory = SecretKeyFactory.getInstance(secret.algorithm, KEYSTORE)
            (factory.getKeySpec(secret, KeyInfo::class.java) as KeyInfo).securityLevel
        } catch (_: Exception) {
            throw HardwareKeyNotUsable()
        }
        return when (level) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> SecurityLevel.STRONGBOX
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> SecurityLevel.TEE
            KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> SecurityLevel.SECURE_KIND_UNKNOWN
            else -> SecurityLevel.SOFTWARE
        }
    }

    override fun encrypt(key: HardwareKeyRef, plaintext: ByteArray, associatedData: ByteArray): ByteArray =
        use(key) { AndroidKeystore.getAead(key.alias).encrypt(plaintext, associatedData) }

    override fun decrypt(key: HardwareKeyRef, ivCiphertextTag: ByteArray, associatedData: ByteArray): ByteArray =
        use(key) { AndroidKeystore.getAead(key.alias).decrypt(ivCiphertextTag, associatedData) }

    override fun startCipher(key: HardwareKeyRef, iv: ByteArray?): Cipher {
        val secret = secretKey(key) ?: throw HardwareKeyGone()
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            if (iv == null) {
                cipher.init(Cipher.ENCRYPT_MODE, secret)
            } else {
                cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG_BITS, iv))
            }
            return cipher
        } catch (_: KeyPermanentlyInvalidatedException) {
            throw HardwareKeyGone()
        } catch (_: GeneralSecurityException) {
            throw HardwareKeyNotUsable()
        } catch (_: RuntimeException) {
            throw HardwareKeyNotUsable()
        }
    }

    /**
     * Runs one operation of a key that needs no prompt, and sorts its
     * failure: a refused tag, a key that is gone, or not usable now.
     */
    private inline fun <T> use(key: HardwareKeyRef, operation: () -> T): T {
        try {
            return operation()
        } catch (_: BadPaddingException) {
            throw HardwareBlobRefused()
        } catch (_: KeyPermanentlyInvalidatedException) {
            throw HardwareKeyGone()
        } catch (_: GeneralSecurityException) {
            throw if (exists(key)) HardwareKeyNotUsable() else HardwareKeyGone()
        } catch (_: RuntimeException) {
            throw if (exists(key)) HardwareKeyNotUsable() else HardwareKeyGone()
        }
    }

    /**
     * The key under this exact alias, or null only if the Keystore says
     * "not found". Any other failure is "not usable now".
     */
    private fun secretKey(key: HardwareKeyRef): SecretKey? = try {
        keyStore().getKey(key.alias, null) as SecretKey?
    } catch (_: Exception) {
        throw HardwareKeyNotUsable()
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}
