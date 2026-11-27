package app.shkriuss.core.sync

import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.PrimaryKey

/*
 * The tables of sync in a data app's database
 * (docs/architecture/sync-protocol.md, "What a data app keeps for sync").
 * They are not records: never backed up, never synced, and written only by
 * SyncStore, with the SQL of SyncSql, in the same transactions as the
 * records (docs/architecture/data.md, "Rules for DAOs", point 5). Every
 * data app that syncs lists all seven among the entities of its database,
 * as it lists ChangeCounter. No DAO reads or writes them.
 */

/** The state of sync of the app on this phone. One row, with [id] 1. */
@Entity(tableName = SyncSql.STATE)
class SyncStateRow(
    /** Always 1. */
    @PrimaryKey val id: Int,
    /** Whether sync is on in this app on this phone. */
    val isOn: Boolean,
    /** The server ID that the rest belongs to, 32 hex digits, or null before the first call. */
    val serverId: String?,
    /** The epoch that the cursor belongs to. */
    val epoch: String?,
    /** The device ID of the Sync app on this phone. */
    val deviceId: String?,
    /** The number up to which the app has taken in what the server holds. */
    val cursor: Long,
    /** The highest number the server ever told the app. Never below [cursor]. */
    val known: Long,
    /** S: the key ID the app syncs with, or null before it first synced. */
    val syncKeyId: Int?,
    /** The change number up to which every local change was looked at. */
    val sendMark: Long,
    /** The comparison of everything: 0 none, 1 fetching, 2 sending. */
    val comparison: Int,
    /** Why the app sends nothing, as it learned it: 0 it sends, 1 a newer record came, 2 the server refused its key. */
    val stopped: Int,
    /** After the server refused the app's key: C, the server's key ID that the Sync app named then. */
    val stoppedKeyId: Int?,
    /** The app's data version when sync last looked. A higher one means the app was updated. */
    val dataVersion: Int,
    /** The version of the plaintext this code reads, when sync last looked. A higher one also means an update. */
    val plaintextVersion: Int,
    /** The lowest number of a record skipped as "another recovery key" or "newer", or null. */
    val skippedFrom: Long?,
    /** Records skipped as "another recovery key". */
    val skippedAnotherKey: Long,
    /** Records skipped as "damaged". */
    val skippedDamaged: Long,
    /** Records skipped as "newer". */
    val skippedNewer: Long,
    /** Records skipped as "not valid". */
    val skippedNotValid: Long,
    /** Records not sent because they would be over the largest sealed record. */
    val tooLarge: Long,
    /** Records the server refused as not a sealed record. */
    val refused: Long,
    /** Fetched streams that did not fit their length or hash. */
    val wrongStreams: Long,
    /** The token of the last batch given out. */
    val lastToken: Long,
    /** Whether the app still has to seal its file keys again under the key it syncs with. */
    val sealFileKeys: Boolean,
    /** Whether the app still has to set its alarms again after the last page of a fetch. */
    val afterImportDue: Boolean,
    /** The cursor before an update moved it back: a record at or below it was counted when it was skipped first. */
    val countedThrough: Long,
)

/** **To send**: the records that must go to the server, "ordinary" (1) or "comparison" (2). */
@Entity(tableName = SyncSql.SEND, indices = [Index("kind", "position", "recordId")])
class SyncSendRow(
    @PrimaryKey val recordId: String,
    val kind: Int,
    /** The order within a kind: the change number when the record was put here. */
    val position: Long,
)

/** **Just taken**: each record that sync wrote, with the change number it got, until the send mark passes it. */
@Entity(tableName = SyncSql.TAKEN, indices = [Index("changeNumber")])
class SyncTakenRow(
    @PrimaryKey val recordId: String,
    val changeNumber: Long,
)

/** The IDs a comparison of everything saw on the server while it fetches. */
@Entity(tableName = SyncSql.SEEN)
class SyncSeenRow(
    @PrimaryKey val recordId: String,
)

/** The IDs of records whose damaged version the app answered once, until a version of them opens. */
@Entity(tableName = SyncSql.DAMAGED)
class SyncDamagedRow(
    @PrimaryKey val recordId: String,
)

/** The records of the batch given out last, in its order, so that `exported` can read the server's answer. */
@Entity(tableName = SyncSql.BATCH)
class SyncBatchRow(
    @PrimaryKey val position: Int,
    val recordId: String,
    /** True for a file's record that was deleted when it went into the batch. */
    val deletedFile: Boolean,
)

/** What sync knows of the stream of one file. */
@Entity(tableName = SyncSql.STREAM)
class SyncStreamRow(
    @PrimaryKey val fileId: String,
    /** The stream's length. */
    val length: Long,
    /** Its SHA-256, 64 hex digits, or null while not computed. */
    val hash: String?,
    /** Whether the server is known to have every chunk of it. */
    val onServer: Boolean,
    /** Whether the stored stream was on this phone, whole, when sync last looked. */
    val here: Boolean,
    /** Whether the file's record was deleted when sync last looked, with nothing left to do for it. */
    val recordDeleted: Boolean,
    /** Whether the stored stream on this phone was found not to fit its hash. It is then fetched. */
    val doesNotFit: Boolean,
    /** Whether the server is to delete its chunks. */
    val toDelete: Boolean,
    /** The number under which this phone's batch stored the file's deleted record. */
    val deletedNumber: Long?,
    /** When a fetched stream last did not fit, or null. It is fetched again at most once a day. */
    val wrongAt: Long?,
    /** Whether this phone's copy of the stream is to be removed: sync took the deletion of its record. */
    val toRemove: Boolean,
)
