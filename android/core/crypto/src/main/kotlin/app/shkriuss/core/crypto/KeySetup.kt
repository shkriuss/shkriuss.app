package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle

/** What [KeySetup.storeDerivedKeys] did with a recovery key. */
enum class KeySetupResult {
    /** Every derived keyset is stored. The app has its keys from this recovery key. */
    STORED,

    /** The key is an older recovery key of this app, not the current one. Nothing was stored. */
    OLDER_RECOVERY_KEY,

    /** The app already holds keys from another recovery key. Nothing was stored. */
    DIFFERENT_RECOVERY_KEY,
}

/**
 * Creating and entering a recovery key, as far as keys go ("The recovery
 * key" in crypto-design.md). The screens are built in a later step.
 *
 * The order for a new key is: [createRecoveryKey], show the words, let the
 * user confirm four of them ([RecoveryKey.hasWordsAt]), and only then
 * [storeDerivedKeys] and [beginKeepRecoveryKey]. Entered words go straight
 * to the last two.
 */
class KeySetup internal constructor(private val vault: KeyVault) {
    /**
     * A new recovery key. Nothing is stored. A key whose key ID is 0, or
     * the ID of a recovery key this app already has, is thrown away and
     * made again.
     */
    fun createRecoveryKey(): RecoveryKey = vault.locked {
        val known = (vault.look(KeysetName.RECORD) as? Stored.Open)?.let { KeysetCodec.keyIds(it.keyset) }.orEmpty()
        var key = RecoveryKey.newRandom()
        while (key.keyId.value == 0 || key.keyId in known) key = RecoveryKey.newRandom()
        key
    }

    /**
     * Derives the app's `record`, `backup` and `file-key` keysets from
     * [recoveryKey] and stores each one whose file is missing or whose
     * hardware key is gone. The others are left as they are. Each step can
     * be done twice without harm, so after a stop the same words finish it.
     *
     * Before anything is stored, every derived keyset that is already
     * stored and opens must be the one this key derives. If not, nothing
     * is stored. So only the same words can finish a setup that already
     * stored a derived keyset, and a different recovery key is never taken
     * by accident. A stored `file-key` that is not derived from this key
     * is allowed in one case: it is the old keyset, which is kept as
     * `file-key-old`.
     *
     * Throws [BlobException] if a stored keyset cannot be judged now.
     * Nothing is stored then either.
     */
    fun storeDerivedKeys(recoveryKey: RecoveryKey): KeySetupResult =
        vault.locked { storeDerived(RecoveryKeyDeriver.recoveryKeyset(listOf(recoveryKey), recoveryKey)) }

    /** As [storeDerivedKeys], for a `recovery` keyset that may hold more than one recovery key. */
    internal fun storeDerived(recovery: KeysetHandle): KeySetupResult {
        val derived = RecoveryKeyDeriver.derive(recovery, vault.app)
        val record = judged(KeysetName.RECORD)
        val backup = judged(KeysetName.BACKUP)
        val fileKey = judged(KeysetName.FILE_KEY)
        val fileKeyOld = judged(KeysetName.FILE_KEY_OLD)

        if (record is Stored.Open && !KeysetCodec.holdsAll(record.keyset, derived.record)) {
            return if (sharesAKey(record.keyset, derived.record)) {
                KeySetupResult.OLDER_RECOVERY_KEY
            } else {
                KeySetupResult.DIFFERENT_RECOVERY_KEY
            }
        }
        if (backup is Stored.Open && !KeysetCodec.holdsAll(backup.keyset, derived.backup)) {
            return KeySetupResult.DIFFERENT_RECOVERY_KEY
        }
        // A stored file-key that is not the derived one is the old keyset: the random
        // one, or one of a setup that was given up. It is kept as file-key-old. If
        // file-key-old exists already, file-key must still be that same keyset, which
        // is where a stop between the two writes leaves it. Anything else was sealed
        // by keys of another recovery key and would be lost.
        val fileKeyDiffers = fileKey is Stored.Open && !KeysetCodec.holdsAll(fileKey.keyset, derived.fileKey)
        val oldIsKept = fileKey is Stored.Open && fileKeyOld is Stored.Open &&
            fileKey.keyset.equalsKeyset(fileKeyOld.keyset)
        if (fileKeyDiffers && fileKeyOld !is Stored.Missing && !oldIsKept) {
            return KeySetupResult.DIFFERENT_RECOVERY_KEY
        }

        // The page's order: file-key-old, file-key, backup, and record last.
        // The app has its derived keys when record exists. file-key-old is
        // never written a second time.
        if (fileKey is Stored.Open && fileKeyDiffers && fileKeyOld is Stored.Missing) {
            vault.wrapAndStore(KeysetName.FILE_KEY_OLD, fileKey.keyset, fileKey.key)
        }
        if (fileKeyDiffers || isToStore(fileKey)) {
            vault.wrapAndStore(KeysetName.FILE_KEY, derived.fileKey, vault.keyFor(vault.fileKeyHome))
        }
        if (isToStore(backup)) {
            vault.wrapAndStore(KeysetName.BACKUP, derived.backup, vault.keyFor(vault.fileKeyHome))
        }
        if (isToStore(record)) {
            vault.wrapAndStore(KeysetName.RECORD, derived.record, vault.keyFor(HardwareKeyKind.BACKGROUND))
        }
        vault.forgetAll()
        return KeySetupResult.STORED
    }

