package app.shkriuss.feature.sync

import android.content.SharedPreferences
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.RequestMethod
import app.shkriuss.core.crypto.SignedJoin
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.security.CourierApp
import app.shkriuss.core.security.CourierApps
import app.shkriuss.core.sync.ComparisonState
import app.shkriuss.core.sync.ExportedBatch
import app.shkriuss.core.sync.ExportedResult
import app.shkriuss.core.sync.ListedStream
import app.shkriuss.core.sync.Page
import app.shkriuss.core.sync.Refusal
import app.shkriuss.core.sync.SendAnswer
import app.shkriuss.core.sync.SendBlock
import app.shkriuss.core.sync.StreamFinish
import app.shkriuss.core.sync.SyncCounts
import app.shkriuss.core.sync.SyncId
import app.shkriuss.core.sync.SyncStatus
import app.shkriuss.core.testing.TestClock
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

/** Big-endian bytes for the layouts of the tests. */
internal class Bytes {
    private val buffer = ByteArrayOutputStream()
    private val out = DataOutputStream(buffer)

    fun u8(value: Int) = apply { out.writeByte(value) }

    fun u16(value: Int) = apply { out.writeShort(value) }

    fun i32(value: Int) = apply { out.writeInt(value) }

    fun i64(value: Long) = apply { out.writeLong(value) }

    fun bytes(value: ByteArray) = apply { out.write(value) }

    fun done(): ByteArray {
        out.flush()
        return buffer.toByteArray()
    }
}

internal fun id(byte: Int): ByteArray = ByteArray(16) { byte.toByte() }

internal fun syncId(byte: Int): SyncId = SyncId(id(byte))

internal fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

/** The SHA-256 of [bytes], for the hashes the tests name. */
internal fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

/** A blob that passes the server's look at it: `53 48 4B 01 01 01`, the key ID, then [size] bytes in all. */
internal fun blob(keyId: KeyId, fill: Int, size: Int = 60): ByteArray =
    byteArrayOf(0x53, 0x48, 0x4b, 1, 1, 1) + keyId.toBytes() + ByteArray(size - 10) { fill.toByte() }

/** The layout of a batch, as a data app's `export` gives it. */
internal fun batchBytes(token: Long, epoch: SyncId, cursor: Long, known: Long, comparison: Boolean, records: List<Pair<ByteArray, ByteArray>>): ByteArray {
    val out = Bytes().bytes("SHKSYNC".toByteArray()).u8(1).u8(0x20).i64(token).bytes(epoch.toBytes()).i64(cursor).i64(known)
        .u8(if (comparison) 1 else 0).i32(records.size)
    records.forEach { (recordId, blob) -> out.bytes(recordId).i32(blob.size).bytes(blob) }
    return out.done()
}

/** A preferences file in memory whose writes can be made to fail. */
internal class MemoryPreferences : SharedPreferences {
    val values = mutableMapOf<String, Any?>()
    var commits = 0
    var failWrites = false

    override fun getAll(): MutableMap<String, *> = values.toMutableMap()

    override fun getString(key: String?, defValue: String?): String? = values[key] as? String ?: defValue

    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = defValues

    override fun getInt(key: String?, defValue: Int): Int = values[key] as? Int ?: defValue

    override fun getLong(key: String?, defValue: Long): Long = values[key] as? Long ?: defValue

    override fun getFloat(key: String?, defValue: Float): Float = values[key] as? Float ?: defValue

    override fun getBoolean(key: String?, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue

    override fun contains(key: String?): Boolean = key in values

    override fun edit(): SharedPreferences.Editor = Editor()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

    private inner class Editor : SharedPreferences.Editor {
        private val changes = mutableMapOf<String, Any?>()
        private val removals = mutableSetOf<String>()

        override fun putString(key: String, value: String?) = apply { changes[key] = value }

        override fun putStringSet(key: String, values: MutableSet<String>?) = apply { changes[key] = values }

        override fun putInt(key: String, value: Int) = apply { changes[key] = value }

        override fun putLong(key: String, value: Long) = apply { changes[key] = value }

        override fun putFloat(key: String, value: Float) = apply { changes[key] = value }

        override fun putBoolean(key: String, value: Boolean) = apply { changes[key] = value }

        override fun remove(key: String) = apply { removals += key }

        override fun clear() = apply { removals += values.keys }

        override fun commit(): Boolean {
            if (failWrites) return false
            removals.forEach { values.remove(it) }
            values.putAll(changes)
            commits++
            return true
        }

        override fun apply() {
            commit()
        }
    }
}

/** Asks for nothing from Android: it counts what it was asked. */
internal class FakeScheduler : Scheduler {
    var periodic = 0
    var soon = mutableListOf<Boolean>()
    var cancels = 0
    var refuse = false

