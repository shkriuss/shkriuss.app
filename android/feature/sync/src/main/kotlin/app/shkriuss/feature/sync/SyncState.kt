package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.DeviceNames
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.SyncAddress
import app.shkriuss.core.sync.SyncId

/** Where this phone stands with its server: `stage` of docs/apps/sync/spec.md, "Data". */
enum class Stage(internal val code: Int) {
    NOT_JOINED(0),
    JOINING(1),

    /** `enrol` was sent, and its answer not yet seen. */
    ENROL_SENT(2),
    JOINED(3),

    /** Joined once, and stopped: [SyncState.stop] says why. */
    STOPPED(4),
}

/** Why sync stopped: `stop` of docs/apps/sync/spec.md, "Data". */
enum class Stop(internal val code: Int) {
    /** The server answered `02`: it does not know this phone. */
    NOT_A_DEVICE(1),

    /** The server answered `03`: this phone was removed. */
    REMOVED(2),

    /** The server answered `06`: it was closed. */
    CLOSED(3),

    /** The server's lowest version is above 1. */
    UPDATE_SYNC(4),

    /** The device key or the name key is gone, or the state cannot be read. */
    KEYS_GONE(5),

    /** The server's highest version is below 1. */
    UPDATE_SERVER(6),
}

/** Which code a join uses: `codeKind`. */
enum class CodeKind(internal val code: Int) {
    DEVICE_CODE(1),
    SETUP_CODE(2),
}

/** What waits until 00:00 UTC after the day's limit: `dayWait`. */
enum class DayWait(internal val code: Int) {
    /** `07 01`: only the batches of a comparison of everything wait. */
    COMPARISONS(1),

    /** `07 02`, or Cloudflare's limit of requests: every request waits. */
    EVERYTHING(2),
}

/**
 * The three limits of the last `info`: the most records and bytes of blobs
 * in one batch or page, and the most items of one file request. Each is
 * kept inside its bounds (docs/architecture/sync-protocol.md, `info`).
 */
data class Limits(val records: Int, val bytes: Int, val fileItems: Int) {
    init {
        require(records in RECORDS && bytes in BYTES && fileItems in FILE_ITEMS) { "Limits are kept inside their bounds" }
    }

    companion object {
        val RECORDS: IntRange = 1..100
        val BYTES: IntRange = 65_536..524_288
        val FILE_ITEMS: IntRange = 1..256

        /** The limits `info` named, each outside its bounds taken as the nearest bound. */
        fun nearest(records: Long, bytes: Long, fileItems: Long): Limits = Limits(
            records.coerceIn(RECORDS.first.toLong(), RECORDS.last.toLong()).toInt(),
            bytes.coerceIn(BYTES.first.toLong(), BYTES.last.toLong()).toInt(),
            fileItems.coerceIn(FILE_ITEMS.first.toLong(), FILE_ITEMS.last.toLong()).toInt(),
        )
    }
}

/**
 * What Sync last learned of one data app: `head.<app>`, `good.<app>`,
 * `on.<app>`, `work.<app>` and `poked.<app>`.
 */
data class AppSync(
    /** The head that `heads` last named for the app. */
    val head: Long = 0,
    /** When a run last ended well for the app, or null for never. */
    val goodAt: Long? = null,
    /** Its last `status` said that sync is on in it. */
    val on: Boolean = false,
    /**
     * Its last `status` said that it has something to send, to fetch or to
     * compare. Also set for every app when the epoch moves, until a
     * `status` with the new epoch.
     */
    val work: Boolean = false,
    /** It poked, and no run has started on it since. */
    val poked: Boolean = false,
) {
    init {
        require(head >= 0) { "A head is not below 0" }
        require(goodAt == null || isTime(goodAt)) { "Not a time" }
    }
}

/**
 * The state of this phone, as Sync keeps it in its one preferences file
 * (docs/apps/sync/spec.md, "Data"). Every value is inside its limits:
 * [SyncStateStore] drops a stored value that is not, and the constructor
 * refuses one. Nothing here is a key that opens data, a record ID or any
 * content of a data app.
 */