    /** What is stored for [name]. Stops the setup if that cannot be judged now, or if the file is damaged. */
    private fun judged(name: KeysetName): Stored = when (val stored = vault.look(name)) {
        is Stored.NotUsableNow -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        is Stored.Damaged -> throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        else -> stored
    }

    /** A keyset is stored when its file is missing or its hardware key is gone. */
    private fun isToStore(stored: Stored): Boolean = stored is Stored.Missing || stored is Stored.KeyGone

    private fun sharesAKey(stored: KeysetHandle, derived: KeysetHandle): Boolean =
        (0 until derived.size()).any { index ->
            val entry = derived.getAt(index)
            (0 until stored.size()).any { stored.getAt(it).id == entry.id && stored.getAt(it).key.equalsKey(entry.key) }
        }

    /**
     * True if this app keeps the recovery key on the phone, so it can show
     * it again. Such an app is a keeper.
     */
    fun keepsRecoveryKey(): Boolean = vault.locked { vault.look(KeysetName.RECOVERY) is Stored.NeedsPrompt }

    /**
     * Starts keeping [recoveryKey] on the phone: makes a Recovery guard,
     * which needs the system prompt for every use, and returns the step to
     * show the prompt for. `finish()` stores the key.
     *
     * Returns null if there is nothing to do: the phone has no screen
     * lock, so the key cannot be kept, or this app keeps it already. If
     * the user cancels the prompt, the key is not kept and everything else
     * still works.
     */
    fun beginKeepRecoveryKey(recoveryKey: RecoveryKey): PromptStep<Unit>? = vault.locked {
        if (!vault.hardware.hasScreenLock()) return@locked null
        when (judged(KeysetName.RECOVERY)) {
            is Stored.NeedsPrompt -> return@locked null
            else -> Unit
        }
        val guard = vault.newKey(HardwareKeyKind.RECOVERY_GUARD)
        val cipher = try {
            PromptCipher(vault.hardware.startCipher(guard, null), encrypts = true)
        } catch (failed: HardwareKeyFailure) {
            vault.deleteIfUnnamed(guard)
            throw failed
        }
        val recovery = RecoveryKeyDeriver.recoveryKeyset(listOf(recoveryKey), recoveryKey)
        PromptStep(
            cryptoObject = cipher.cryptoObject,
            onFinish = { vault.locked { vault.storeWithPrompt(KeysetName.RECOVERY, recovery, guard, cipher) } },
            onCancel = { vault.locked { vault.deleteIfUnnamed(guard) } },
        )
    }

    /**
     * Starts showing the kept recovery key again: one prompt, one showing.
     * `finish()` returns the key. Drop it when the screen closes. Throws
     * [BlobException] if this app does not keep the key, or its Recovery
     * guard is gone because the screen lock was removed.
     */
    fun beginShowRecoveryKey(): PromptStep<RecoveryKey> = vault.locked {
        val stored = judged(KeysetName.RECOVERY) as? Stored.NeedsPrompt
            ?: throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        val cipher = PromptCipher(vault.hardware.startCipher(stored.key, WrappedKeyset.iv(stored.blob)), encrypts = false)
        PromptStep(
            cryptoObject = cipher.cryptoObject,
            onFinish = {
                vault.locked {
                    RecoveryKeyDeriver.recoveryKeys(vault.openWithPrompt(KeysetName.RECOVERY, stored, cipher)).first()
                }
            },
            onCancel = {},
        )
    }

    /**
     * True while file keys are still sealed by the random key the app had
     * before its recovery key. Until every row is sealed again
     * ([FileCrypto.sealAgain]) and [finishFileKeyMove] is called, the app
     * makes no backup, sends no file records to sync and cannot turn the
     * app lock on.
     */
    fun fileKeyMoveIsPending(): Boolean = vault.locked { vault.isStored(KeysetName.FILE_KEY_OLD) }

    /**
     * Deletes the old random file-key keyset. Call it only when no row is
     * left whose file key it sealed: after this, such a file key can never
     * be opened again.
     */
    fun finishFileKeyMove() = vault.locked {
        vault.remove(KeysetName.FILE_KEY_OLD)
        vault.forgetAll()
    }
}
