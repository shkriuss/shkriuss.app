package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.sync.SyncAppState
import app.shkriuss.core.sync.SyncStop

/**
 * What stops sync on this phone, in the order of docs/apps/sync/spec.md,
 * "Problems": the device line on Apps shows the first that applies.
 */
enum class SyncProblem {
    CLOSED,
    REMOVED,
    NOT_A_DEVICE,
    KEYS_GONE,
    UPDATE_SYNC,
    UPDATE_SERVER,
    CLOCK,
    FAULT,
    DAY_LIMIT,
    FULL,
    CANNOT_REACH,
    PUT_BACK,
}

/** The first problem that applies to [state] at [now], or null for none. */
fun problemOf(state: SyncState, now: Long): SyncProblem? {
    if (state.stage == Stage.STOPPED) {
        return when (state.stop) {
            Stop.CLOSED -> SyncProblem.CLOSED
            Stop.REMOVED -> SyncProblem.REMOVED
            Stop.NOT_A_DEVICE -> SyncProblem.NOT_A_DEVICE
            Stop.KEYS_GONE, null -> SyncProblem.KEYS_GONE
            Stop.UPDATE_SYNC -> SyncProblem.UPDATE_SYNC
            Stop.UPDATE_SERVER -> SyncProblem.UPDATE_SERVER
        }
    }
    if (state.stage != Stage.JOINED) return null
    val until = state.dayWaitUntil
    return when {
        state.clockOff != null -> SyncProblem.CLOCK
        state.fault -> SyncProblem.FAULT
        state.dayWait == DayWait.EVERYTHING && until != null && now < until && until - now <= SyncRun.DAY_MILLIS -> SyncProblem.DAY_LIMIT
        state.full -> SyncProblem.FULL
        state.failedRuns >= SyncState.MOST_FAILED_RUNS -> SyncProblem.CANNOT_REACH
        state.putBack -> SyncProblem.PUT_BACK
        else -> null
    }
}

/**
 * What Sync answers a data app to `state` (docs/architecture/
 * sync-protocol.md, "What `state` gives"): for the app [app], at [now],
 * with the phone's network [metered] or not.
 */
fun appStateOf(state: SyncState, app: String, now: Long, metered: Boolean): SyncAppState {
    val stop = when (problemOf(state, now)) {
        SyncProblem.CLOSED, SyncProblem.REMOVED, SyncProblem.NOT_A_DEVICE, SyncProblem.KEYS_GONE -> SyncStop.NOT_JOINED
        SyncProblem.UPDATE_SYNC -> SyncStop.UPDATE_SYNC
        SyncProblem.UPDATE_SERVER -> SyncStop.UPDATE_THE_SERVER
        SyncProblem.CLOCK -> SyncStop.CLOCK
        SyncProblem.FAULT -> SyncStop.FAULT
        SyncProblem.DAY_LIMIT -> SyncStop.DAY_LIMIT
        SyncProblem.FULL -> SyncStop.FULL
        SyncProblem.CANNOT_REACH -> SyncStop.CANNOT_REACH
        SyncProblem.PUT_BACK, null -> if (state.stage == Stage.JOINED) SyncStop.NONE else SyncStop.NOT_JOINED
    }
    val value = when (stop) {
        SyncStop.DAY_LIMIT -> state.dayWaitUntil ?: 0
        SyncStop.CLOCK -> state.clockOff ?: 0
        else -> 0
    }
    val joined = stop != SyncStop.NOT_JOINED
    return SyncAppState(
        joined = joined,
        goodAt = if (joined) state.app(app).goodAt ?: 0 else 0,
        stop = stop,
        value = value,
        filesWaitForUnmetered = joined && !state.filesOnMobile && metered,
    )
}

/** Asks Android for runs: the periodic work and one soon. Tests pass their own. */
interface Scheduler {
    /** The periodic work, every 15 minutes with a network. Asking again while it exists changes nothing. */
    fun schedulePeriodic()

    /** One run soon, with a network. A request while one waits keeps the one that waits. False if Android refused. */
    fun runSoon(asked: Boolean): Boolean

    /** Cancels both. */
    fun cancel()
}

/**
 * Writes what an answer of the server means for the whole phone
 * (docs/apps/sync/spec.md, "Problems"): a stop, with both works
 * cancelled, a fault, the clock, a wait for the day, a full server, or a
 * failed run.
 */
class ProblemWriter(private val store: SyncStateStore, private val keys: SyncKeys, private val scheduler: Scheduler, private val clock: Clock) {
    /** Sync stops for [stop]. A removed phone's device key is deleted after the state no longer needs it. */
    fun stop(stop: Stop) {
        val alias = store.now().deviceAlias
        store.update { it.copy(stage = Stage.STOPPED, stop = stop) }
        scheduler.cancel()
        if (stop == Stop.REMOVED && alias != null) {
            try {
                keys.deleteDeviceKey(alias)
            } catch (_: BlobException) {
                // The next start deletes every device key that the state does not keep.
            }
        }
    }

    /** Writes what [reason] says. [countsAsFailedRun] is true in a run, where a server that cannot be reached counts. */
    internal fun write(reason: Reason, countsAsFailedRun: Boolean) {
        val now = clock.nowMillis()
        when (reason) {
            is Reason.Stopped -> stop(reason.stop)
            Reason.Fault -> store.update { it.copy(fault = true) }
            is Reason.ClockOff -> store.update { it.copy(clockOff = reason.serverTime - now) }
            Reason.Full -> store.update { it.copy(full = true, fullAt = now) }
            is Reason.Wait -> store.update { it.copy(dayWait = reason.kind, dayWaitUntil = SyncRun.nextUtcMidnight(now)) }
            Reason.Unreachable -> if (countsAsFailedRun) {
                store.update {
                    val failed = minOf(it.failedRuns + 1, SyncState.MOST_FAILED_RUNS)
                    it.copy(failedRuns = failed, retryAt = if (failed == SyncState.MOST_FAILED_RUNS) now + SyncRun.RETRY_WAIT_MILLIS else null)
                }
            }
        }
    }
}
