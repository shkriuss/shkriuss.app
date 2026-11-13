package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle

/** How many words [KeySetup.checkFourWords] checks: four, as when a recovery key is created. */
private const val WORDS_TO_CHECK = 4

/** What [KeySetup.storeDerivedKeys] did with a recovery key. */
enum class KeySetupResult {
    /** Every derived keyset is stored. The app has its keys from this recovery key. */
    STORED,

    /** The key is an older recovery key of this app, not the current one. Nothing was stored. */
    OLDER_RECOVERY_KEY,

    /** The app already holds keys from another recovery key. Nothing was stored. */
    DIFFERENT_RECOVERY_KEY,

    /**
     * The key ID of this recovery key is already the ID of another key
     * that seals this app's file keys. A wrapped file key names its key
     * only by that ID, so the two could not be told apart. Nothing was
     * stored. The chance is about 1 in 4 billion.
     */
    KEY_ID_IN_USE,
}

/** What [KeySetup.startOver] did with a new recovery key. */
enum class StartOverResult {
    /**
     * The app has its keys from the new recovery key. The file keys of
     * the stopped setup are kept in `file-key-old`, and the files are
     * sealed again under the new key as for a random `file-key`.
     */
    STORED,

    /** The setup is not unfinished, so there is nothing to start over. Nothing was stored. */
    NOT_UNFINISHED,

    /** As [KeySetupResult.KEY_ID_IN_USE]. Nothing was stored. */
    KEY_ID_IN_USE,

    /**
     * `file-key` or `file-key-old` is damaged. Its keys cannot be kept.
     * The user gives those files up first ([KeySetup.giveUpDamagedFileKeys]).
     * Nothing was stored.
     */
    FILE_KEYS_DAMAGED,
}

/**
 * Creating, entering, keeping and showing the recovery key, as far as
 * keys go ("The recovery key" in crypto-design.md), and the ways out when
 * a setup stopped half way or a keyset file is damaged.
 *
 * The order for a new key is: [createRecoveryKey], show the words, let the
 * user confirm four of them ([RecoveryKey.hasWordsAt]), and only then
 * [storeDerivedKeys] and [beginKeepRecoveryKey]. Entered words go straight
 * to the last two.
 */
class KeySetup internal constructor(private val vault: KeyVault) {
    /**
     * A new recovery key. Nothing is stored. A key whose key ID is 0, or
     * the ID of any key in a keyset this app stores, is thrown away and
     * made again.
     */
    fun createRecoveryKey(): RecoveryKey = vault.locked {
        val known = knownKeyIds()
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
     * A damaged `record`, `backup` or `file-key` is repaired here, if the
     * words are proven: another of the three opens and is exactly the
     * keyset they derive. The damaged file is first copied to the
     * set-aside folder and kept. A damaged `file-key-old` is left as it
     * is. A `file-key` under the app lock that a prompt found damaged is
     * stored again under a key that needs no prompt: the app lock is then
     * off.
     *
     * Throws [BlobException] if a stored keyset cannot be judged now, or
     * is damaged and the words cannot be proven. Nothing is stored then
     * either.
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
        // No key ID may be in file-key and file-key-old with two different keys:
        // a wrapped file key names its key only by that ID.
        val oldKeys = (fileKeyOld as? Stored.Open)?.keyset
        val becomesOld = (fileKey as? Stored.Open)?.keyset?.takeIf { fileKeyDiffers }
        if (KeysetCodec.clashes(derived.fileKey, oldKeys) || KeysetCodec.clashes(derived.fileKey, becomesOld)) {
            return KeySetupResult.KEY_ID_IN_USE
        }

        val looks = mapOf(KeysetName.RECORD to record, KeysetName.BACKUP to backup, KeysetName.FILE_KEY to fileKey)
        val damaged = damagedAmong(looks)
        if (damaged.isNotEmpty() && !isProven(derived, record, backup, fileKey)) {
            throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        }

        // A damaged file is copied aside first and kept. The ordinary
        // replace below then writes the keyset again over it, so no keyset
        // file is ever missing, not even after a stop.
        damaged.forEach { vault.setAside(it) }
        val lockKeyOfDamagedFileKey = (fileKey as? Stored.NeedsPrompt)?.key?.takeIf { KeysetName.FILE_KEY in damaged }

        // The page's order: file-key-old, file-key, backup, and record last.
        // The app has its derived keys when record exists. file-key-old is
        // never written a second time here.
        if (fileKey is Stored.Open && fileKeyDiffers && fileKeyOld is Stored.Missing) {
            vault.wrapAndStore(KeysetName.FILE_KEY_OLD, fileKey.keyset, fileKey.key)
        }
        if (fileKeyDiffers || isToStore(fileKey) || KeysetName.FILE_KEY in damaged) {
            vault.wrapAndStore(KeysetName.FILE_KEY, derived.fileKey, vault.keyFor(vault.fileKeyHome))
        }
        // The repaired file-key no longer names the Lock key: the app lock is off.
        lockKeyOfDamagedFileKey?.let { vault.deleteIfUnnamed(it) }
        if (isToStore(backup) || KeysetName.BACKUP in damaged) {
            vault.wrapAndStore(KeysetName.BACKUP, derived.backup, vault.keyFor(vault.fileKeyHome))
        }
        if (isToStore(record) || KeysetName.RECORD in damaged) {
            vault.wrapAndStore(KeysetName.RECORD, derived.record, vault.keyFor(HardwareKeyKind.BACKGROUND))
        }
        vault.forgetAll()
        return KeySetupResult.STORED
    }