data class SyncState(
    val stage: Stage = Stage.NOT_JOINED,
    /** Set exactly when [stage] is [Stage.STOPPED]. */
    val stop: Stop? = null,
    /** **Close the server** was sent, and the dialog of a close was not yet read. */
    val closing: Boolean = false,
    /** When the join began, from [Stage.JOINING] until the join ends. */
    val joinedAt: Long? = null,
    /** The server's address, in the form of [SyncAddress]. */
    val address: String? = null,
    val serverId: SyncId? = null,
    val epoch: SyncId? = null,
    /** The server's current key ID. */
    val keyId: KeyId? = null,
    /** The account revision last seen. */
    val revision: Long = 0,
    val limits: Limits? = null,
    /** How often requests were halved for CPU time, 0 to 7, and when it was last changed. */
    val halved: Int = 0,
    val halvedAt: Long? = null,
    /** The number of the device key's alias, `shk.device.<number>`. */
    val deviceAlias: Int? = null,
    /** The device ID: always the one of the public key under [deviceAlias]. */
    val deviceId: SyncId? = null,
    /** This phone's name, as last sealed. */
    val name: String? = null,
    val codeKind: CodeKind? = null,
    /** The setup code of this join, until the join ends or is cancelled. */
    val setupCode: String? = null,
    /** The addresses whose Workers hold a setup code this phone showed, in the order they were added. */
    val deleteSetupCode: List<String> = emptyList(),
    /** The device IDs seen as removed, as 32 hex digits. */
    val removed: Set<String> = emptySet(),
    val filesOnMobile: Boolean = false,
    /** What Sync last learned of each data app, by app name. */
    val apps: Map<String, AppSync> = emptyMap(),
    val infoAt: Long? = null,
    val statusAt: Long? = null,
    val devicesAt: Long? = null,
    /** Failed runs in a row, 0 to 3, and the end of the 4-hour wait after the third. */
    val failedRuns: Int = 0,
    val retryAt: Long? = null,
    val dayWait: DayWait? = null,
    /** 00:00 UTC after the day's limit. Set exactly when [dayWait] is. */
    val dayWaitUntil: Long? = null,
    val full: Boolean = false,
    /** When sending was last tried while the server was full. */
    val fullAt: Long? = null,
    /** The server's clock minus the phone's, from the last `05`, while it holds. */
    val clockOff: Long? = null,
    /** The line that says the server was put back waits. */
    val putBack: Boolean = false,
    /** The fault problem holds. */
    val fault: Boolean = false,
    /** When a run last ended well, for the device line. */
    val syncedAt: Long? = null,
) {
    init {
        require((stop != null) == (stage == Stage.STOPPED)) { "A stop is set exactly when sync stopped" }
        require(address == null || SyncAddress.isValid(address)) { "Not a server address" }
        require(revision >= 0) { "A revision is not below 0" }
        require(halved in 0..MOST_HALVINGS) { "Requests are halved at most 7 times" }
        require(deviceAlias == null || deviceAlias >= 1) { "An alias number starts at 1" }
        require(name == null || DeviceNames.isValid(name)) { "Not a name a device can have" }
        require(setupCode == null || isSetupCode(setupCode)) { "Not a setup code" }
        require(deleteSetupCode.size <= MOST_SETUP_CODES && deleteSetupCode.distinct() == deleteSetupCode) { "At most 8 addresses, each once" }
        require(deleteSetupCode.all(SyncAddress::isValid)) { "Not a server address" }
        require(removed.size <= MOST_REMOVED && removed.all { HEX_ID.matches(it) } && deviceId?.hex !in removed) { "Not removed device IDs" }
        require(apps.keys.all { APP_NAME.matches(it) }) { "Not an app name" }
        require(failedRuns in 0..MOST_FAILED_RUNS) { "At most three failed runs are counted" }
        require((dayWait != null) == (dayWaitUntil != null)) { "A day wait has its end" }
        listOf(joinedAt, halvedAt, infoAt, statusAt, devicesAt, retryAt, dayWaitUntil, fullAt, syncedAt).forEach {
            require(it == null || isTime(it)) { "Not a time" }
        }
    }

    /** What Sync last learned of the app [name]. */
    fun app(name: String): AppSync = apps[name] ?: AppSync()

    /** This state with [change] made to what it knows of the app [name]. */
    fun withApp(name: String, change: (AppSync) -> AppSync): SyncState = copy(apps = apps + (name to change(app(name))))

    /** Says only where the phone stands: the state names a server and devices. */
    override fun toString(): String = "SyncState($stage, $stop)"

    companion object {
        const val MOST_HALVINGS: Int = 7
        const val MOST_SETUP_CODES: Int = 8
        const val MOST_REMOVED: Int = 10_000
        const val MOST_FAILED_RUNS: Int = 3

        /** The latest time a stored time may hold: 9999-12-31T23:59:59.999Z, as the record times. */
        const val LATEST_TIME: Long = 253_402_300_799_999L

        /** The letters and digits of a setup code and a device code. */
        const val CODE_ALPHABET: String = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        /** The length of a setup code. */
        const val SETUP_CODE_LENGTH: Int = 26

        internal val HEX_ID = Regex("[0-9a-f]{32}")
        internal val APP_NAME = Regex("[a-z]{1,32}")

        /** True for a time a stored value may hold. */
        fun isTime(value: Long): Boolean = value in 0..LATEST_TIME

        /** True for 26 characters of the code alphabet. */
        fun isSetupCode(value: String): Boolean = value.length == SETUP_CODE_LENGTH && value.all { it in CODE_ALPHABET }
    }
}

/** True for a time a stored value may hold. */
internal fun isTime(value: Long): Boolean = SyncState.isTime(value)