    override fun schedulePeriodic() {
        periodic++
    }

    override fun runSoon(asked: Boolean): Boolean {
        soon += asked
        return !refuse
    }

    override fun cancel() {
        cancels++
    }
}

/** One device of [FakeServer]. */
internal class FakeDevice(val id: SyncId, val publicKey: ByteArray, var removed: Boolean, val addedAt: Long, var sealedName: ByteArray)

/** One record that [FakeServer] stores. */
internal class FakeRecord(val id: ByteArray, var number: Long, var blob: ByteArray)

/**
 * A server in memory, behind [Transport]: the calls of the protocol, with
 * enough of their rules for the tests of the Sync app. A test can put
 * answers of its own ahead of these for a path, and make the server
 * unreachable. It does not check signatures: core/crypto's tests and the
 * server's own do.
 */
internal class FakeServer(private val clock: TestClock, val address: String = "https://sync.example.workers.dev") : Transport {
    val serverId = syncId(1)
    var epoch = syncId(2)
    var keyId = KeyId(0x0a0b0c0d)
    var revision = 0L
    var lowest = 1
    var highest = 1
    var serverState = ServerState.IN_USE
    var limits = Triple(100L, 524_288L, 256L)
    var clockOffset = 0L
    val heads = mutableMapOf<String, Long>()
    val told = mutableMapOf<String, Long>()
    val records = mutableMapOf<String, MutableList<FakeRecord>>()
    val chunks = mutableMapOf<String, ByteArray>()
    val devices = mutableListOf<FakeDevice>()
    val requests = mutableListOf<HttpRequest>()
    var unreachable = false

    /** Answers that come first, by path without query, in order. Null lets the server answer that one itself. */
    val ahead = mutableMapOf<String, ArrayDeque<HttpResult?>>()

    /** Puts [answer] ahead of the server's own answer to the next request for [path], or the server's own for null. */
    fun answerNext(path: String, answer: HttpResult?) {
        ahead.getOrPut(path) { ArrayDeque() }.addLast(answer)
    }

    /** Puts a refusal of the Worker, [bytes], ahead for [path]. */
    fun refuseNext(path: String, vararg bytes: Int) = answerNext(path, HttpResult.Answer(200, ByteArray(bytes.size) { bytes[it].toByte() }))

    /** The paths of the requests so far, without the address. */
    fun paths(): List<String> = requests.map { it.url.removePrefix(address).substringBefore('?') }