    /**
     * Starts a setup over with [recoveryKey], a new key or other words,
     * when a setup stopped half way and the user cannot give its words
     * again ("Starting over after a setup that stopped" in
     * crypto-design.md). Only while the setup is unfinished: no `record`,
     * no kept recovery key, and a `backup` or a `file-key-old` file.
     *
     * The keys of the stopped setup are kept: the stored `file-key` joins
     * `file-key-old`, which only ever gains keys. The `backup` of the
     * stopped setup is written over. No backup can have used it, because a
     * backup needs `record`. Then `file-key`, `backup` and `record` are
     * stored from [recoveryKey], `record` last. Each step can be done
     * twice without harm.
     *
     * Throws [BlobException] if a stored keyset cannot be judged now.
     */
    fun startOver(recoveryKey: RecoveryKey): StartOverResult =
        vault.locked { startOverWith(RecoveryKeyDeriver.recoveryKeyset(listOf(recoveryKey), recoveryKey)) }

    /** As [startOver], for a `recovery` keyset. */
    internal fun startOverWith(recovery: KeysetHandle): StartOverResult {
        if (!isUnfinished()) return StartOverResult.NOT_UNFINISHED
        val derived = RecoveryKeyDeriver.derive(recovery, vault.app)
        val backup = judged(KeysetName.BACKUP)
        val fileKey = judged(KeysetName.FILE_KEY)
        val fileKeyOld = judged(KeysetName.FILE_KEY_OLD)
        if (fileKey is Stored.Damaged || fileKeyOld is Stored.Damaged) return StartOverResult.FILE_KEYS_DAMAGED
        check(fileKey !is Stored.NeedsPrompt) { "The app lock needs a finished setup" }

        val old = fileKeyOld as? Stored.Open
        val current = fileKey as? Stored.Open
        val keep = current?.keyset?.takeIf { !KeysetCodec.holdsAll(it, derived.fileKey) }
        if (KeysetCodec.clashes(derived.fileKey, old?.keyset) || KeysetCodec.clashes(derived.fileKey, keep) ||
            KeysetCodec.clashes(keep, old?.keyset)
        ) {
            return StartOverResult.KEY_ID_IN_USE
        }

        // file-key-old first, and only when it gains a key. It never loses one.
        if (current != null && keep != null) {
            val newOld = if (old == null) keep else KeysetCodec.union(old.keyset, keep)
            if (newOld != null) vault.wrapAndStore(KeysetName.FILE_KEY_OLD, newOld, old?.key ?: current.key)
        }
        if (current == null || keep != null) {
            vault.wrapAndStore(KeysetName.FILE_KEY, derived.fileKey, vault.keyFor(vault.fileKeyHome))
        }
        if (backup is Stored.Damaged) vault.setAside(KeysetName.BACKUP)
        val backupIsNew = backup is Stored.Open && KeysetCodec.holdsAll(backup.keyset, derived.backup)
        if (!backupIsNew) vault.wrapAndStore(KeysetName.BACKUP, derived.backup, vault.keyFor(vault.fileKeyHome))
        vault.wrapAndStore(KeysetName.RECORD, derived.record, vault.keyFor(HardwareKeyKind.BACKGROUND))
        vault.forgetAll()
        return StartOverResult.STORED
    }

