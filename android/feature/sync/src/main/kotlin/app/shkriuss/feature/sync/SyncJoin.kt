package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.CannotMakeHardwareKeyException
import app.shkriuss.core.crypto.DeviceId
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.DeviceKeyGoneException
import app.shkriuss.core.crypto.DeviceNames
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.SignedJoin
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.sync.SyncId
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs

/** What the server address step found (docs/apps/sync/spec.md, join step 2). */
sealed interface AddressStep {
    /** The server answered as a sync server of version 1. With no account it takes only a setup code. */
    data class Ready(val hasAccount: Boolean) : AddressStep

    /** "Enter only the address, such as sync.example.workers.dev." */
    data object NotAnAddress : AddressStep

    /** "Could not reach the server. Check the address and that the phone is online." */
    data object Unreachable : AddressStep

    /** "The server's certificate is not one this phone trusts." */
    data object Untrusted : AddressStep

    /** "This address does not answer as a sync server." */
    data object NotASyncServer : AddressStep

    /** "Update the Sync app." */
    data object UpdateSync : AddressStep

    /** "Update your server." */
    data object UpdateServer : AddressStep

    /** "This server was closed. Deploy a new server to sync again." */
    data object Closed : AddressStep

    /** "This phone's clock is off by …": the server's clock minus the phone's. */
    data class ClockOff(val offset: Long) : AddressStep

    /** "Sync could not save. Try again." */
    data object NotSaved : AddressStep

    /** **Back**, or another address, while `info` was on its way: its answer changed nothing. */
    data object Changed : AddressStep
}

/** What the setup code step gives. */
sealed interface SetupCodeStep {
    data class Code(val code: String) : SetupCodeStep {
        override fun toString(): String = "Code"
    }

    /** "Delete the setup codes that Sync lists first." */
    data object TooManyWaiting : SetupCodeStep

    data object NotSaved : SetupCodeStep
}

/** What making the device key for join step 6 gives. */
sealed interface KeyStep {
    /** What the data app is asked to sign. */
    data class Request(val request: DeviceJoinRequest) : KeyStep

    /** "Sync could not make a key for this phone. Try again." */
    data object CouldNotMake : KeyStep

    data object NotSaved : KeyStep
}

/** What `enrol`, or the check of a join whose `enrol` was sent, gave (docs/apps/sync/spec.md, join step 7). */
sealed interface EnrolStep {
    /** Joined. [showedSetupCode] says whether step 8 follows. */
    data class Joined(val showedSetupCode: Boolean) : EnrolStep

    /** `09`. A device code goes back to step 4, a setup code stays at step 5. */
    data object WrongCode : EnrolStep

    /** `0A`: the server's current key ID. */
    data class OtherAccount(val keyId: KeyId) : EnrolStep

    /** `03`: the key was deleted. The join goes back to step 6 with a new key. */
    data object KeyRemoved : EnrolStep

    /** `06`: the join is cancelled. */
    data object Closed : EnrolStep

    /** `04` twice: "The server refused this phone. Try again later." */
    data object Refused : EnrolStep

    /** No answer: "Could not reach the server." */
    data object Unreachable : EnrolStep

    /** The statement is older than 10 minutes: back to step 6. */
    data object TooOld : EnrolStep

    /** The server did not take the `enrol` that was sent: a setup code goes back to step 6, a device code to step 4. */
    data object NotTaken : EnrolStep

    /** The data app's answer is not for what was asked. */
    data object NotForThisJoin : EnrolStep

    /** The join was cancelled or started anew while the request was on its way: its answer changed nothing. */
    data object Changed : EnrolStep

    /** `05`, `01` or an answer that breaks its layout: the line of step 2 that [line] names. */
    data class Line(val line: AddressStep) : EnrolStep

    /** "Sync could not save. Try again." */
    data object NotSaved : EnrolStep
}

/**
 * The join steps (docs/apps/sync/spec.md, "The join steps"), each with the
 * writes of "Stopped between two writes" in their order. The screens keep
 * a device code and the signed join in memory only: a device code is never
 * stored.
 */
