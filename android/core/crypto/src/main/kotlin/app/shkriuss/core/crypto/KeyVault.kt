package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What is stored for one keyset, and whether it can be opened now. */
internal sealed class Stored {
    /** No file. */
    object Missing : Stored()

    /** Opened with a hardware key that needs no prompt. */
    class Open(val keyset: KeysetHandle, val key: HardwareKeyRef) : Stored()

    /** Wrapped by a key that needs the system prompt, and that key exists. */
    class NeedsPrompt(val key: HardwareKeyRef, val blob: ByteArray) : Stored()

    /** Its hardware key is gone. Only then may the file be written over. */
    class KeyGone(val key: HardwareKeyRef) : Stored()

    /** Its hardware key cannot be used or asked about now. Nothing is lost. */
    object NotUsableNow : Stored()

    /** The file is damaged or changed, or holds what may not be there. */
    object Damaged : Stored()
}

/** The keysets that open wrapped file keys: `file-key`, and `file-key-old` while a move is not finished. */
internal class FileKeysets(val current: KeysetHandle, val old: KeysetHandle?)

/**
 * The keysets of one app and the hardware keys that wrap them. It keeps
 * the rules for making, replacing and losing a hardware key
 * (crypto-design.md), so that a mistake or a stop in the middle never
 * destroys a keyset that could be the only way to a user's files:
 *
 * 1. A hardware key is gone only if its exact alias is "not found", or
 *    Android says it is permanently invalidated. Every other failure is
 *    "not usable now": nothing is deleted and nothing is made again.
 * 2. A keyset file that cannot be opened is never written over, unless
 *    its hardware key is gone.
 * 3. A new hardware key gets a number above every number in use, and is
 *    never made under an alias that exists.
 * 4. Everything here runs one step at a time under one lock. A prompt
 *    that waits for the user does not hold it.
 *
 * An app builds one vault. The functions without "locked" in their
 * comment must be called inside [locked].
 */
internal class KeyVault(val app: AppName, private val store: KeysetStore, val hardware: HardwareKeys) {
    private val lock = ReentrantLock()
    private var record: KeysetHandle? = null
    private var fileKey: KeysetHandle? = null
    private var fileKeyOld: KeysetHandle? = null

    /**
     * Runs [action] alone, after the provider check. A hardware key that
     * is gone or not usable now becomes the answer "needs keys this app
     * does not have now", a refused blob "damaged or changed".
     */
    fun <T> locked(action: () -> T): T {
        TinkSetup.ready()
        return lock.withLock {
            try {
                action()
            } catch (_: HardwareBlobRefused) {
                throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            } catch (_: HardwareKeyFailure) {
                throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
            }
        }
    }

    /** The kind of hardware key that wraps `backup`, and `file-key` while the app lock is off. */
    val fileKeyHome: HardwareKeyKind
        get() = if (hardware.unlockedKeyAllowed) HardwareKeyKind.UNLOCKED else HardwareKeyKind.BACKGROUND

    /** Whether a file is stored for [name]. */
    fun isStored(name: KeysetName): Boolean = store.read(name) != null

    /** The hardware key the stored file of [name] names, or null if there is no file. Throws [BlobException]. */
    fun namedKey(name: KeysetName): HardwareKeyRef? = store.read(name)?.let { WrappedKeyset.keyOf(it, name) }

    /** As [namedKey], but null also for a file whose first bytes cannot be read. */
    fun namedKeyOrNull(name: KeysetName): HardwareKeyRef? = try {
        namedKey(name)
    } catch (_: BlobException) {
        null
    }

    /** Reads the stored keyset [name] as far as that is possible without a prompt. */
    fun look(name: KeysetName): Stored {
        val blob = store.read(name) ?: return Stored.Missing
        val key = try {
            WrappedKeyset.keyOf(blob, name)
        } catch (_: BlobException) {
            return Stored.Damaged
        }
        try {
            if (!hardware.exists(key)) return Stored.KeyGone(key)
            if (key.kind.needsPrompt) return Stored.NeedsPrompt(key, blob)
            val plain = hardware.decrypt(key, WrappedKeyset.afterPrefix(blob), AssociatedData.forKeyset(key, name))
            try {
                return Stored.Open(KeysetCodec.parse(plain, name.type), key)
            } finally {
                plain.fill(0)
            }
        } catch (_: HardwareKeyGone) {
            return Stored.KeyGone(key)
        } catch (_: HardwareKeyNotUsable) {
            return Stored.NotUsableNow
        } catch (_: HardwareBlobRefused) {
            return Stored.Damaged
        } catch (_: BlobException) {
            return Stored.Damaged
        }
    }