    /**
     * True if a setup stopped half way: no `record`, no kept recovery key,
     * and a `backup` or a `file-key-old` file. Then only the same words
     * finish it, or [startOver] begins again.
     */
    internal fun isUnfinished(): Boolean = !vault.isStored(KeysetName.RECORD) &&
        !vault.isStored(KeysetName.RECOVERY) &&
        (vault.isStored(KeysetName.BACKUP) || vault.isStored(KeysetName.FILE_KEY_OLD))

    /**
     * True if a keyset that the recovery words can bring back is damaged,
     * and another stored keyset could prove the words. The user then
     * enters the words to repair it.
     */
    internal fun needsRepair(): Boolean {
        val looks = listOf(KeysetName.RECORD, KeysetName.BACKUP, KeysetName.FILE_KEY)
            .associateWith { vault.look(it) }
        val recovery = vault.look(KeysetName.RECOVERY)
        val damaged = damagedAmong(looks).isNotEmpty() || recovery is Stored.Damaged ||
            (recovery is Stored.NeedsPrompt && vault.isDamagedBehindPrompt(KeysetName.RECOVERY))
        return damaged && looks.values.any { it is Stored.Open }
    }

    /** What is stored for [name]. Stops the setup if that cannot be judged now. */
    private fun judged(name: KeysetName): Stored = when (val stored = vault.look(name)) {
        is Stored.NotUsableNow -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        else -> stored
    }

    /** The keysets among [looks] that are damaged, as `look()` sees it or as a prompt found it. */
    private fun damagedAmong(looks: Map<KeysetName, Stored>): List<KeysetName> = looks.filter { (name, stored) ->
        stored is Stored.Damaged || (stored is Stored.NeedsPrompt && vault.isDamagedBehindPrompt(name))
    }.keys.toList()

    /**
     * True if one stored keyset that opens is exactly the one the words
     * derive. Exactly: a stored keyset with more keys would lose some if
     * the repair stored only these.
     */
    private fun isProven(derived: DerivedKeysets, record: Stored, backup: Stored, fileKey: Stored): Boolean =
        listOf(record to derived.record, backup to derived.backup, fileKey to derived.fileKey).any { (stored, wanted) ->
            stored is Stored.Open && KeysetCodec.sameKeys(stored.keyset, wanted)
        }

    /** A keyset is stored when its file is missing or its hardware key is gone. */
    private fun isToStore(stored: Stored): Boolean = stored is Stored.Missing || stored is Stored.KeyGone

    private fun sharesAKey(stored: KeysetHandle, derived: KeysetHandle): Boolean =
        (0 until derived.size()).any { index ->
            val entry = derived.getAt(index)
            (0 until stored.size()).any { stored.getAt(it).id == entry.id && stored.getAt(it).key.equalsKey(entry.key) }
        }

