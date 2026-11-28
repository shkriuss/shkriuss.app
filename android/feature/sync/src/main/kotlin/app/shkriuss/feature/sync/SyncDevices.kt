package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.DeviceId
import app.shkriuss.core.crypto.DeviceKeyGoneException
import app.shkriuss.core.crypto.DeviceNames
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.sync.SyncId

/**
 * Reads the list of devices and keeps the removed ones removed
 * (docs/architecture/sync-protocol.md, `heads`, points 4 to 6): every
 * device this phone knows was removed and that is in again is removed
 * again, which means the server was put back. Devices the list shows as
 * removed join the IDs this phone remembers, up to 10,000.
 */
internal class DeviceList(private val store: SyncStateStore, private val server: SyncServer, private val clock: Clock) {
    /** The list. [revision] is the one `heads` named, or null when the list is read without it. Throws [EndRun] for an answer that ends it. */
    fun read(session: Session, revision: Long?): List<ListedDevice> {
        val devices = SyncRun.valueOf(server.devices(session))
        val state = store.now()
        val thisPhone = state.deviceId?.hex
        val inAgain = devices.filter { !it.removed && it.id.hex in state.removed }
        var latest = revision ?: state.revision
        inAgain.forEach { latest = SyncRun.valueOf(server.removeDevice(session, it.id)) }
        val removed = state.removed + devices.filter { it.removed && it.id.hex != thisPhone }.map { it.id.hex }
        if (removed.size > SyncState.MOST_REMOVED) throw EndRun(Reason.Fault)
        store.update {
            it.copy(removed = removed, revision = latest, devicesAt = clock.nowMillis(), putBack = it.putBack || inAgain.isNotEmpty())
        }
        return devices.map { device -> if (device.id in inAgain.map { it.id }) device.asRemoved() else device }
    }

    private fun ListedDevice.asRemoved() = ListedDevice(id, publicKey, removed = true, addedAt, seenDay, sealedName)
}

/** One device of the list as Devices shows it. [name] is null for a name this phone cannot open. */
data class DeviceRow(val id: SyncId, val name: String?, val thisPhone: Boolean, val addedAt: Long, val seenDay: Long)

/** The answer of an action of Devices or of **Close the server** that talks to the server. */
sealed interface DeviceAnswer<out T> {
    data class Done<T>(val value: T) : DeviceAnswer<T>

    /** The server could not be reached. Nothing changed but what the action keeps by itself. */
    data object Unreachable : DeviceAnswer<Nothing>

    /** Any other answer: the problem it means is written, and Apps shows it. */
    data object Problem : DeviceAnswer<Nothing>

    /** Sync could not save, or the keys cannot be used now. Nothing changed. */
    data object NotSaved : DeviceAnswer<Nothing>
}

/**
 * The actions of Devices and of **Close the server** (docs/apps/sync/
 * spec.md, "Devices" and "Settings"), each with the writes of "Stopped
 * between two writes" in their order.
 */