    /**
     * Wraps [keyset] with the hardware key [key], which needs no prompt,
     * opens the new blob again to check it, and only then replaces the
     * file of [name].
     */
    fun wrapAndStore(name: KeysetName, keyset: KeysetHandle, key: HardwareKeyRef) {
        check(!key.kind.needsPrompt && key.kind.mayWrap(name))
        val plain = KeysetCodec.serialize(keyset)
        try {
            val associatedData = AssociatedData.forKeyset(key, name)
            val wrapped = hardware.encrypt(key, plain, associatedData)
            val again = hardware.decrypt(key, wrapped, associatedData)
            val same = again.contentEquals(plain)
            again.fill(0)
            if (!same) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
            store.replace(name, WrappedKeyset.prefix(key) + wrapped)
        } finally {
            plain.fill(0)
        }
    }

    /**
     * Wraps [keyset] with the started [cipher] of [key], a key that needs
     * the prompt, and replaces the file of [name]. Call it only after the
     * prompt succeeded. The new blob cannot be opened again to check it:
     * that would need a second prompt.
     */
    fun storeWithPrompt(name: KeysetName, keyset: KeysetHandle, key: HardwareKeyRef, cipher: PromptCipher) {
        check(key.kind.needsPrompt && key.kind.mayWrap(name))
        val plain = KeysetCodec.serialize(keyset)
        try {
            val wrapped = cipher.finish(plain, AssociatedData.forKeyset(key, name))
            store.replace(name, WrappedKeyset.prefix(key) + wrapped)
        } finally {
            plain.fill(0)
        }
    }

    /** Opens what [stored] holds with the started [cipher], after the prompt succeeded. */
    fun openWithPrompt(name: KeysetName, stored: Stored.NeedsPrompt, cipher: PromptCipher): KeysetHandle {
        val plain = cipher.finish(WrappedKeyset.afterIv(stored.blob), AssociatedData.forKeyset(stored.key, name))
        try {
            return KeysetCodec.parse(plain, name.type)
        } finally {
            plain.fill(0)
        }
    }

    /** Removes the file of [name]. */
    fun remove(name: KeysetName) = store.delete(name)

    /**
     * Makes a new hardware key of [kind]. Its number is one above the
     * highest of that kind, counted over the aliases the Keystore lists
     * and the numbers the keyset files name. The list can be short when
     * the Keystore fails, so the exact alias is asked for before the key
     * is made: if a key is there, the next number is taken, and if the
     * Keystore cannot say, this stops and makes nothing.
     */
    fun newKey(kind: HardwareKeyKind): HardwareKeyRef {
        val listed = hardware.aliases().mapNotNull { HardwareKeyRef.ofAlias(it) }
        val named = KeysetName.entries.mapNotNull { namedKeyOrNull(it) }
        var number = (listed + named).filter { it.kind == kind }.maxOfOrNull { it.number }?.plus(1) ?: 1
        while (hardware.exists(HardwareKeyRef(kind, number))) number++
        val key = HardwareKeyRef(kind, number)
        hardware.make(key)
        return key
    }

    /**
     * The key of [kind] that a keyset is wrapped with now: the one the
     * files name, with the highest number, if it still exists. Else a new
     * one.
     */
    fun keyFor(kind: HardwareKeyKind): HardwareKeyRef {
        val named = KeysetName.entries.mapNotNull { namedKeyOrNull(it) }.filter { it.kind == kind }
        val newest = named.maxByOrNull { it.number }
        return if (newest != null && hardware.exists(newest)) newest else newKey(kind)
    }

    /** Deletes [key] if no keyset file names it. A failure is left for the next start. */
    fun deleteIfUnnamed(key: HardwareKeyRef) {
        if (KeysetName.entries.any { namedKeyOrNull(it) == key }) return
        try {
            hardware.delete(key)
        } catch (_: HardwareKeyFailure) {
            // Rule 8 deletes it at a later start.
        }
    }

    /** True if [key] is gone for certain. False also when the Keystore cannot say. */
    fun isGone(key: HardwareKeyRef): Boolean = try {
        !hardware.exists(key)
    } catch (_: HardwareKeyFailure) {
        false
    }

    /**
     * What an app does at start, locked:
     *
     * 1. Removes what a stopped file replacement left behind.
     * 2. Deletes hardware keys of its own that no keyset file names, but
     *    only if it could read the first bytes of every keyset file. It
     *    deletes only keys the Keystore's list shows, so a list that
     *    failed deletes nothing.
     * 3. On Android 15 and later, moves `backup`, `file-key` and
     *    `file-key-old` from the Background key to an Unlocked key. If the
     *    phone is locked now, that waits for a later start.
     */
    fun start() = locked {
        var everyFileRead = store.tidy()
        val named = mutableSetOf<HardwareKeyRef>()
        KeysetName.entries.forEach { name ->
            try {
                namedKey(name)?.let { named += it }
            } catch (_: BlobException) {
                everyFileRead = false
            }
        }
        if (everyFileRead) deleteKeysNotIn(named)
        moveToUnlockedKey()
    }

