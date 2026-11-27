package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId

/**
 * Which of two versions of one record wins when their `updatedAt` is the
 * same (docs/architecture/sync-protocol.md, "Conflict rules", step 2).
 * The order belongs to version 1 of the plaintext: a change to it is a
 * format change. Every device follows it, so every device ends with the
 * same version whatever the order in which they came.
 */
internal object SyncOrder {
    /**
     * Returns a positive number when [came] wins, 0 when the two are the
     * same, and a negative number when [stored] wins. [syncKeyId] is the
     * key ID the app syncs with. [storedPlaintext] and [camePlaintext] are
     * the plaintexts of the two, as this app writes them in its own data
     * version.
     */
    fun tie(stored: SyncRecord, came: SyncRecord, syncKeyId: KeyId?, storedPlaintext: ByteArray, camePlaintext: ByteArray): Int {
        // 1. A record that is not deleted wins over a deleted one: nothing the user typed is lost.
        if (stored.isDeleted != came.isDeleted) return if (came.isDeleted) -1 else 1
        // 2. Of two deleted records, the wiped one wins.
        if (stored.isDeleted && stored.wiped != came.wiped) return if (came.wiped) 1 else -1
        // 3. Of two records with a wrapped file key, the one whose key names the key ID the app syncs with wins.
        if (stored.wrappedKeyId != null && came.wrappedKeyId != null) {
            val storedNamesIt = stored.wrappedKeyId == syncKeyId
            val cameNamesIt = came.wrappedKeyId == syncKeyId
            if (storedNamesIt != cameNamesIt) return if (cameNamesIt) 1 else -1
        }
        // 4. The one whose plaintext is larger wins. The same bytes are the same record.
        return compareUnsigned(camePlaintext, storedPlaintext).coerceIn(-1, 1)
    }
}