    override fun send(request: HttpRequest): HttpResult {
        requests += request
        if (unreachable) return HttpResult.NoAnswer
        val pathAndQuery = request.url.removePrefix(address)
        val path = pathAndQuery.substringBefore('?')
        val queued = ahead[path]
        if (!queued.isNullOrEmpty()) queued.removeFirst()?.let { return it }
        val query = pathAndQuery.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate { it.substringBefore('=') to it.substringAfter('=') }
        val body = request.body ?: ByteArray(0)
        if (serverState == ServerState.CLOSED && path != "/v1/info") return done(Bytes().done(), refusal = 6)
        val answer: ByteArray = when (path) {
            "/v1/info" -> Bytes().u8(0).u8(lowest).u8(highest).bytes(serverId.toBytes()).i64(clock.nowMillis + clockOffset).u8(serverState.code)
                .i32(limits.first.toInt()).i32(limits.second.toInt()).i32(limits.third.toInt()).done()
            "/v1/heads" -> {
                val out = Bytes().u8(0).bytes(epoch.toBytes()).bytes(keyId.toBytes()).i64(revision).u8(heads.size)
                heads.forEach { (app, head) -> out.u8(app.length).bytes(app.toByteArray()).i64(head).i64(told[app] ?: 0) }
                out.done()
            }
            "/v1/devices" -> {
                val out = Bytes().u8(0).u16(devices.size)
                devices.forEach { out.bytes(it.id.toBytes()).bytes(it.publicKey).u8(if (it.removed) 2 else 1).i64(it.addedAt).i64(0).u16(it.sealedName.size).bytes(it.sealedName) }
                out.done()
            }
            "/v1/devices/remove" -> {
                devices.filter { it.id == SyncId(body) && !it.removed }.forEach {
                    it.removed = true
                    revision++
                }
                Bytes().u8(0).i64(revision).done()
            }
            "/v1/devices/name" -> {
                revision++
                Bytes().u8(0).i64(revision).done()
            }
            "/v1/enrol-code" -> Bytes().u8(0).bytes("ABCD2345".toByteArray()).i64(clock.nowMillis + 600_000).done()
            "/v1/enrol" -> Bytes().u8(0).bytes(epoch.toBytes()).done()
            "/v1/account/delete" -> {
                serverState = ServerState.CLOSED
                Bytes().u8(0).done()
            }
            "/v1/changes" -> if (request.method == RequestMethod.GET) page(query) else send(query.getValue("app"), body)
            "/v1/files/have" -> {
                val app = query.getValue("app")
                val reader = java.nio.ByteBuffer.wrap(body)
                val count = reader.short.toInt()
                val out = Bytes().u8(0)
                repeat(count) {
                    val file = ByteArray(16).also(reader::get)
                    val hash = ByteArray(32).also(reader::get)
                    var there = 0
                    while ("$app/${hex(file)}/${hex(hash)}/$there" in chunks) there++
                    out.i32(there)
                }
                out.done()
            }
            "/v1/files/send" -> {
                val app = query.getValue("app")
                val reader = java.nio.ByteBuffer.wrap(body)
                val count = reader.short.toInt()
                val table = List(count) {
                    val file = ByteArray(16).also(reader::get)
                    val hash = ByteArray(32).also(reader::get)
                    val number = reader.int
                    val length = reader.int
                    val chunkHash = ByteArray(32).also(reader::get)
                    listOf(file, hash, number, length, chunkHash)
                }
                val out = Bytes().u8(0)
                table.forEach { (file, hash, number, length, chunkHash) ->
                    val bytes = ByteArray(length as Int).also(reader::get)
                    if (sha256(bytes).contentEquals(chunkHash as ByteArray)) {
                        chunks["$app/${hex(file as ByteArray)}/${hex(hash as ByteArray)}/$number"] = bytes
                        out.u8(0)
                    } else {
                        out.u8(1)
                    }
                }
                out.done()
            }
            "/v1/files/fetch" -> {
                val app = query.getValue("app")
                val reader = java.nio.ByteBuffer.wrap(body)
                val count = reader.short.toInt()
                val wanted = List(count) {
                    val file = ByteArray(16).also(reader::get)
                    val hash = ByteArray(32).also(reader::get)
                    chunks["$app/${hex(file)}/${hex(hash)}/${reader.int}"]
                }
                val out = Bytes().u8(0)
                wanted.forEach { if (it == null) out.u8(1) else out.u8(0).i32(it.size) }
                wanted.filterNotNull().forEach { out.bytes(it) }
                out.done()
            }
            "/v1/files/delete" -> {
                val reader = java.nio.ByteBuffer.wrap(body)
                val count = reader.short.toInt()
                val out = Bytes().u8(0)
                repeat(count) {
                    reader.get(ByteArray(16))
                    reader.long
                    out.u8(0)
                }
                out.done()
            }
            else -> Bytes().u8(4).done()
        }
        return HttpResult.Answer(200, answer)
    }

    private fun done(bytes: ByteArray, refusal: Int): HttpResult = HttpResult.Answer(200, byteArrayOf(refusal.toByte()) + bytes)

    private fun page(query: Map<String, String>): ByteArray {
        val app = query.getValue("app")
        if (query.getValue("epoch") != epoch.hex) return Bytes().u8(0x0b).bytes(epoch.toBytes()).done()
        val since = query.getValue("since").toLong()
        val most = query.getValue("most").toInt()
        val above = records[app].orEmpty().filter { it.number > since }.sortedBy { it.number }
        val taken = above.take(most)
        val head = heads[app] ?: 0
        val through = if (above.size > most) taken.last().number else head
        told[app] = maxOf(told[app] ?: 0, through)
        val out = Bytes().u8(0).bytes(epoch.toBytes()).i64(since).i64(through).u8(if (above.size > most) 1 else 0).i32(taken.size)
        taken.forEach { out.bytes(it.id).i64(it.number).i32(it.blob.size).bytes(it.blob) }
        return out.done()
    }

