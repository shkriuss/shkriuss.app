package app.shkriuss.feature.sync

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.NameKeyState
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.security.courierPeer
import app.shkriuss.core.sync.Courier
import app.shkriuss.core.sync.Refusal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The app class of Sync implements this, so that the parts Android
 * creates itself, the job service and the courier provider, reach the one
 * [SyncServices] of the app.
 */
interface SyncHost {
    val sync: SyncServices
}

/**
 * Everything of Sync but its screens, built once by the app class: the
 * state, the server, the data apps' couriers, the run, the join, the
 * devices and the scheduling. Each part gets what it needs through its
 * constructor.
 */
class SyncServices(
    val store: SyncStateStore,
    private val keys: SyncKeys,
    private val server: SyncServer,
    couriers: Couriers,
    private val scheduler: Scheduler,
    private val network: NetworkState,
    private val clock: Clock,
    model: String,
) {
    /** The scope of the work that outlives a screen: runs and the checks at start. */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val problems = ProblemWriter(store, keys, scheduler, clock)

    val run: SyncRun = SyncRun(store, server, couriers, keys, network, problems, clock)
    val join: SyncJoin = SyncJoin(store, server, keys, scheduler, clock, model)
    val devices: SyncDevices = SyncDevices(store, server, keys, scheduler, problems, clock)

    /**
     * Call at each start of Sync, after [ShkCrypto.start], before any
     * screen (docs/apps/sync/spec.md, "Stopped between two writes"): the
     * device keys that the state does not name go, a join left for a day
     * is cancelled, a join whose `enrol` was sent asks the server, a joined
     * phone checks its keys and asks for its periodic work again, and a
     * phone stopped for a version reads `info` again.
     */
    fun start() {
        scope.launch {
            try {
                startChecks()
            } catch (_: BlobException) {
                // The Keystore cannot be used now: the next start checks again.
            } catch (_: CouldNotSaveException) {
                // The next start checks again.
            }
        }
    }

    internal fun startChecks() {
        val state = store.now()
        // A removed phone keeps no key: one whose deletion failed after the `03` goes here.
        val removed = state.stage == Stage.STOPPED && state.stop == Stop.REMOVED
        keys.deleteOtherDeviceKeys(state.deviceAlias.takeIf { state.stage != Stage.NOT_JOINED && !removed })
        if (state.stage == Stage.NOT_JOINED && keys.nameKeyState() != NameKeyState.MISSING) keys.deleteNameKey()
        val now = clock.nowMillis()
        when (state.stage) {
            Stage.NOT_JOINED -> Unit
            Stage.JOINING -> {
                val since = state.joinedAt
                if (since == null || since > now || now - since >= SyncJoin.JOIN_LIFE_MILLIS) join.cancel() else join.dropEarlierNameKey()
            }
            Stage.ENROL_SENT -> join.checkSentEnrol()
            // Only the state that was read: a Leave or a new join meanwhile, which deletes the keys, is kept.
            Stage.JOINED -> if (keysLost(state)) problems.stop(Stop.KEYS_GONE, onlyIf = { it.isSameDeviceAs(state) }) else scheduler.schedulePeriodic()
            Stage.STOPPED -> if (state.stop == Stop.UPDATE_SYNC || state.stop == Stop.UPDATE_SERVER) checkVersion()
        }
    }

    /**
     * **Try again** of a problem: a phone stopped for a version reads
     * `info` again; any other asks for a run that skips the 4-hour wait.
     * False if Android refused the run: "Could not start a run. Try again."
     */
    fun tryAgain(): Boolean {
        val state = store.now()
        if (state.stage == Stage.STOPPED && (state.stop == Stop.UPDATE_SYNC || state.stop == Stop.UPDATE_SERVER)) {
            scope.launch {
                try {
                    checkVersion()
                } catch (_: CouldNotSaveException) {
                    // Try again once more.
                }
            }
            return true
        }
        return scheduler.runSoon(asked = true)
    }

    /** **Sync now**. False if Android refused: "Could not start a run. Try again." */
    fun syncNow(): Boolean = scheduler.runSoon(asked = true)

    /** **Files on mobile data**. */
    fun setFilesOnMobile(on: Boolean): Boolean = try {
        store.update { it.copy(filesOnMobile = on) }
        true
    } catch (_: CouldNotSaveException) {
        false
    }

    /**
     * At `stop` 4 or 6: `info` again. When it names version 1, the stop
     * ends and the periodic work is asked for again.
     */
    private fun checkVersion() {
        val state = store.now()
        if (keysLost(state)) {
            problems.stop(Stop.KEYS_GONE, onlyIf = { it.isSameDeviceAs(state) })
            return
        }
        val address = state.address ?: return
        val info = (server.info(address) as? ServerAnswer.Done)?.value ?: return
        val stop = when {
            info.lowest > ServerInfo.VERSION -> Stop.UPDATE_SYNC
            info.highest < ServerInfo.VERSION -> Stop.UPDATE_SERVER
            info.state == ServerState.CLOSED -> Stop.CLOSED
            else -> null
        }
        // Only the state this answer is for: a Leave or a new join while `info` was on its way is kept.
        fun same(now: SyncState) = now.stage == Stage.STOPPED && now.stop == state.stop && now.address == address && now.deviceId == state.deviceId
        var joined = false
        store.update {
            when {
                !same(it) -> it
                // `info` passed: the fault and the clock no longer hold (spec, Problems).
                stop != null -> it.copy(stop = stop, fault = false, clockOff = null)
                else -> it.copy(stage = Stage.JOINED, stop = null, limits = info.limits, infoAt = clock.nowMillis(), fault = false, clockOff = null)
                    .also { joined = true }
            }
        }
        if (joined) scheduler.schedulePeriodic()
    }

    /**
     * True when a joined phone lost what it needs (docs/apps/sync/spec.md,
     * "Data", point 2): a value of the server or of the device key, the
     * device key, a device key that does not give `deviceId`, or the name
     * key.
     */
    private fun keysLost(state: SyncState): Boolean {
        if (SyncRun.sessionOf(state, keys) == null) return true
        val name = keys.nameKeyState()
        return name == NameKeyState.MISSING || name == NameKeyState.LOST
    }

    /**
     * The answer of Sync's own courier provider to the data app [app],
     * which passed the check: `poke` marks it and asks for a run soon;
     * `state` says where this phone stands for it. A call of another
     * version is refused with `UPDATE`; any other call gets nothing.
     */
    fun answer(app: AppName, method: String, extras: Bundle?): Bundle? {
        val version = try {
            extras?.getInt(Courier.VERSION_KEY, 0) ?: 0
        } catch (_: RuntimeException) {
            0
        }
        if (method != Courier.POKE && method != Courier.STATE) return null
        if (version != Courier.VERSION) return Bundle().apply { putString(Courier.REFUSAL, Refusal.UPDATE.name) }
        return when (method) {
            Courier.POKE -> {
                poke(app)
                Bundle()
            }
            else -> Bundle().apply {
                putByteArray(Courier.BYTES, appStateOf(store.now(), app.value, clock.nowMillis(), network.isMetered()).toBytes())
            }
        }
    }

    /** A poke starts no network call by itself: it marks the app and asks Android for a run soon. A lost poke loses nothing. */
    private fun poke(app: AppName) {
        if (store.now().stage != Stage.JOINED) return
        try {
            store.update { state -> state.withApp(app.value) { it.copy(poked = true) } }
        } catch (_: CouldNotSaveException) {
            // The daily status of every app finds what the poke was for.
        }
        scheduler.runSoon(asked = false)
    }

    companion object {
        /** The services of the app [context], with the cryptography [crypto] of the app name `sync`. */
        fun create(context: Context, crypto: ShkCrypto): SyncServices {
            val application = context.applicationContext
            val connectivity = application.getSystemService(ConnectivityManager::class.java)
            return SyncServices(
                store = SyncStateStore.open(application),
                keys = crypto.sync,
                server = SyncServer(HttpsTransport(), crypto.sync, Clock.System),
                couriers = AndroidCouriers(application),
                scheduler = JobSchedulerScheduler(application),
                network = NetworkState { connectivity?.isActiveNetworkMetered ?: true },
                clock = Clock.System,
                model = Build.MODEL.orEmpty(),
            )
        }
    }
}

/**
 * Sync's own courier provider, `app.shkriuss.sync.courier` (docs/
 * architecture/sync-protocol.md, "What the Sync app answers"). It is
 * exported with no permission, so any app may call it. It checks the
 * caller first, before it reads anything of the call: a data app of the
 * suite, of the same build kind, signed now with exactly Sync's
 * certificate. A refused caller gets nothing. It holds no data and
 * answers nothing else: no query, no file, no change.
 */
class SyncCourierProvider : ContentProvider() {
    /** Nothing to set up: the app class holds the services. */
    override fun onCreate(): Boolean = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        val context = context ?: return null
        val caller = try {
            callingPackage
        } catch (_: SecurityException) {
            null
        }
        val app = courierPeer(context, caller) ?: return null
        // The app class, not onCreate: a provider is made before the app class has started.
        val sync = (context.applicationContext as? SyncHost)?.sync ?: return null
        return sync.answer(app, method, extras)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
