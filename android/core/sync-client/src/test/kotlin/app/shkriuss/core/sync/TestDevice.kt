package app.shkriuss.core.sync

import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecordKeyIds
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID
import kotlin.random.Random

/** The app name of Lists. */
val LISTS: AppName = AppName.of("lists")

/** An [IdSource] of random UUIDs from a seeded [Random], so a test is the same every time. */
class SeededIds(private val random: Random) : IdSource {
    override fun newId(): String = UUID(random.nextLong(), random.nextLong()).let {
        // The version and variant bits of a random UUID.
        UUID((it.mostSignificantBits and -0xf001L) or 0x4000L, (it.leastSignificantBits and 0x3fffffffffffffffL) or Long.MIN_VALUE)
    }.toString()
}

/**
 * Keys that hold several recovery keys, as an app does after a new
 * recovery key: each recovery key has an app of its own with real keys,
 * [current] names the one that seals, and a blob opens with the one whose
 * key ID it names. The key rotation itself is not built yet, so the tests
 * of "A new recovery key" stand on this.
 */
class ManyKeys(first: ShkCrypto) : SyncKeys {
    private val held = linkedMapOf(first.records.keyIds().current to first)

    /** The key that seals. */
    var current: KeyId = first.records.keyIds().current

    /**
     * When set, an app with no keys: every call fails as when the
     * `record` keyset cannot be used now, for example before the first
     * unlock since the phone started.
     */
    var notNow: ShkCrypto? = null

    /** Adds the keys of another recovery key, as the new primary. */
    fun addAndUse(crypto: ShkCrypto) {
        val id = crypto.records.keyIds().current
        held[id] = crypto
        current = id
    }

    override fun keyIds(): RecordKeyIds = notNow?.records?.keyIds() ?: RecordKeyIds(current, held.keys.toSet())

    override fun seal(recordId: String, plaintext: ByteArray): ByteArray = (notNow ?: held.getValue(current)).records.seal(recordId, plaintext)

    override fun open(recordId: String, blob: ByteArray): ByteArray {
        notNow?.let { return it.records.open(recordId, blob) }
        val named = if (blob.size >= 10) KeyId(ByteBuffer.wrap(blob, 6, 4).int) else null
        return (held[named] ?: held.getValue(current)).records.open(recordId, blob)
    }
}

/**
 * One phone with Lists and its sync, and the Sync app's part for Lists.
 * [root] holds its keys, streams and fetches. Everything is real but the
 * Android Keystore ([SoftwareKeysApp]) and the network ([TestServer]).
 */
