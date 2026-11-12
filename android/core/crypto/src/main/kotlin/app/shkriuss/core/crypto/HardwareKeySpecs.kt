package app.shkriuss.core.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

/**
 * The settings of each kind of hardware key, as given to
 * `KeyGenParameterSpec.Builder` (the settings table under "Hardware keys"
 * in crypto-design.md). The Keystore always picks the IV: the setting that
 * would let a caller pick one is never used.
 */
internal object HardwareKeySpecs {
    private const val KEY_BITS = 256

    /** Timeout 0: the key works for one operation per prompt. */
    private const val EVERY_USE = 0

    /** The spec of [key]. [strongBox] asks for the key to be made in StrongBox. */
    fun spec(key: HardwareKeyRef, strongBox: Boolean): KeyGenParameterSpec {
        val builder = KeyGenParameterSpec.Builder(
            key.alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setKeySize(KEY_BITS)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        if (strongBox) builder.setIsStrongBoxBacked(true)
        if (key.kind == HardwareKeyKind.UNLOCKED) builder.setUnlockedDeviceRequired(true)
        if (key.kind.needsPrompt) {
            builder.setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(
                    EVERY_USE,
                    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
                )
                .setInvalidatedByBiometricEnrollment(false)
        }
        return builder.build()
    }
}
