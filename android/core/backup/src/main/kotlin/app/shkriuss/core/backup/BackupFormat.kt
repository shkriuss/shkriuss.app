package app.shkriuss.core.backup

/**
 * The numbers of the backup file format, version 1. Every value here is
 * part of the format (docs/architecture/backup-format.md): changing one is
 * a format change.
 */
internal object BackupFormat {
    /** The ASCII letters `SHKBAK`, the first bytes of every backup. */
    val MAGIC = byteArrayOf(0x53, 0x48, 0x4B, 0x42, 0x41, 0x4B)

    /** The format version this code writes, and the highest it reads. */
    const val VERSION = 1

    /** The key ID in the backup header. */
    const val KEY_ID_BYTES = 4

    const val LONGEST_APP_NAME = 32
    const val LONGEST_TYPE_NAME = 64

    /** The longest content of one record: 16 MiB. */
    const val LARGEST_CONTENT = 16 * 1024 * 1024

    const val TAG_MANIFEST = 1
    const val TAG_RECORD = 2
    const val TAG_FILE = 3
    const val TAG_END = 4

    const val NOT_DELETED = 0
    const val DELETED = 1

    /** How many bytes are copied at a time. Not part of the format. */
    const val COPY_BUFFER = 64 * 1024

    /** True for a name an app may give a kind of record. */
    fun isTypeName(name: String): Boolean =
        name.length in 1..LONGEST_TYPE_NAME && name.all { it in 'a'..'z' || it in '0'..'9' || it == '_' }

    /** True for an app name that fits into a backup header. */
    fun isAppName(name: String): Boolean = name.length in 1..LONGEST_APP_NAME && name.all { it in 'a'..'z' }
}