    private fun send(app: String, body: ByteArray): ByteArray {
        val reader = java.nio.ByteBuffer.wrap(body)
        val batchEpoch = SyncId(ByteArray(16).also(reader::get))
        if (batchEpoch != epoch) return Bytes().u8(0x0b).bytes(epoch.toBytes()).done()
        val cursor = reader.long
        reader.long
        reader.get()
        val count = reader.int
        val before = heads[app] ?: 0
        var head = before
        val out = Bytes()
        repeat(count) {
            val recordId = ByteArray(16).also(reader::get)
            val blob = ByteArray(reader.int).also(reader::get)
            val stored = records.getOrPut(app) { mutableListOf() }
            val copy = stored.firstOrNull { it.id.contentEquals(recordId) }
            if (copy != null && copy.number > cursor) {
                out.u8(1)
            } else {
                head++
                if (copy == null) stored += FakeRecord(recordId, head, blob) else copy.apply { number = head; this.blob = blob }
                out.u8(0).i64(head)
            }
        }
        heads[app] = head
        told[app] = maxOf(told[app] ?: 0, head)
        return Bytes().u8(0).bytes(epoch.toBytes()).i64(before).i64(head).i32(count).bytes(out.done()).done()
    }
}

/** A data app in memory, as the Sync app sees it through its courier. */
internal class FakeDataApp(val name: String) {
    val app = CourierApp("app.shkriuss.$name", name.replaceFirstChar { it.uppercase() }, AppName.of(name))
    var on = true
    var canSync = true
    var answers = true
    var epoch: SyncId? = null
    var cursor = 0L
    var known = 0L
    var comparison = ComparisonState.NONE
    val toSend = mutableListOf<Pair<ByteArray, ByteArray>>()
    val comparisonToSend = mutableListOf<Pair<ByteArray, ByteArray>>()
    val taken = mutableListOf<String>()
    var streams = listOf<ListedStream>()
    val stored = mutableMapOf<String, ByteArray>()
    val written = mutableMapOf<String, ByteArrayOutputStream>()
    val sent = mutableListOf<Pair<String, Boolean>>()
    val finished = mutableListOf<String>()
    val deleted = mutableListOf<String>()
    val calls = mutableListOf<String>()
    var dropPages = false
    private var token = 0L
    private var lastBatch: List<Pair<ByteArray, ByteArray>> = emptyList()
    private var lastComparison = false

    fun status(context: CourierContext): SyncStatus {
        if (epoch != context.epoch) {
            epoch = context.epoch
            cursor = 0
            known = 0
        }
        return SyncStatus(
            courierVersion = 1,
            dataVersion = 1,
            isOn = on,
            canSyncNow = canSync,
            epoch = epoch,
            cursor = cursor,
            known = known,
            keyId = KeyId(0x0a0b0c0d),
            comparison = comparison,
            hasOrdinaryChanges = toSend.isNotEmpty(),
            hasComparisonRecords = comparisonToSend.isNotEmpty(),
            hasStreamsToMove = streams.isNotEmpty(),
            wantsFetch = false,
            sendBlock = SendBlock.NONE,
            counts = SyncCounts(0, 0, 0, 0, 0, 0, 0),
        )
    }

    fun export(context: CourierContext, comparison: Boolean, mostRecords: Int, mostBytes: Int): ExportedBatch? {
        status(context)
        val source = if (comparison) comparisonToSend else toSend
        if (source.isEmpty()) return null
        val records = mutableListOf<Pair<ByteArray, ByteArray>>()
        var bytes = 0
        for (record in source) {
            if (records.size >= mostRecords || (records.isNotEmpty() && bytes + record.second.size > mostBytes)) break
            records += record
            bytes += record.second.size
        }
        lastBatch = records
        lastComparison = comparison
        token++
        return ExportedBatch.read(batchBytes(token, epoch!!, cursor, known, comparison, records), mostRecords, mostBytes)
    }

    fun exported(token: Long, answer: ByteArray): ExportedResult {
        if (token != this.token) return ExportedResult.IGNORED
        val read = SendAnswer.read(answer, lastBatch.size) ?: return ExportedResult.IGNORED
        val source = if (lastComparison) comparisonToSend else toSend
        lastBatch.zip(read.outcomes).forEach { (record, outcome) ->
            if (outcome.result.hasNumber) source.removeAll { it.first.contentEquals(record.first) }
        }
        known = maxOf(known, read.headAfter)
        if (read.headBefore == cursor) cursor = read.headAfter
        return ExportedResult.TAKEN
    }