    /** Every key ID in the keysets this app stores that open without a prompt. */
    internal fun knownKeyIds(): Set<KeyId> =
        listOf(KeysetName.RECORD, KeysetName.BACKUP, KeysetName.FILE_KEY, KeysetName.FILE_KEY_OLD)
            .mapNotNull { (vault.look(it) as? Stored.Open)?.keyset }
            .flatMap { KeysetCodec.keyIds(it) }
            .toSet()

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
     * The app must have its keys from this recovery key already
     * ([storeDerivedKeys]): it is the current recovery key of the stored
     * `record`. Otherwise this throws [IllegalArgumentException].
     *
     * A kept recovery key that is damaged is replaced: `finish()` copies
     * the damaged file to the set-aside folder first.
     *
     * Returns null if there is nothing to do: the phone has no screen
     * lock, so the key cannot be kept, or this app keeps it already. If
     * the user cancels the prompt, the key is not kept and everything else
     * still works.
     */
    fun beginKeepRecoveryKey(recoveryKey: RecoveryKey): PromptStep<Unit>? = vault.locked {
        if (!vault.hardware.hasScreenLock()) return@locked null
        val recovery = RecoveryKeyDeriver.recoveryKeyset(listOf(recoveryKey), recoveryKey)
        require(givesOwnRecord(judged(KeysetName.RECORD), recovery)) { "The app has no keys from this recovery key" }
        val stored = judged(KeysetName.RECOVERY)
        val replacing = stored is Stored.Damaged ||
            (stored is Stored.NeedsPrompt && vault.isDamagedBehindPrompt(KeysetName.RECOVERY))
        if (stored is Stored.NeedsPrompt && !replacing) return@locked null
        val judgedBlob = if (replacing) vault.storedBlob(KeysetName.RECOVERY) else null
        val oldGuard = (stored as? Stored.NeedsPrompt)?.key
        val guard = vault.newKey(HardwareKeyKind.RECOVERY_GUARD)
        val cipher = try {
            PromptCipher(vault.hardware.startCipher(guard, null), encrypts = true)
        } catch (failed: HardwareKeyFailure) {
            vault.deleteIfUnnamed(guard)
            throw failed
        }
        PromptStep(
            cryptoObject = cipher.cryptoObject,
            onFinish = {
                vault.locked {
                    if (replacing) {
                        check(vault.storedBlob(KeysetName.RECOVERY) contentEquals judgedBlob) {
                            "The recovery keyset was changed"
                        }
                        vault.setAside(KeysetName.RECOVERY)
                    }
                    vault.storeWithPrompt(KeysetName.RECOVERY, recovery, guard, cipher)
                    if (oldGuard != null) vault.deleteIfUnnamed(oldGuard)
                }
            },
            onCancel = { vault.locked { vault.deleteIfUnnamed(guard) } },
        )
    }