class SyncJoin(
    private val store: SyncStateStore,
    private val server: SyncServer,
    private val keys: SyncKeys,
    private val scheduler: Scheduler,
    private val clock: Clock,
    /** Android's model name, the first name of this phone. */
    private val model: String,
) {
    /** Counts each address entered and each cancel, so that an `info` answer counts only for the newest one. */
    private val attempts = AtomicLong()

    /**
     * Step 2: checks the address, asks for `info`, and starts the join with
     * it. An answer that comes after **Back**, a cancel or another address
     * changes nothing.
     */
    fun enterAddress(typed: String): AddressStep {
        val attempt = attempts.incrementAndGet()
        val before = store.now()
        // A joined phone leaves its server, or joins again, before it joins another.
        if (before.stage == Stage.JOINED || before.stage == Stage.STOPPED) return AddressStep.NotSaved
        val address = ServerAddress.of(typed) ?: return AddressStep.NotAnAddress
        val info = when (val answer = server.info(address)) {
            is ServerAnswer.Done -> answer.value
            ServerAnswer.UntrustedCertificate -> return AddressStep.Untrusted
            ServerAnswer.Unreachable -> return AddressStep.Unreachable
            // A redirect or another HTTP status: "This address does not answer as a sync server."
            is ServerAnswer.Version -> return if (answer.lowest > ServerInfo.VERSION) AddressStep.UpdateSync else AddressStep.UpdateServer
            else -> return AddressStep.NotASyncServer
        }
        when {
            info.lowest > ServerInfo.VERSION -> return AddressStep.UpdateSync
            info.highest < ServerInfo.VERSION -> return AddressStep.UpdateServer
            info.state == ServerState.CLOSED -> return AddressStep.Closed
        }
        val offset = info.clock - clock.nowMillis()
        if (abs(offset) > CLOCK_MARGIN_MILLIS) return AddressStep.ClockOff(offset)
        val joining = before.stage == Stage.JOINING || before.stage == Stage.ENROL_SENT
        val sameServer = joining && before.serverId == info.serverId && before.address == address
        var changed = false
        try {
            store.update { state ->
                if (attempts.get() != attempt || !state.sameJoinAs(before)) {
                    changed = true
                    return@update state
                }
                val kept = if (sameServer) state else SyncState(closing = state.closing, deleteSetupCode = state.deleteSetupCode, filesOnMobile = state.filesOnMobile)
                kept.copy(
                    stage = Stage.JOINING,
                    stop = null,
                    joinedAt = clock.nowMillis(),
                    address = address,
                    serverId = info.serverId,
                    limits = info.limits,
                    infoAt = clock.nowMillis(),
                )
            }
        } catch (_: CouldNotSaveException) {
            return AddressStep.NotSaved
        }
        if (changed) return AddressStep.Changed
        // Another server ID drops the old key and the setup code.
        if (!sameServer) deleteKeys(keys, before.deviceAlias)
        return AddressStep.Ready(hasAccount = info.state == ServerState.IN_USE)
    }

    /** Step 3: how this phone gets its code. */
    fun chooseCode(kind: CodeKind): Boolean = saved { store.update { it.copy(codeKind = kind) } }

    /** Step 5: the setup code of this join, made and stored before it shows. The same code shows again. */
    fun setupCode(): SetupCodeStep {
        val state = store.now()
        val address = state.address ?: return SetupCodeStep.NotSaved
        state.setupCode?.let { return SetupCodeStep.Code(it) }
        if (address !in state.deleteSetupCode && state.deleteSetupCode.size >= SyncState.MOST_SETUP_CODES) return SetupCodeStep.TooManyWaiting
        val code = try {
            keys.newSetupCode()
        } catch (_: BlobException) {
            return SetupCodeStep.NotSaved
        }
        if (!saved { store.update { it.copy(codeKind = CodeKind.SETUP_CODE, setupCode = code, deleteSetupCode = (it.deleteSetupCode + address).distinct()) } }) {
            return SetupCodeStep.NotSaved
        }
        return SetupCodeStep.Code(code)
    }

    /** **Done** of a line to delete a setup code, or of step 8: the address leaves the list. */
    fun setupCodeDeleted(address: String): Boolean = saved { store.update { it.copy(deleteSetupCode = it.deleteSetupCode - address) } }

    /**
     * Step 6: the device key of this join, made here if it has none, and
     * what a data app is asked to sign. [keyId] names an older recovery key
     * after `0A`.
     */
    fun joinRequest(keyId: KeyId? = null): KeyStep {
        try {
            val state = store.now()
            val address = state.address ?: return KeyStep.NotSaved
            val serverId = state.serverId ?: return KeyStep.NotSaved
            val alias = state.deviceAlias ?: keys.newDeviceKeyNumber().also { number -> store.update { it.copy(deviceAlias = number) } }
            val key = keys.makeDeviceKey(alias)
            val id = key.deviceId.toSyncId()
            if (store.now().deviceId != id) store.update { it.copy(deviceId = id) }
            val request = DeviceJoinRequest.of(serverId.toBytes(), address, key.publicKey, keyId) ?: return KeyStep.CouldNotMake
            return KeyStep.Request(request)
        } catch (_: CannotMakeHardwareKeyException) {
            return KeyStep.CouldNotMake
        } catch (_: BlobException) {
            return KeyStep.CouldNotMake
        } catch (_: CouldNotSaveException) {
            return KeyStep.NotSaved
        }
    }

    /**
     * The keeper's answer: the name key is stored, then `stage` 2 and the
     * name, then `enrol` is sent with [code] of the kind chosen at step 3.
     */
    fun takeSignedJoin(signed: SignedJoin, request: DeviceJoinRequest, code: String): EnrolStep {
        if (!signed.isFor(request)) return EnrolStep.NotForThisJoin
        // The keeper can answer after Back or a new join: its answer counts only for the join it was asked for.
        if (!store.now().isJoinOf(request)) return EnrolStep.Changed
        var applied = false
        try {
            keys.storeNameKey(signed)
            store.update {
                if (it.isJoinOf(request)) {
                    applied = true
                    it.copy(stage = Stage.ENROL_SENT, name = it.name ?: firstName())
                } else {
                    it
                }
            }
        } catch (_: BlobException) {
            return EnrolStep.NotSaved
        } catch (_: CouldNotSaveException) {
            return EnrolStep.NotSaved
        }
        // A name key stored for a join that ended meanwhile goes at the next start, or with the next join's own.
        if (!applied) return EnrolStep.Changed
        return enrol(signed, code)
    }

    /** At step 6 of the join that [request] was made for: the same server, address and device key. */
    private fun SyncState.isJoinOf(request: DeviceJoinRequest): Boolean = stage == Stage.JOINING && address == request.address &&
        serverId?.toBytes()?.contentEquals(request.serverId) == true &&
        deviceId == DeviceId.ofPublicKey(request.devicePublicKey).toSyncId()

    /** **Try again** at step 7: the same `enrol`, or back to step 6 when the statement is older than 10 minutes. */
    fun enrolAgain(signed: SignedJoin, code: String): EnrolStep {
        if (clock.nowMillis() - signed.time > STATEMENT_LIFE_MILLIS) {
            return if (saved { store.update { it.copy(stage = Stage.JOINING) } }) EnrolStep.TooOld else EnrolStep.NotSaved
        }
        return enrol(signed, code)
    }

    private fun enrol(signed: SignedJoin, code: String): EnrolStep {
        val state = store.now()
        if (state.stage != Stage.ENROL_SENT) return EnrolStep.NotSaved
        val mark = JoinMark.of(state)
        val kind = state.codeKind ?: return EnrolStep.NotSaved
        val session = try {
            sessionOrNull(state)
        } catch (_: BlobException) {
            // The Keystore cannot be used now: the key is not gone.
            return EnrolStep.NotSaved
        } ?: return keyRemoved(mark)
        val deviceId = state.deviceId ?: return keyRemoved(mark)
        val name = state.name ?: firstName()
        val answer = try {
            val sealed = keys.sealName(DeviceId.ofBytes(deviceId.toBytes()) ?: return keyRemoved(mark), name)
            server.enrol(session, kind, code, signed, sealed)
        } catch (_: DeviceKeyGoneException) {
            return keyRemoved(mark)
        } catch (_: BlobException) {
            return EnrolStep.NotSaved
        }
        return when (answer) {
            is ServerAnswer.Done -> joined(mark, answer.value, signed.keyId)
            ServerAnswer.WrongCode -> back(mark, EnrolStep.WrongCode)
            is ServerAnswer.OtherAccount -> back(mark, EnrolStep.OtherAccount(answer.keyId))
            ServerAnswer.Removed -> keyRemoved(mark)
            ServerAnswer.Closed -> cancelled(mark, EnrolStep.Closed)
            ServerAnswer.DoesNotCheck -> EnrolStep.Refused
            ServerAnswer.Unreachable -> EnrolStep.Unreachable
            ServerAnswer.UntrustedCertificate -> EnrolStep.Line(AddressStep.Untrusted)
            is ServerAnswer.Clock -> EnrolStep.Line(AddressStep.ClockOff(answer.serverTime - clock.nowMillis()))
            is ServerAnswer.Version -> EnrolStep.Line(if (answer.lowest > ServerInfo.VERSION) AddressStep.UpdateSync else AddressStep.UpdateServer)
            else -> EnrolStep.Line(AddressStep.NotASyncServer)
        }
    }

    /**
     * At a start of Sync with `stage` 2: `enrol` was sent and its answer
     * not seen. `heads`, signed with the join's key, tells whether the
     * server took it.
     */
    fun checkSentEnrol(): EnrolStep {
        val state = store.now()
        if (state.stage != Stage.ENROL_SENT) return EnrolStep.NotSaved
        val mark = JoinMark.of(state)
        val session = try {
            sessionOrNull(state)
        } catch (_: BlobException) {
            return EnrolStep.NotSaved
        } ?: return keyRemoved(mark)
        val answer = try {
            server.heads(session)
        } catch (_: DeviceKeyGoneException) {
            return keyRemoved(mark)
        } catch (_: BlobException) {
            return EnrolStep.NotSaved
        }
        return when (answer) {
            is ServerAnswer.Done -> joined(mark, answer.value.epoch, answer.value.keyId, heads = answer.value)
            // The server did not take it: back to the step before stage 2.
            ServerAnswer.NotADevice -> back(mark, EnrolStep.NotTaken)
            ServerAnswer.Removed -> keyRemoved(mark)
            ServerAnswer.Closed -> cancelled(mark, EnrolStep.Closed)
            is ServerAnswer.Clock -> EnrolStep.Line(AddressStep.ClockOff(answer.serverTime - clock.nowMillis()))
            else -> EnrolStep.Unreachable
        }
    }

    /**
     * Cancels the join: `stage` 0 and the join's values go in one write,
     * then the device key and the name key. The addresses whose setup code
     * waits to be deleted stay.
     */
    fun cancel(): Boolean {
        attempts.incrementAndGet()
        return saved { forgetServer(store, keys, scheduler) }
    }

    /** The same join, or the same lack of one, as [other]: nothing cancelled, started or sent meanwhile. */
    private fun SyncState.sameJoinAs(other: SyncState): Boolean = stage == other.stage && address == other.address &&
        serverId == other.serverId && joinedAt == other.joinedAt && deviceAlias == other.deviceAlias && deviceId == other.deviceId

    private fun joined(mark: JoinMark, epoch: SyncId, keyId: KeyId, heads: Heads? = null): EnrolStep {
        val showed = store.now().codeKind == CodeKind.SETUP_CODE
        val applied = applyTo(mark) {
            it.copy(
                stage = Stage.JOINED,
                epoch = epoch,
                keyId = keyId,
                revision = heads?.revision ?: it.revision,
                joinedAt = null,
                codeKind = null,
                setupCode = null,
            )
        } ?: return EnrolStep.NotSaved
        if (!applied) return EnrolStep.Changed
        scheduler.schedulePeriodic()
        return EnrolStep.Joined(showedSetupCode = showed)
    }

    /** Back to the step before `stage` 2. */
    private fun back(mark: JoinMark, step: EnrolStep): EnrolStep = when (applyTo(mark) { it.copy(stage = Stage.JOINING) }) {
        true -> step
        false -> EnrolStep.Changed
        null -> EnrolStep.NotSaved
    }

    /** `03`: the key is deleted, and the join goes back to step 6 with a new key. */
    private fun keyRemoved(mark: JoinMark): EnrolStep {
        when (applyTo(mark) { it.copy(stage = Stage.JOINING, deviceAlias = null, deviceId = null) }) {
            null -> return EnrolStep.NotSaved
            false -> return EnrolStep.Changed
            true -> Unit
        }
        try {
            mark.alias?.let(keys::deleteDeviceKey)
        } catch (_: BlobException) {
            // The next start deletes it: no state names it.
        }
        return EnrolStep.KeyRemoved
    }

    private fun cancelled(mark: JoinMark, step: EnrolStep): EnrolStep = try {
        if (forgetServer(store, keys, scheduler) { mark.isOf(it) }) step else EnrolStep.Changed
    } catch (_: CouldNotSaveException) {
        EnrolStep.NotSaved
    }

    /**
     * Writes [change] only while the state is still the join of [mark]:
     * true when it did, false when the join changed meanwhile, null when
     * Sync could not save.
     */
    private fun applyTo(mark: JoinMark, change: (SyncState) -> SyncState): Boolean? {
        var applied = false
        val saved = saved {
            store.update {
                if (mark.isOf(it)) {
                    applied = true
                    change(it)
                } else {
                    it
                }
            }
        }
        return if (saved) applied else null
    }

    /** Which join a request was sent for: an answer that comes later counts only for the same join. */
    private class JoinMark(val serverId: SyncId?, val address: String?, val alias: Int?, val deviceId: SyncId?) {
        fun isOf(state: SyncState): Boolean = state.stage == Stage.ENROL_SENT && state.serverId == serverId &&
            state.address == address && state.deviceAlias == alias && state.deviceId == deviceId

        companion object {
            fun of(state: SyncState): JoinMark = JoinMark(state.serverId, state.address, state.deviceAlias, state.deviceId)
        }
    }

    /** The join's session, or null when its key is gone. Throws [BlobException] when the Keystore cannot be used now. */
    private fun sessionOrNull(state: SyncState): Session? {
        val address = state.address ?: return null
        val serverId = state.serverId ?: return null
        val alias = state.deviceAlias ?: return null
        val key = keys.deviceKey(alias) ?: return null
        if (state.deviceId != null && key.deviceId.toHex() != state.deviceId.hex) return null
        return Session(address, serverId, key)
    }

    /** Android's model name, cut to 40 code points, or "Android device" when that is no name a device can have. */
    internal fun firstName(): String {
        val trimmed = model.trim()
        val cut = if (trimmed.codePointCount(0, trimmed.length) > DeviceNames.LONGEST) {
            trimmed.substring(0, trimmed.offsetByCodePoints(0, DeviceNames.LONGEST)).trim()
        } else {
            trimmed
        }
        return cut.takeIf(DeviceNames::isValid) ?: DEFAULT_NAME
    }

    private fun saved(write: () -> Unit): Boolean = try {
        write()
        true
    } catch (_: CouldNotSaveException) {
        false
    }

    companion object {
        /** The name of a phone whose model name cannot be one. */
        const val DEFAULT_NAME: String = "Android device"

        /** A clock more than 5 minutes from the server's cannot sync. */
        const val CLOCK_MARGIN_MILLIS: Long = 5 * 60 * 1000L

        /** A join statement is good for 10 minutes from its time. */
        const val STATEMENT_LIFE_MILLIS: Long = 10 * 60 * 1000L

        /** A join left at `stage` 1 for a day is cancelled at the next start. */
        const val JOIN_LIFE_MILLIS: Long = 24 * 60 * 60 * 1000L
    }
}