    fun import(page: ByteArray): Imported {
        val read = Page.read(page) ?: return Imported.Dropped
        if (dropPages || read.epoch != epoch || read.since != cursor) return Imported.Dropped
        read.records.forEach { taken += it.id }
        cursor = read.through
        known = maxOf(known, read.through)
        return Imported.Taken(read.records.size, cursor)
    }
}

/** [Couriers] over [FakeDataApp]s. */
internal class FakeCouriers(vararg apps: FakeDataApp) : Couriers {
    val apps = apps.toMutableList()
    var signedOtherwise = listOf<CourierApp>()

    private fun of(app: CourierApp): FakeDataApp = apps.single { it.app == app }

    private fun <T> answer(app: CourierApp, call: String, value: FakeDataApp.() -> T): CourierAnswer<T> {
        val fake = of(app)
        fake.calls += call
        if (!fake.answers) return CourierAnswer.NoAnswer
        if (!fake.on && call != "status") return CourierAnswer.Refused(Refusal.OFF)
        return CourierAnswer.Done(fake.value())
    }

    override fun find(): CourierApps = CourierApps(apps.map { it.app }, signedOtherwise)

    override fun status(app: CourierApp, context: CourierContext) = answer(app, "status") { status(context) }

    override fun compare(app: CourierApp, context: CourierContext) = answer(app, "compare") { comparison = ComparisonState.FETCHING }

    override fun export(app: CourierApp, context: CourierContext, comparison: Boolean, mostRecords: Int, mostBytes: Int) =
        answer(app, "export") { export(context, comparison, mostRecords, mostBytes) }

    override fun exported(app: CourierApp, context: CourierContext, token: Long, answer: ByteArray) = answer(app, "exported") { exported(token, answer) }

    override fun import(app: CourierApp, context: CourierContext, page: ByteArray) = answer(app, "import") { import(page) }

    override fun streams(app: CourierApp, context: CourierContext) = answer(app, "streams") { streams }

    override fun readStream(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<InputStream?> =
        answer(app, "readStream") { stored[hex(fileId)]?.inputStream() }

    override fun streamSent(app: CourierApp, context: CourierContext, fileId: ByteArray, hash: ByteArray, fits: Boolean) =
        answer(app, "streamSent") { sent += hex(fileId) to fits }

    override fun writeStream(app: CourierApp, context: CourierContext, fileId: ByteArray, bytesHere: Long): CourierAnswer<OutputStream?> =
        answer(app, "writeStream") { written.getOrPut(hex(fileId)) { ByteArrayOutputStream() } }

    override fun finishStream(app: CourierApp, context: CourierContext, fileId: ByteArray) =
        answer(app, "finishStream") { finished += hex(fileId); StreamFinish.STORED }

    override fun streamDeleted(app: CourierApp, context: CourierContext, fileId: ByteArray) = answer(app, "streamDeleted") { deleted += hex(fileId) }
}

/** The Sync app's keys, and a data app with a recovery key that signs joins, both on the stand-in for the Keystore. */
internal class TestKeys(folder: File) {
    val sync = SoftwareKeysApp(File(folder, "sync"), AppName.of("sync"))
    val water = SoftwareKeysApp(File(folder, "water"), AppName.of("water"))
    val recoveryKey: RecoveryKey = water.crypto.setup.createRecoveryKey().also { water.crypto.setup.storeDerivedKeys(it) }

    /** The join that Water signs for [request], with the words of its own key. */
    fun sign(request: DeviceJoinRequest, now: Long): SignedJoin = water.crypto.setup.signDeviceWithWords(recoveryKey, request) { now }!!
}

/** A state of a phone that has joined [server], with its device key and name key in [keys]. */
internal fun joinedState(keys: TestKeys, server: FakeServer, clock: TestClock): SyncState {
    val alias = keys.sync.crypto.sync.newDeviceKeyNumber()
    val key = keys.sync.crypto.sync.makeDeviceKey(alias)
    val request = DeviceJoinRequest.of(server.serverId.toBytes(), server.address, key.publicKey)!!
    keys.sync.crypto.sync.storeNameKey(keys.sign(request, clock.nowMillis))
    return SyncState(
        stage = Stage.JOINED,
        address = server.address,
        serverId = server.serverId,
        epoch = server.epoch,
        keyId = server.keyId,
        deviceAlias = alias,
        deviceId = SyncId(key.deviceId.toBytes()),
        name = "Pixel 9 Pro",
        limits = Limits(100, 524_288, 256),
        infoAt = clock.nowMillis,
    )
}
