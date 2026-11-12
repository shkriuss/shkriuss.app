package app.shkriuss.core.crypto

/** One hardware key the app has, for the security screen. */
class HardwareKeyStatus internal constructor(val kind: HardwareKeyKind, val level: SecurityLevel) {
    override fun toString(): String = "$kind: $level"
}

/**
 * What an app's security screen shows about its keys. Nothing here is
 * secret.
 */
class KeyStatus internal constructor(
    /** True if the app has its keys from a recovery key: its `record` keyset is stored. */
    val hasDerivedKeys: Boolean,
    /** The public ID of the current recovery key, if the app has its keys and can read them now. */
    val keyId: KeyId?,
    /** True if this app keeps the recovery key on the phone and can show it again. */
    val keepsRecoveryKey: Boolean,
    /** The state of the app lock. */
    val appLock: AppLockState,
    /** True if the phone has a screen lock. Without one, the recovery key is not kept and there is no app lock. */
    val hasScreenLock: Boolean,
    /** True while file keys are still sealed by a key that exists only on this phone. */
    val fileKeyMoveIsPending: Boolean,
    /** The hardware keys that wrap this app's keysets, with the level of each. */
    val hardwareKeys: List<HardwareKeyStatus>,
)