class TestDevice(
    val name: String,
    root: File,
    recoveryKey: RecoveryKey,
    /** The server this device has joined. A test may move it to another one. */
    var server: TestServer,
    val clock: TestClock,
    seed: Int,
    dataVersion: Int = 1,
    wipes: Boolean = true,
    /** A device that keeps its database, keys and files from another, as after an update of the app. */
    from: TestDevice? = null,
) {
    val random = Random(seed)
    private val keysApp: SoftwareKeysApp = from?.keysApp ?: SoftwareKeysApp(File(root, "keys"), LISTS).also {
        it.crypto.setup.storeDerivedKeys(recoveryKey)
    }

    /** The keys sync uses. A test may give the device a second recovery key. */
    val keys: ManyKeys = from?.keys ?: ManyKeys(keysApp.crypto)

    val database: ListsDatabase = from?.database ?: inMemoryTestDatabaseBuilder<ListsDatabase>(
        InstrumentationRegistry.getInstrumentation().targetContext,
    ).build()

    private val ids = SeededIds(random)
    val items = RecordWriter(database, database.items(), clock, ids)
    val attachments = RecordWriter(database, database.attachments(), clock, ids)
    val streamFolder = File(root, "streams")
    val content = ListsContent(database, items, attachments, streamFolder, dataVersion, wipes) { keys.current }
    val fetchFolder = File(root, "fetch")
    val client = SyncClient(database, content, keys, clock, fetchFolder)
    /** The device ID of the Sync app here. A test may give it a new one, as when the Sync app joins again. */
    var deviceId: SyncId = from?.deviceId ?: SyncId(random.nextBytes(16))

    /** The Sync app's view: the epoch it last learned. */
    var epoch: SyncId = server.epoch

    fun close() = database.close()

    // What the user does in Lists.

    suspend fun addItem(title: String): ItemEntity = items.create { fields, number -> ItemEntity(fields, number, title, pinned = false) }

    suspend fun editItem(id: String, title: String) = items.update(id) { it.copy(title = title) }

    suspend fun pinItem(id: String) = items.update(id) { it.copy(pinned = true) }

    suspend fun deleteItem(id: String) = items.markDeleted(id)

    suspend fun restoreItem(id: String) = items.restore(id)

    suspend fun wipeItem(id: String) = items.wipe(id) { it.copy(title = "", pinned = false) }

    suspend fun addFile(name: String, bytes: ByteArray): AttachmentEntity {
        val id = attachments.reserveId()
        streamFolder.mkdirs()
        content.streamFile(id).writeBytes(bytes)
        val key = keys.current.value
        val file = attachments.create(id) { fields, number ->
            AttachmentEntity(fields, number, name, bytes.size.toLong(), key, "key-${random.nextInt(1_000_000)}")
        }
        attachments.release(id)
        return file
    }

    suspend fun deleteFile(id: String) = attachments.markDeleted(id)

    suspend fun wipeFile(id: String) = attachments.wipe(id) { it.copy(name = "", size = 0, keyId = null, keyBytes = "") }

    suspend fun sealFileAgain(id: String, keyId: KeyId = keys.current) =
        attachments.sealFileKeyAgain(id) { it.copy(keyId = keyId.value, keyBytes = "key-${random.nextInt(1_000_000)}") }

    /** Seals [record] as this device's Lists would, with the stream part [stream]. */
    internal fun seal(record: SyncRecord, stream: StreamPart? = null, version: Int = content.dataVersion): ByteArray =
        keys.seal(record.id, SealedPlaintext.encode(version, record.entry, stream))

    /** The batch this device's app would give now, sent to the server with [answer] in place of the server's own. */
    suspend fun exportAndAnswer(answer: (batch: ByteArray) -> ByteArray): ExportedResult? {
        val batch = client.export(call(), ExportRequest(false, SyncFormat.MOST_RECORDS, server.mostBytes)) as? ExportResult.Batch ?: return null
        return client.exported(call(), batch.token, answer(batch.bytes))
    }

    /** Wipes every deleted record that is not wiped yet, as an app that wipes does once Undo has ended. */
    suspend fun wipeEveryDeletion() {
        database.items().all().filter { it.record.deletedAt != null }.forEach { wipeItem(it.record.id) }
        database.attachments().all().filter { it.record.deletedAt != null }.forEach { wipeFile(it.record.id) }
    }

    /** Every record, with its fields and content, as sync would seal it: what must be the same on every device. */
    suspend fun records(): List<String> =
        database.items().all().map { "item ${it.record} ${it.title} ${it.pinned}" } +
            database.attachments().all().map { "attachment ${it.record} ${it.name} ${it.size} ${it.keyId} ${it.keyBytes}" }

    /** The streams on this phone, by file ID. */
    fun storedStreams(): Map<String, String> =
        streamFolder.listFiles().orEmpty().associate { it.name to sha256(it.readBytes()) }

    // What the Sync app does for Lists.

    fun call(): CourierCall = CourierCall(SyncFormat.COURIER_VERSION, server.serverId, epoch, deviceId, server.keyId)

    suspend fun status(): SyncStatus = client.status(call())

    /** Every page up to the head, or until the server answers another epoch. Returns the pages. */
    suspend fun fetchAll(most: Int = SyncFormat.MOST_RECORDS, keep: MutableList<ByteArray>? = null): Int {
        var pages = 0
        while (true) {
            val status = status()
            val page = server.fetch(LISTS.value, deviceId, status.cursor, status.known, epoch, most)
            if (page[0].toInt() == 0x0B) {
                epoch = SyncId(page.copyOfRange(1, 17))
                continue
            }
            keep?.add(page)
            pages++
            client.import(call(), page)
            if (page[1 + 16 + 8 + 8].toInt() == 0) return pages
        }
    }

    /**
     * Sends batches of one kind until the app has nothing more, or a batch
     * got a result that ends this run's batches. Returns the results of
     * every batch.
     */
    suspend fun sendAll(comparison: Boolean, most: Int = SyncFormat.MOST_RECORDS): List<Int> {
        val results = mutableListOf<Int>()
        repeat(MOST_BATCHES) {
            val batch = client.export(call(), ExportRequest(comparison, most, server.mostBytes)) as? ExportResult.Batch ?: return results
            val answer = server.send(LISTS.value, deviceId, batch.bytes.copyOfRange(17, batch.bytes.size))
            if (answer[0].toInt() == 0x0B) {
                epoch = SyncId(answer.copyOfRange(1, 17))
                return results
            }
            client.exported(call(), batch.token, answer)
            val codes = resultsOf(answer)
            results += codes
            if (0x01 in codes) fetchAll()
            if (0x05 in codes || 0x02 in codes) return results
        }
        error("A run of batches did not end")
    }

    /** Lists the streams, and does what each one needs. */
    suspend fun moveStreams() {
        val list = ByteArrayOutputStream().also { client.streams(call(), it) }.toByteArray()
        val reader = ByteReader(list, 9)
        while (reader.remaining > 0) {
            val work = reader.u8()
            val fileId = RecordIds.toText(reader.bytes(16))
            val hash = Hex.of(reader.bytes(32))
            reader.i64() // The length: the server's bytes are taken as they are, and the app checks them.
            val here = reader.i64()
            val number = reader.i64()
            when (work) {
                StreamWork.SEND.code -> {
                    if (!server.has(fileId, hash)) {
                        val bytes = client.readStream(call(), fileId)?.use { it.readBytes() } ?: continue
                        if (sha256(bytes) != hash) {
                            client.streamSent(call(), fileId, Hex.parse(hash)!!, fits = false)
                            continue
                        }
                        server.sendStream(fileId, hash, bytes)
                    }
                    client.streamSent(call(), fileId, Hex.parse(hash)!!, fits = true)
                }
                StreamWork.FETCH.code -> {
                    val bytes = server.fetchStream(fileId, hash) ?: continue
                    val out = client.writeStream(call(), fileId, here) ?: continue
                    out.use { it.write(bytes, here.toInt(), bytes.size - here.toInt()) }
                    client.finishStream(call(), fileId)
                }
                StreamWork.DELETE.code -> {
                    val answer = server.deleteStream(LISTS.value, fileId, number)
                    if (answer != 2) client.streamDeleted(call(), fileId)
                }
            }
        }
    }

    /** One run of the Sync app for Lists, in the order of "When the Sync app runs", point 3. */
    suspend fun run() {
        fetchAll()
        sendAll(comparison = false)
        moveStreams()
        sendAll(comparison = false)
        sendAll(comparison = true)
    }

    /**
     * Runs until a run changes nothing more on this device, and the app's
     * status asks for nothing more: no comparison, no last fetch, no stream.
     */
    suspend fun runUntilQuiet() {
        repeat(MOST_RUNS) {
            val before = server.stored.size to records()
            run()
            val status = status()
            val asksForMore = status.hasStreamsToMove || status.wantsFetch || status.comparison != ComparisonState.NONE
            if (server.stored.size == before.first && records() == before.second && !asksForMore) return
        }
        error("$name did not become quiet")
    }

    private fun resultsOf(answer: ByteArray): List<Int> {
        val reader = ByteReader(answer, 1 + 16 + 8 + 8)
        return List(reader.u32().toInt()) {
            val code = reader.u8()
            if (code == 0 || code == 4) reader.i64()
            code
        }
    }

    companion object {
        const val MOST_BATCHES = 10_000
        const val MOST_RUNS = 20

        fun sha256(bytes: ByteArray): String = Hex.of(MessageDigest.getInstance("SHA-256").digest(bytes))

        /** The fields a record gets when a test makes one by hand. */
        fun fields(id: String, at: Long, deletedAt: Long? = null) = RecordFields(id, createdAt = at, updatedAt = at, deletedAt = deletedAt)
    }
}
