package app.shkriuss.core.crypto

/** Whether the optional app lock is on. Nothing but the `file-key` keyset file stores this. */
enum class AppLockState {
    /** The app lock is off. */
    OFF,

    /** The app lock is on: the file keys need the system prompt. */
    ON,

    /**
     * The app lock was on, and its Lock key is gone, because the screen
     * lock was removed. The app lock is off and the app says that it was
     * reset. The app's files stay closed until the recovery words are
     * entered.
     */
    RESET,
}

/**
 * The optional app lock, as far as keys go ("The app lock" in
 * crypto-design.md). With it on, the `file-key` keyset is wrapped by a
 * Lock key that needs the system prompt: one prompt, one operation, one
 * unlock. Records, sync and reminders go on while the app is locked.
 */
class AppLock internal constructor(private val vault: KeyVault) {
    /** The state of the app lock. */
    fun state(): AppLockState = vault.locked {
        vault.keepFilesIfLockKeyIsGone()
        val key = vault.namedKeyOrNull(KeysetName.FILE_KEY)
        when {
            key?.kind != HardwareKeyKind.LOCK -> AppLockState.OFF
            vault.isGone(key) -> AppLockState.RESET
            else -> AppLockState.ON
        }
    }

    /**
     * True if the app lock is on and the app is locked: the file keys are
     * not in memory, and the next use of a file needs [beginUnlock].
     */
    fun isLocked(): Boolean = vault.locked { state() == AppLockState.ON && vault.fileKeyInMemory() == null }

    /**
     * True if the app lock can be turned on: it is off, the phone has a
     * screen lock, the app has its keys from a recovery key, and no file
     * key is still sealed by a key that exists only on this phone. Then
     * the recovery words can always bring the file keys back.
     */
    fun canTurnOn(): Boolean = vault.locked {
        state() == AppLockState.OFF && vault.hardware.hasScreenLock() && vault.mayShareFileKeys() &&
            vault.isStored(KeysetName.FILE_KEY)
    }

    /**
     * Starts turning the app lock on. Before this, the app has checked the
     * recovery words: [proof] comes from [KeySetup.checkFourWords] in an
     * app that keeps the recovery key, or from [KeySetup.checkAllWords] in
     * one that does not. A proof for another `record` key than the one
     * stored now is refused with [IllegalStateException]: the keys changed
     * since the words were checked. The steps, in an order that a stop at
     * any point cannot harm:
     *
     * 1. A new key of the kind that wrapped `file-key` until now is made,
     *    and the other keysets of the old one move to it.
     * 2. A new Lock key is made, and the step for its prompt is returned.
     * 3. `finish()` wraps `file-key` with the Lock key and replaces its
     *    file. The app lock is now on, and unlocked.
     * 4. The old key is deleted last. Without this, an old copy of the
     *    keyset file somewhere on the phone's storage could still be
     *    opened without the prompt.
     *
     * After a stop, the old key is either still in use or named by no
     * file, and then it is deleted at the next start. If the prompt is
     * cancelled, the app lock stays off.
     */
    fun beginTurnOn(proof: WordsProof): PromptStep<Unit> = vault.locked {
        check(canTurnOn()) { "The app lock cannot be turned on now" }
        val record = vault.look(KeysetName.RECORD) as? Stored.Open
            ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        check(KeysetCodec.primaryId(record.keyset) == proof.keyId) { "The words were checked against another recovery key" }
        val fileKey = vault.look(KeysetName.FILE_KEY) as? Stored.Open
            ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        val oldKey = fileKey.key
        moveOtherKeysetsOff(oldKey)
        val lockKey = vault.newKey(HardwareKeyKind.LOCK)
        val cipher = try {
            PromptCipher(vault.hardware.startCipher(lockKey, null), encrypts = true)
        } catch (failed: HardwareKeyFailure) {
            vault.deleteIfUnnamed(lockKey)
            throw failed
        }
        PromptStep(
            cryptoObject = cipher.cryptoObject,
            onFinish = {
                vault.locked {
                    check(vault.namedKeyOrNull(KeysetName.FILE_KEY) == oldKey) { "The file-key keyset was changed" }
                    vault.storeWithPrompt(KeysetName.FILE_KEY, fileKey.keyset, lockKey, cipher)
                    vault.rememberFileKey(fileKey.keyset)
                    vault.deleteIfUnnamed(oldKey)
                }
            },
            onCancel = { vault.locked { vault.deleteIfUnnamed(lockKey) } },
        )
    }

    /** Moves every keyset but `file-key` from [oldKey] to a new key of the same kind. */
    private fun moveOtherKeysetsOff(oldKey: HardwareKeyRef) {
        val names = KeysetName.entries.filter { it != KeysetName.FILE_KEY && vault.namedKeyOrNull(it) == oldKey }
        if (names.isEmpty()) return
        val opened = names.map { name ->
            name to (vault.look(name) as? Stored.Open ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW))
        }
        val newKey = vault.newKey(oldKey.kind)
        opened.forEach { (name, stored) -> vault.wrapAndStore(name, stored.keyset, newKey) }
    }

    /**
     * Starts an unlock: one decrypt operation with the Lock key, for one
     * prompt. `finish()` puts the `file-key` keyset into memory, where it
     * stays until [lock]. Throws [BlobException] if the app lock is not
     * on, or its Lock key is gone.
     */
    fun beginUnlock(): PromptStep<Unit> = vault.locked {
        val stored = vault.look(KeysetName.FILE_KEY) as? Stored.NeedsPrompt
            ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        val cipher = PromptCipher(vault.hardware.startCipher(stored.key, WrappedKeyset.iv(stored.blob)), encrypts = false)
        PromptStep(
            cryptoObject = cipher.cryptoObject,
            onFinish = {
                vault.locked { vault.rememberFileKey(vault.openWithPrompt(KeysetName.FILE_KEY, stored, cipher)) }
            },
            onCancel = {},
        )
    }

    /**
     * Turns the app lock off, while unlocked: wraps `file-key` with a key
     * that needs no prompt, checks the new blob, replaces the file, and
     * then deletes the Lock key. Throws [BlobException] if the app is
     * locked.
     */
    fun turnOff() = vault.locked {
        val lockKey = vault.namedKeyOrNull(KeysetName.FILE_KEY)
        check(lockKey?.kind == HardwareKeyKind.LOCK) { "The app lock is not on" }
        val keyset = vault.fileKeyInMemory() ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        vault.wrapAndStore(KeysetName.FILE_KEY, keyset, vault.keyFor(vault.fileKeyHome))
        vault.deleteIfUnnamed(lockKey)
    }

    /** Locks the app: drops the file keys from memory. The next use of a file needs a new unlock. */
    fun lock() = vault.forgetFileKeys()
}