    private fun deleteKeysNotIn(named: Set<HardwareKeyRef>) {
        hardware.aliases().mapNotNull { HardwareKeyRef.ofAlias(it) }.filter { it !in named }.forEach { key ->
            try {
                hardware.delete(key)
            } catch (_: HardwareKeyFailure) {
                // Tried again at the next start.
            }
        }
    }

    private fun moveToUnlockedKey() {
        if (!hardware.unlockedKeyAllowed) return
        val names = listOf(KeysetName.BACKUP, KeysetName.FILE_KEY, KeysetName.FILE_KEY_OLD)
            .filter { namedKeyOrNull(it)?.kind == HardwareKeyKind.BACKGROUND }
        if (names.isEmpty()) return
        try {
            val opened = names.map { name -> name to (look(name) as? Stored.Open ?: return) }
            val unlockedKey = keyFor(HardwareKeyKind.UNLOCKED)
            opened.forEach { (name, stored) -> wrapAndStore(name, stored.keyset, unlockedKey) }
        } catch (_: HardwareKeyFailure) {
            // The phone is locked or the Keystore is busy. A file is replaced
            // only after its new blob was checked, so nothing is lost. A
            // later start moves what is left.
        } catch (_: CannotMakeHardwareKeyException) {
            // No Unlocked key could be made. The Background key keeps the keysets.
        }
    }

    /** The `record` keyset, locked. It may stay in memory for the life of the process. */
    fun recordKeyset(): KeysetHandle = locked { record ?: open(KeysetName.RECORD).also { record = it } }

    /** The `backup` keyset, locked. It is loaded for one backup or restore and never kept. */
    fun backupKeyset(): KeysetHandle = locked { open(KeysetName.BACKUP) }

    private fun open(name: KeysetName): KeysetHandle = when (val stored = look(name)) {
        is Stored.Open -> stored.keyset
        is Stored.Damaged -> throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        else -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
    }

    /**
     * The keysets that seal and open file keys, locked. With the app lock
     * on they are there only between unlock and lock.
     *
     * With [create], an app that has no `file-key` yet and no recovery key
     * gets one random key, which exists only on this phone: adding files
     * needs no recovery key.
     */
    fun fileKeysets(create: Boolean): FileKeysets = locked {
        keepFilesIfLockKeyIsGone()
        val current = fileKey ?: loadFileKey(create).also { fileKey = it }
        val old = fileKeyOld ?: loadFileKeyOld().also { fileKeyOld = it }
        FileKeysets(current, old)
    }

    private fun loadFileKey(create: Boolean): KeysetHandle = when (val stored = look(KeysetName.FILE_KEY)) {
        is Stored.Open -> stored.keyset
        is Stored.Damaged -> throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        is Stored.Missing -> {
            if (!create || isStored(KeysetName.RECORD)) throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
            KeysetCodec.newRandom(KeysetType.SEALING).also { wrapAndStore(KeysetName.FILE_KEY, it, keyFor(fileKeyHome)) }
        }
        else -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
    }

    private fun loadFileKeyOld(): KeysetHandle? = when (val stored = look(KeysetName.FILE_KEY_OLD)) {
        is Stored.Missing -> null
        is Stored.Open -> stored.keyset
        is Stored.Damaged -> throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        else -> throw BlobException(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW)
    }

    /** The `file-key` keyset if it is in memory. */
    fun fileKeyInMemory(): KeysetHandle? = fileKey

    /** Keeps the `file-key` keyset that a prompt just opened or wrapped. */
    fun rememberFileKey(keyset: KeysetHandle) {
        fileKey = keyset
    }

    /** Drops the file-key keysets from memory, locked: when the app locks, and when the screen turns off. */
    fun forgetFileKeys() = locked {
        fileKey = null
        fileKeyOld = null
    }

    /** Drops every keyset from memory, so that the next use reads the files again. */
    fun forgetAll() {
        record = null
        fileKey = null
        fileKeyOld = null
    }

    /**
     * If the Lock key is gone while the `file-key` keyset is still in
     * memory, the keyset is stored under a key that needs no prompt at
     * once. Then the files stay open and no recovery words are needed.
     */
    fun keepFilesIfLockKeyIsGone() {
        val keyset = fileKey ?: return
        val key = namedKeyOrNull(KeysetName.FILE_KEY) ?: return
        if (key.kind != HardwareKeyKind.LOCK || !isGone(key)) return
        try {
            wrapAndStore(KeysetName.FILE_KEY, keyset, keyFor(fileKeyHome))
        } catch (_: HardwareKeyFailure) {
            // The keyset stays in memory. The next use tries again.
        } catch (_: CannotMakeHardwareKeyException) {
            // The same.
        }
    }

    /**
     * True if file keys may leave the phone: the app has its
     * recovery-key-derived keys, and no file key is still sealed by a key
     * that exists only on this phone.
     */
    fun mayShareFileKeys(): Boolean = isStored(KeysetName.RECORD) && !isStored(KeysetName.FILE_KEY_OLD)
}
