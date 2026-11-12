package app.shkriuss.core.crypto

/**
 * The keysets an app stores, each in its own file in `shk-keys/`
 * ("Keysets" in crypto-design.md). [text] is the name that is bound into
 * the stored blob and is also the file's name.
 */
internal enum class KeysetName(val text: String, val type: KeysetType) {
    RECORD("record", KeysetType.SEALING),
    BACKUP("backup", KeysetType.STREAMING),
    FILE_KEY("file-key", KeysetType.SEALING),
    FILE_KEY_OLD("file-key-old", KeysetType.SEALING),
    RECOVERY("recovery", KeysetType.RECOVERY),
}

/**
 * The four kinds of hardware key an app can have in the Android Keystore
 * ("Hardware keys" in crypto-design.md). They wrap keysets only.
 */
enum class HardwareKeyKind(
    /** The kind byte in a wrapped keyset. */
    internal val number: Int,
    /** The middle part of the key's alias. */
    internal val aliasPart: String,
    /** Whether every use of the key needs the system prompt. */
    internal val needsPrompt: Boolean,
) {
    /** Usable whenever the app runs. Wraps the `record` keyset. */
    BACKGROUND(1, "background", false),

    /** Usable while the phone is unlocked. Android 15 and later only. */
    UNLOCKED(2, "unlocked", false),

    /** Needs the system prompt. Exists while the app lock is on. */
    LOCK(3, "lock", true),

    /** Needs the system prompt. Wraps the kept recovery key. */
    RECOVERY_GUARD(4, "recovery", true),
    ;

    /**
     * Whether a key of this kind may wrap the keyset [name]. A reader
     * refuses every other pair.
     */
    internal fun mayWrap(name: KeysetName): Boolean = when (this) {
        BACKGROUND -> name != KeysetName.RECOVERY
        UNLOCKED -> name == KeysetName.BACKUP || name == KeysetName.FILE_KEY || name == KeysetName.FILE_KEY_OLD
        LOCK -> name == KeysetName.FILE_KEY
        RECOVERY_GUARD -> name == KeysetName.RECOVERY
    }

    internal companion object {
        /** The kind with this kind byte, or null. */
        fun ofNumber(number: Int): HardwareKeyKind? = entries.firstOrNull { it.number == number }
    }
}

/**
 * One hardware key: its kind and its number. The number starts at 1 and a
 * new key of a kind gets a number above every one in use.
 */
internal data class HardwareKeyRef(val kind: HardwareKeyKind, val number: Int) {
    init {
        require(number >= 1) { "A hardware key number starts at 1" }
    }

    /** The key's name in the Android Keystore, for example `shk.lock.3`. */
    val alias: String get() = "$ALIAS_PREFIX${kind.aliasPart}.$number"

    companion object {
        /** Every alias of this module starts with this. */
        const val ALIAS_PREFIX = "shk."

        private val ALIAS = Regex("""shk\.([a-z]+)\.([1-9][0-9]{0,9})""")

        /** The key an alias names, or null if the alias is not one of this module's. */
        fun ofAlias(alias: String): HardwareKeyRef? {
            val match = ALIAS.matchEntire(alias) ?: return null
            val kind = HardwareKeyKind.entries.firstOrNull { it.aliasPart == match.groupValues[1] } ?: return null
            val number = match.groupValues[2].toLongOrNull()?.takeIf { it <= Int.MAX_VALUE } ?: return null
            return HardwareKeyRef(kind, number.toInt())
        }
    }
}