class SyncDevices(
    private val store: SyncStateStore,
    private val server: SyncServer,
    private val keys: SyncKeys,
    private val scheduler: Scheduler,
    private val problems: ProblemWriter,
    private val clock: Clock,
) {
    /** The devices that are in: this phone first, as the screen orders the others. Also keeps the removed ones removed. */
    fun list(): DeviceAnswer<List<DeviceRow>> = withSession { session ->
        val devices = DeviceList(store, server, clock).read(session, revision = null)
        val thisPhone = store.now().deviceId
        devices.filter { !it.removed }.map { device ->
            val name = try {
                DeviceId.ofBytes(device.id.toBytes())?.let { keys.openName(it, device.sealedName) }
            } catch (_: BlobException) {
                null
            }
            DeviceRow(device.id, name, device.id == thisPhone, device.addedAt, device.seenDay)
        }
    }

    /** **Rename**: seals [name], sends `devices/name`, then stores the name and the revision. */
    fun rename(name: String): DeviceAnswer<Unit> {
        require(DeviceNames.isValid(name)) { "Not a name a device can have" }
        return withSession { session ->
            val sealed = keys.sealName(session.key.deviceId, name)
            val revision = SyncRun.valueOf(server.renameDevice(session, sealed))
            store.update { it.copy(name = name, revision = revision) }
        }
    }

    /** **Remove** another device: its ID goes into `removed` before the request, so a request that did not arrive is made again. */
    fun remove(id: SyncId): DeviceAnswer<Unit> {
        val state = store.now()
        if (id == state.deviceId) return DeviceAnswer.Problem
        try {
            if (id.hex !in state.removed) {
                if (state.removed.size >= SyncState.MOST_REMOVED) return DeviceAnswer.Problem
                store.update { it.copy(removed = it.removed + id.hex) }
            }
        } catch (_: CouldNotSaveException) {
            return DeviceAnswer.NotSaved
        }
        return withSession { session ->
            val revision = SyncRun.valueOf(server.removeDevice(session, id))
            store.update { it.copy(revision = revision) }
        }
    }

    /** **Show the code**: a new device code, which voids the one before. */
    fun deviceCode(): DeviceAnswer<DeviceCode> = withSession { session -> SyncRun.valueOf(server.enrolCode(session)) }

    /**
     * **Leave the server**: `devices/remove` of this phone, then the
     * server's values go, then the keys. With [anyway], after "Could not
     * reach the server", the request is not made.
     */
    fun leave(anyway: Boolean): DeviceAnswer<Unit> {
        if (!anyway) {
            val removed = withSession { session -> SyncRun.valueOf(server.removeDevice(session, session.key.deviceId.toSyncId())) }
            if (removed is DeviceAnswer.Unreachable || removed is DeviceAnswer.NotSaved) return removed
        }
        return try {
            forgetServer(store, keys, scheduler)
            DeviceAnswer.Done(Unit)
        } catch (_: CouldNotSaveException) {
            DeviceAnswer.NotSaved
        }
    }

    /**
     * **Close the server**: `closing` first, then `account/delete`. The
     * answer `00`, or a `06` while `closing` is set, ends the close: Sync
     * stops for good with this server, and `closing` stays until the user
     * has read its dialog ([closeRead]).
     */
    fun close(): DeviceAnswer<Unit> {
        try {
            store.update { it.copy(closing = true) }
        } catch (_: CouldNotSaveException) {
            return DeviceAnswer.NotSaved
        }
        return withSession { session ->
            when (val answer = server.deleteAccount(session)) {
                is ServerAnswer.Done, ServerAnswer.Closed -> problems.stop(Stop.CLOSED)
                else -> SyncRun.fail(answer)
            }
        }
    }

    /** **OK** in the dialog of a close. */
    fun closeRead() {
        store.update { it.copy(closing = false) }
    }

    /** Devices shows a list read after the put-back was found: its line no longer waits. */
    fun putBackSeen() {
        val state = store.now()
        if (state.putBack && state.devicesAt != null) store.update { it.copy(putBack = false) }
    }

    /** [action] with the session of a joined phone. Lost keys stop sync, and any answer that ends it writes its problem. */
    private fun <T> withSession(action: (Session) -> T): DeviceAnswer<T> {
        val state = store.now()
        if (state.stage != Stage.JOINED) return DeviceAnswer.Problem
        return try {
            val session = SyncRun.sessionOf(state, keys)
            if (session == null) {
                problems.stop(Stop.KEYS_GONE)
                return DeviceAnswer.Problem
            }
            DeviceAnswer.Done(action(session))
        } catch (end: EndRun) {
            if (end.reason == Reason.Unreachable) return DeviceAnswer.Unreachable
            try {
                problems.write(end.reason, countsAsFailedRun = false)
            } catch (_: CouldNotSaveException) {
                // Apps shows the problem at the next request.
            }
            DeviceAnswer.Problem
        } catch (_: DeviceKeyGoneException) {
            problems.stop(Stop.KEYS_GONE)
            DeviceAnswer.Problem
        } catch (_: BlobException) {
            DeviceAnswer.NotSaved
        } catch (_: CouldNotSaveException) {
            DeviceAnswer.NotSaved
        }
    }
}

/**
 * Forgets the server, for **Leave**, **Join again** and **Join another
 * server**: `stage` 0 and the server's values go in one write, then the
 * works are cancelled and the device key and the name key are deleted.
 * The setting, the addresses whose setup code waits to be deleted, and an
 * unread close stay.
 */
internal fun forgetServer(store: SyncStateStore, keys: SyncKeys, scheduler: Scheduler) {
    val alias = store.now().deviceAlias
    store.update { SyncState(closing = it.closing, deleteSetupCode = it.deleteSetupCode, filesOnMobile = it.filesOnMobile) }
    scheduler.cancel()
    deleteKeys(keys, alias)
}

/** Deletes the device key under [alias] and the name key. One that cannot go now goes at the next start. */
internal fun deleteKeys(keys: SyncKeys, alias: Int?) {
    try {
        alias?.let(keys::deleteDeviceKey)
        keys.deleteNameKey()
    } catch (_: BlobException) {
        // At the next start, a state that names no key deletes what is left.
    }
}

/** The same 16 bytes as a [SyncId]. */
internal fun DeviceId.toSyncId(): SyncId = SyncId(toBytes())
