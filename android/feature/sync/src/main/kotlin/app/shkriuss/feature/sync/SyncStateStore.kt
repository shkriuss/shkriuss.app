package app.shkriuss.feature.sync

import android.content.Context
import android.content.SharedPreferences
import app.shkriuss.core.crypto.DeviceNames
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.SyncAddress
import app.shkriuss.core.sync.SyncId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Thrown when the preferences file did not take a write. Nothing of that step was stored. */
class CouldNotSaveException : Exception("Sync could not save its state")

/**
 * Sync's one preferences file, `app.shkriuss.sync`, in its private storage
 * (docs/apps/sync/spec.md, "Data"). One step of Sync is one write of the
 * file: [update] writes every value that the step changes in one commit,
 * or none.
 *
 * A value that cannot be read, or is outside its limits, counts as
 * missing. Only this class reads and writes the file, so the state it
 * holds in memory is the file's.
 */
class SyncStateStore(private val preferences: SharedPreferences) {
    private val lock = Any()
    private val current = MutableStateFlow(read(preferences.all))

    /** The state now, for the screens. */
    val state: StateFlow<SyncState> = current.asStateFlow()

    /** The state now. */
    fun now(): SyncState = current.value

    /**
     * One step: the state [change] makes of the state now, written in one
     * commit. Throws [CouldNotSaveException] if the file did not take it;
     * then nothing changed.
     */
    fun update(change: (SyncState) -> SyncState): SyncState = synchronized(lock) {
        val before = current.value
        val after = change(before)
        if (after == before) return after
        val editor = preferences.edit()
        write(before, after, editor)
        if (!editor.commit()) throw CouldNotSaveException()
        current.value = after
        after
    }

    companion object {
        /** The name of the preferences file. */
        const val FILE: String = "app.shkriuss.sync"

        /** The store of Sync's own preferences file. */
        fun open(context: Context): SyncStateStore = SyncStateStore(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))

        private const val STAGE = "stage"
        private const val STOP = "stop"
        private const val CLOSING = "closing"
        private const val JOINED_AT = "joinedAt"
        private const val ADDRESS = "address"
        private const val SERVER_ID = "serverId"
        private const val EPOCH = "epoch"
        private const val KEY_ID = "keyId"
        private const val REVISION = "revision"
        private const val LIMITS = "limits"
        private const val HALVED = "halved"
        private const val HALVED_AT = "halvedAt"
        private const val DEVICE_ALIAS = "deviceAlias"
        private const val DEVICE_ID = "deviceId"
        private const val NAME = "name"
        private const val CODE_KIND = "codeKind"
        private const val SETUP_CODE = "setupCode"
        private const val DELETE_SETUP_CODE = "deleteSetupCode"
        private const val REMOVED = "removed"
        private const val FILES_ON_MOBILE = "filesOnMobile"
        private const val INFO_AT = "infoAt"
        private const val STATUS_AT = "statusAt"
        private const val DEVICES_AT = "devicesAt"
        private const val FAILED_RUNS = "failedRuns"
        private const val RETRY_AT = "retryAt"
        private const val DAY_WAIT = "dayWait"
        private const val DAY_WAIT_UNTIL = "dayWaitUntil"
        private const val FULL = "full"
        private const val FULL_AT = "fullAt"
        private const val CLOCK_OFF = "clockOff"
        private const val PUT_BACK = "putBack"
        private const val FAULT = "fault"
        private const val SYNCED_AT = "syncedAt"

        private const val HEAD = "head."
        private const val GOOD = "good."
        private const val ON = "on."
        private const val WORK = "work."
        private const val POKED = "poked."

        /** Between the entries of a list in one string: no address and no ID holds it. */
        private const val SEPARATOR = ' '

        private val HEX_KEY_ID = Regex("[0-9a-f]{8}")
        private val LIMITS_TEXT = Regex("([0-9]{1,9}),([0-9]{1,9}),([0-9]{1,9})")
        private val APP_KEY = Regex("(head|good|on|work|poked)\\.([a-z]{1,32})")

