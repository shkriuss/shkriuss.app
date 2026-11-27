package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import java.nio.ByteBuffer
import kotlin.random.Random

/**
 * A sync server in memory for the tests, with the rules of
 * docs/architecture/sync-protocol.md for fetch, send and the four file
 * calls. It is honest unless a test makes it do otherwise.
 */
class TestServer(var keyId: KeyId, private val random: Random = Random(1)) {
    val serverId = SyncId(random.nextBytes(16))
    var epoch = SyncId(random.nextBytes(16))
        private set

    /** The byte limit that `info` names for a batch or a page. */
    var mostBytes = SyncFormat.MOST_PAGE_BYTES

    /** How a record's chunks stand ("`files/delete`", point 2). */
    enum class Mark { NONE, BEING_DELETED, DELETED }

    /** The server's copy of one record. */
    data class Copy(val number: Long, val blob: ByteArray, val mark: Mark = Mark.NONE)

    private class AppState {
        val records = LinkedHashMap<String, Copy>()
        var head = 0L
        val told = mutableMapOf<SyncId, Long>()

        fun copy(): AppState = AppState().also {
            it.records.putAll(records)
            it.head = head
            it.told.putAll(told)
        }
    }

    private var apps = mutableMapOf<String, AppState>()

    /** Whole streams, by file ID and hash. The tests do not need chunks of their own. */
    val streams = mutableMapOf<Pair<String, String>, ByteArray>()

    /** Every batch the server took, as the records it stored, for the tests that count what went. */
    val stored = mutableListOf<String>()

    fun head(app: String): Long = apps[app]?.head ?: 0

    fun told(app: String, device: SyncId): Long = apps[app]?.told?.get(device) ?: 0

    fun copyOf(app: String, id: String): Copy? = apps[app]?.records?.get(id)

    fun ids(app: String): Set<String> = apps[app]?.records?.keys?.toSet().orEmpty()

    /** Sets the mark of a record's chunks by hand, for the tests of a deletion that is under way. */
    fun mark(app: String, id: String, mark: Mark) {
        val state = apps.getValue(app)
        state.records[id] = state.records.getValue(id).copy(mark = mark)
    }

    /** What the server holds now, to put it back later as a user who restores the database. */
    fun snapshot(): Map<String, Any> = apps.mapValues { it.value.copy() }

    /** Puts the database back to [snapshot]. The epoch stays: a database put back does not know it was. */
    @Suppress("UNCHECKED_CAST")
    fun putBack(snapshot: Map<String, Any>) {
        apps = (snapshot as Map<String, AppState>).mapValues { it.value.copy() }.toMutableMap()
    }

    /** A new epoch, as the server makes when a device knows more than it does. */
    fun newEpoch() {
        epoch = SyncId(random.nextBytes(16))
        apps.values.forEach { it.told.clear() }
    }

    /** `GET /v1/changes`. */
    fun fetch(app: String, device: SyncId, since: Long, known: Long, epoch: SyncId, most: Int): ByteArray {
        val state = apps.getOrPut(app) { AppState() }
        if (epoch != this.epoch) return byteArrayOf(0x0B) + this.epoch.toBytes()
        if (known > (state.told[device] ?: 0)) {
            newEpoch()
            return byteArrayOf(0x0B) + this.epoch.toBytes()
        }
        val above = state.records.entries.filter { it.value.number > since }.sortedBy { it.value.number }
        val page = mutableListOf<Map.Entry<String, Copy>>()
        var total = 0L
        for (entry in above) {
            if (page.size >= most) break
            if (page.isNotEmpty() && total + entry.value.blob.size > mostBytes) break
            page += entry
            total += entry.value.blob.size
        }
        val more = page.size < above.size
        val through = if (more) page.last().value.number else state.head
        state.told[device] = maxOf(state.told[device] ?: 0, through)
        val writer = ByteWriter().u8(0).bytes(this.epoch.toBytes()).i64(since).i64(through).u8(if (more) 1 else 0).i32(page.size)
        page.forEach { writer.bytes(RecordIds.toBytes(it.key)).i64(it.value.number).i32(it.value.blob.size).bytes(it.value.blob) }
        return writer.toByteArray()
    }

    /** `POST /v1/changes`, with a batch without its first 17 bytes. */
    fun send(app: String, device: SyncId, body: ByteArray): ByteArray {
        val state = apps.getOrPut(app) { AppState() }
        val reader = ByteReader(body)
        val epoch = SyncId(reader.bytes(16))
        val cursor = reader.i64()
        val known = reader.i64()
        reader.u8()
        val count = reader.u32().toInt()
        if (epoch != this.epoch) return byteArrayOf(0x0B) + this.epoch.toBytes()
        if (known > (state.told[device] ?: 0)) {
            newEpoch()
            return byteArrayOf(0x0B) + this.epoch.toBytes()
        }
        val before = state.head
        val results = ByteWriter()
        repeat(count) {
            val id = RecordIds.toText(reader.bytes(16))
            val blob = reader.bytes(reader.u32().toInt())
            val copy = state.records[id]
            when {
                blob.size !in SyncFormat.SMALLEST_SEALED..SyncFormat.LARGEST_SEALED || !blob.copyOf(6).contentEquals(SEALED_START) ->
                    results.u8(0x03)
                KeyId(ByteBuffer.wrap(blob, 6, 4).int) != keyId -> results.u8(0x02)
                copy != null && copy.number > cursor -> results.u8(0x01)
                copy?.mark == Mark.BEING_DELETED -> results.u8(0x05)
                else -> {
                    state.head++
                    state.records[id] = Copy(state.head, blob)
                    stored += id
                    results.u8(if (copy?.mark == Mark.DELETED) 0x04 else 0x00).i64(state.head)
                }
            }
        }
        reader.end()
        state.told[device] = maxOf(state.told[device] ?: 0, state.head)
        return ByteWriter().u8(0).bytes(this.epoch.toBytes()).i64(before).i64(state.head).i32(count).bytes(results.toByteArray()).toByteArray()
    }

    /** `files/have`, for one whole stream. */
    fun has(fileId: String, hash: String): Boolean = (fileId to hash) in streams

    /** `files/send`, for one whole stream. */
    fun sendStream(fileId: String, hash: String, bytes: ByteArray) {
        streams[fileId to hash] = bytes
    }

    /** `files/fetch`, for one whole stream. */
    fun fetchStream(fileId: String, hash: String): ByteArray? = streams[fileId to hash]

    /** `files/delete`: 0 deleted, 1 not deleted, 2 not now. */
    fun deleteStream(app: String, fileId: String, number: Long): Int {
        val state = apps.getValue(app)
        val copy = state.records[fileId] ?: return 1
        if (copy.number != number) return 1
        if (copy.mark == Mark.BEING_DELETED) return 2
        streams.keys.removeAll { it.first == fileId }
        state.records[fileId] = copy.copy(mark = Mark.DELETED)
        return 0
    }

    private companion object {
        /** `SHK`, version 1, kind 1, Tink's prefix version 1. */
        val SEALED_START = byteArrayOf(0x53, 0x48, 0x4B, 0x01, 0x01, 0x01)
    }
}
