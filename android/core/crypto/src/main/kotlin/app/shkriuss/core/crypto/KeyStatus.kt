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
    /**
     * True if a setup stopped half way: some derived keysets are stored,
     * but not `record`. The same words finish it. A user who cannot give
     * them can start over ([KeySetup.startOver]).
     */
    val setupIsUnfinished: Boolean,
    /**
     * True if a keyset file that the recovery words can bring back is
     * damaged. Entering the words repairs it ([KeySetup.storeDerivedKeys],
     * then [KeySetup.beginKeepRecoveryKey] for a kept key).
     */
    val needsRepair: Boolean,
    /**
     * True if a keyset that seals file keys is damaged and no words can
     * bring it back. The user can give those files up
     * ([KeySetup.giveUpDamagedFileKeys]). They can then never be opened,
     * on any device.
     */
    val filesCanBeGivenUp: Boolean,
    /** The hardware keys that wrap this app's keysets, with the level of each. */
    val hardwareKeys: List<HardwareKeyStatus>,
)