        /**
         * The state that the values [stored] give. Each value is taken only
         * if it has its type and is inside its limits, also the rules that
         * join two values; anything else counts as missing.
         */
        internal fun read(stored: Map<String, *>): SyncState {
            val values = Values(stored)
            val stage = values.int(STAGE)?.let { code -> Stage.entries.firstOrNull { it.code == code } } ?: Stage.NOT_JOINED
            var stop = values.int(STOP)?.let { code -> Stop.entries.firstOrNull { it.code == code } }
            when {
                // A stop that cannot be read: the phone joins again.
                stage == Stage.STOPPED && stop == null -> stop = Stop.KEYS_GONE
                stage != Stage.STOPPED -> stop = null
            }
            val deviceId = values.text(DEVICE_ID)?.let(SyncId::ofHex)
            val dayWait = values.int(DAY_WAIT)?.let { code -> DayWait.entries.firstOrNull { it.code == code } }
            val dayWaitUntil = values.time(DAY_WAIT_UNTIL)
            val apps = mutableMapOf<String, AppSync>()
            stored.keys.mapNotNull { APP_KEY.matchEntire(it)?.groupValues?.get(2) }.distinct().forEach { app ->
                apps[app] = AppSync(
                    head = values.long(HEAD + app)?.takeIf { it >= 0 } ?: 0,
                    goodAt = values.time(GOOD + app),
                    on = values.boolean(ON + app),
                    work = values.boolean(WORK + app),
                    poked = values.boolean(POKED + app),
                )
            }
            return SyncState(
                stage = stage,
                stop = stop,
                closing = values.boolean(CLOSING),
                joinedAt = values.time(JOINED_AT),
                address = values.text(ADDRESS)?.takeIf(SyncAddress::isValid),
                serverId = values.text(SERVER_ID)?.let(SyncId::ofHex),
                epoch = values.text(EPOCH)?.let(SyncId::ofHex),
                keyId = values.text(KEY_ID)?.takeIf { HEX_KEY_ID.matches(it) }?.let { KeyId(it.toLong(16).toInt()) },
                revision = values.long(REVISION)?.takeIf { it >= 0 } ?: 0,
                limits = values.text(LIMITS)?.let(::limitsOf),
                halved = values.int(HALVED)?.takeIf { it in 0..SyncState.MOST_HALVINGS } ?: 0,
                halvedAt = values.time(HALVED_AT),
                deviceAlias = values.int(DEVICE_ALIAS)?.takeIf { it >= 1 },
                deviceId = deviceId,
                name = values.text(NAME)?.takeIf(DeviceNames::isValid),
                codeKind = values.int(CODE_KIND)?.let { code -> CodeKind.entries.firstOrNull { it.code == code } },
                setupCode = values.text(SETUP_CODE)?.takeIf(SyncState::isSetupCode),
                deleteSetupCode = values.list(DELETE_SETUP_CODE)?.takeIf { list ->
                    list.size <= SyncState.MOST_SETUP_CODES && list.distinct() == list && list.all(SyncAddress::isValid)
                }.orEmpty(),
                removed = values.list(REMOVED)?.takeIf { list ->
                    list.size <= SyncState.MOST_REMOVED && list.all { SyncState.HEX_ID.matches(it) } && deviceId?.hex !in list
                }?.toSet().orEmpty(),
                filesOnMobile = values.boolean(FILES_ON_MOBILE),
                apps = apps,
                infoAt = values.time(INFO_AT),
                statusAt = values.time(STATUS_AT),
                devicesAt = values.time(DEVICES_AT),
                failedRuns = values.int(FAILED_RUNS)?.takeIf { it in 0..SyncState.MOST_FAILED_RUNS } ?: 0,
                retryAt = values.time(RETRY_AT),
                dayWait = dayWait.takeIf { dayWaitUntil != null },
                dayWaitUntil = dayWaitUntil.takeIf { dayWait != null },
                full = values.boolean(FULL),
                fullAt = values.time(FULL_AT),
                clockOff = values.long(CLOCK_OFF),
                putBack = values.boolean(PUT_BACK),
                fault = values.boolean(FAULT),
                syncedAt = values.time(SYNCED_AT),
            )
        }

        private fun limitsOf(text: String): Limits? {
            val match = LIMITS_TEXT.matchEntire(text) ?: return null
            val (records, bytes, items) = match.destructured
            val limits = Triple(records.toInt(), bytes.toInt(), items.toInt())
            return if (limits.first in Limits.RECORDS && limits.second in Limits.BYTES && limits.third in Limits.FILE_ITEMS) {
                Limits(limits.first, limits.second, limits.third)
            } else {
                null
            }
        }