    /**
     * Starts showing the kept recovery key again: one prompt, one showing.
     * `finish()` returns the key. Drop it when the screen closes. Throws
     * [BlobException] if this app does not keep the key, or its Recovery
     * guard is gone because the screen lock was removed, or the kept key
     * is damaged. A damaged kept key is replaced by entering the words and
     * keeping them again.
     */
    fun beginShowRecoveryKey(): PromptStep<RecoveryKey> = vault.locked {
        val stored = when (val looked = judged(KeysetName.RECOVERY)) {
            is Stored.NeedsPrompt -> looked
            is Stored.Damaged -> throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            else -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
        }
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
     * Checks four of the recovery words before the app lock is turned on,
     * in an app that keeps the recovery key ("The app lock" in
     * crypto-design.md, rule 2). [kept] is the kept key, read with
     * [beginShowRecoveryKey]. [answers] maps four positions, 1 to 24, to
     * the words the user typed.
     *
     * Returns the proof that [AppLock.beginTurnOn] needs if [kept] is the
     * current recovery key of this app's `record` and every word matches.
     * Returns null if not. Nothing is stored, and no key leaves memory.
     * Throws [BlobException] if `record` cannot be judged now or is
     * damaged.
     */
    fun checkFourWords(kept: RecoveryKey, answers: Map<Int, String>): WordsProof? = vault.locked {
        require(answers.size == WORDS_TO_CHECK && answers.keys.all { it in 1..Bip39.WORD_COUNT }) {
            "Four words at positions 1 to 24 are checked"
        }
        if (isOwnRecoveryKey(kept) && kept.hasWordsAt(answers)) WordsProof() else null
    }

    /**
     * Checks all 24 recovery words before the app lock is turned on, in an
     * app that does not keep the recovery key ("The app lock" in
     * crypto-design.md, rule 2). Words that give this app's own `record`
     * key are the proof: [entered] must be the current recovery key of the
     * stored `record`.
     *
     * Returns the proof that [AppLock.beginTurnOn] needs, or null. Nothing
     * is stored: the key is not kept here. Keeping stays the user's own
     * choice. No key leaves memory. Throws [BlobException] if `record`
     * cannot be judged now or is damaged.
     */
    fun checkAllWords(entered: RecoveryKey): WordsProof? = vault.locked {
        if (isOwnRecoveryKey(entered)) WordsProof() else null
    }

    /** True if [key] is the current recovery key of this app's stored `record`. */
    private fun isOwnRecoveryKey(key: RecoveryKey): Boolean {
        val record = judged(KeysetName.RECORD)
        if (record is Stored.Damaged) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        return givesOwnRecord(record, RecoveryKeyDeriver.recoveryKeyset(listOf(key), key))
    }

    /** True if [record] opens and holds the `record` keyset that [recovery] derives, with the same primary. */
    private fun givesOwnRecord(record: Stored, recovery: KeysetHandle): Boolean =
        record is Stored.Open && KeysetCodec.holdsAll(record.keyset, RecoveryKeyDeriver.derive(recovery, vault.app).record)

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
     * be opened again. Only in an app that has its keys from a recovery
     * key; otherwise this throws [IllegalStateException]. A damaged old
     * keyset is copied to the set-aside folder first.
     */
    fun finishFileKeyMove() = vault.locked {
        check(vault.isStored(KeysetName.RECORD)) { "The app has no keys from a recovery key yet" }
        if (vault.look(KeysetName.FILE_KEY_OLD) is Stored.Damaged) vault.setAside(KeysetName.FILE_KEY_OLD)
        vault.remove(KeysetName.FILE_KEY_OLD)
        vault.forgetAll()
    }

    /**
     * Gives up the files whose keys no recovery words can bring back,
     * because the keyset that seals their keys is damaged ("A damaged
     * keyset file" in crypto-design.md). Two cases:
     *
     * - a damaged `file-key-old`;
     * - a damaged `file-key` while the app has no `record`: a random key
     *   of an app with no recovery key yet, or the key of an unfinished
     *   setup.
     *
     * Each such file is copied to the set-aside folder, never deleted, and
     * removed from the keyset folder. The files its keys sealed can then
     * never be opened, on any device. Backup, sync of file records and the
     * app lock work again. Throws [IllegalStateException] if neither case
     * holds: a keyset that still opens is never given up.
     */
    fun giveUpDamagedFileKeys() = vault.locked {
        val names = damagedFileKeysToGiveUp()
        check(names.isNotEmpty()) { "No damaged file keys to give up" }
        names.forEach { name ->
            vault.setAside(name)
            vault.remove(name)
        }
        vault.forgetAll()
    }

    /** The file-key keysets that [giveUpDamagedFileKeys] would give up now. */
    internal fun damagedFileKeysToGiveUp(): List<KeysetName> = buildList {
        if (vault.look(KeysetName.FILE_KEY_OLD) is Stored.Damaged) add(KeysetName.FILE_KEY_OLD)
        if (!vault.isStored(KeysetName.RECORD) && vault.look(KeysetName.FILE_KEY) is Stored.Damaged) {
            add(KeysetName.FILE_KEY)
        }
    }
}