        /** Puts into [editor] every value that differs between [before] and [after], and removes those [after] lacks. */
        private fun write(before: SyncState, after: SyncState, editor: SharedPreferences.Editor) {
            fun put(key: String, old: Any?, new: Any?) {
                if (old == new) return
                when (new) {
                    null -> editor.remove(key)
                    is Boolean -> if (new) editor.putBoolean(key, true) else editor.remove(key)
                    is Int -> editor.putInt(key, new)
                    is Long -> editor.putLong(key, new)
                    is String -> editor.putString(key, new)
                    else -> error("No value of this type is stored")
                }
            }
            put(STAGE, before.stage.code, after.stage.code)
            put(STOP, before.stop?.code, after.stop?.code)
            put(CLOSING, before.closing, after.closing)
            put(JOINED_AT, before.joinedAt, after.joinedAt)
            put(ADDRESS, before.address, after.address)
            put(SERVER_ID, before.serverId?.hex, after.serverId?.hex)
            put(EPOCH, before.epoch?.hex, after.epoch?.hex)
            put(KEY_ID, before.keyId?.toString(), after.keyId?.toString())
            put(REVISION, before.revision, after.revision)
            put(LIMITS, before.limits?.text(), after.limits?.text())
            put(HALVED, before.halved, after.halved)
            put(HALVED_AT, before.halvedAt, after.halvedAt)
            put(DEVICE_ALIAS, before.deviceAlias, after.deviceAlias)
            put(DEVICE_ID, before.deviceId?.hex, after.deviceId?.hex)
            put(NAME, before.name, after.name)
            put(CODE_KIND, before.codeKind?.code, after.codeKind?.code)
            put(SETUP_CODE, before.setupCode, after.setupCode)
            put(DELETE_SETUP_CODE, before.deleteSetupCode.listText(), after.deleteSetupCode.listText())
            put(REMOVED, before.removed.sorted().listText(), after.removed.sorted().listText())
            put(FILES_ON_MOBILE, before.filesOnMobile, after.filesOnMobile)
            put(INFO_AT, before.infoAt, after.infoAt)
            put(STATUS_AT, before.statusAt, after.statusAt)
            put(DEVICES_AT, before.devicesAt, after.devicesAt)
            put(FAILED_RUNS, before.failedRuns, after.failedRuns)
            put(RETRY_AT, before.retryAt, after.retryAt)
            put(DAY_WAIT, before.dayWait?.code, after.dayWait?.code)
            put(DAY_WAIT_UNTIL, before.dayWaitUntil, after.dayWaitUntil)
            put(FULL, before.full, after.full)
            put(FULL_AT, before.fullAt, after.fullAt)
            put(CLOCK_OFF, before.clockOff, after.clockOff)
            put(PUT_BACK, before.putBack, after.putBack)
            put(FAULT, before.fault, after.fault)
            put(SYNCED_AT, before.syncedAt, after.syncedAt)
            (before.apps.keys + after.apps.keys).forEach { app ->
                val old = before.apps[app]
                val new = after.apps[app]
                put(HEAD + app, old?.head, new?.head)
                put(GOOD + app, old?.goodAt, new?.goodAt)
                put(ON + app, old?.on, new?.on)
                put(WORK + app, old?.work, new?.work)
                put(POKED + app, old?.poked, new?.poked)
            }
        }

        private fun Limits.text(): String = "$records,$bytes,$fileItems"

        private fun List<String>.listText(): String? = if (isEmpty()) null else joinToString(SEPARATOR.toString())
    }

    /** The stored values, each read only if it has the type it is written with. */
    private class Values(private val stored: Map<String, *>) {
        fun int(key: String): Int? = stored[key] as? Int

        fun long(key: String): Long? = stored[key] as? Long

        fun time(key: String): Long? = long(key)?.takeIf(::isTime)

        fun boolean(key: String): Boolean = stored[key] as? Boolean ?: false

        fun text(key: String): String? = stored[key] as? String

        fun list(key: String): List<String>? = text(key)?.split(SEPARATOR)?.takeIf { parts -> parts.none { it.isEmpty() } }
    }
}
