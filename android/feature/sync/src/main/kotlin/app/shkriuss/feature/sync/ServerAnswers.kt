package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.sync.Page
import app.shkriuss.core.sync.SendAnswer
import app.shkriuss.core.sync.SyncId
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream

/**
 * One answer of the server to one call (docs/architecture/sync-protocol.md,
 * "Answers"): [Done] with what the call gives, one of the refusals of the
 * Worker, or one of the answers that did not come from the Worker.
 */
sealed interface ServerAnswer<out T> {
    /** `00`, and what the call gives. */
    data class Done<T>(val value: T) : ServerAnswer<T>

    /** `01`: the lowest and the highest version the server speaks. */
    data class Version(val lowest: Int, val highest: Int) : ServerAnswer<Nothing>

    /** `02`: not a device of this server. */
    data object NotADevice : ServerAnswer<Nothing>

    /** `03`: this device was removed. */
    data object Removed : ServerAnswer<Nothing>

    /** `04`, twice: the request does not check. */
    data object DoesNotCheck : ServerAnswer<Nothing>

    /** `05`: the server's clock. */
    data class Clock(val serverTime: Long) : ServerAnswer<Nothing>

    /** `06`: the server was closed. */
    data object Closed : ServerAnswer<Nothing>

    /** `07`: the day's writes are used, only for a comparison of everything, or for all. */
    data class DayLimit(val comparisonsOnly: Boolean) : ServerAnswer<Nothing>

    /** `08`: the server is full. */
    data object Full : ServerAnswer<Nothing>

    /** `09`: the code is wrong, used or too old. */
    data object WrongCode : ServerAnswer<Nothing>

    /** `0A`: the statement is not of this account. The current key ID. */
    data class OtherAccount(val keyId: KeyId) : ServerAnswer<Nothing>

    /** `0B`: another epoch. */
    data class OtherEpoch(val epoch: SyncId) : ServerAnswer<Nothing>

    /** `0C`: too much in one request. */
    data object TooMuch : ServerAnswer<Nothing>

    /** Not from the Worker: Cloudflare says that the day's requests are used. */
    data object DayRequestsUsed : ServerAnswer<Nothing>

    /** Not from the Worker: Cloudflare says that the request ran out of CPU time. */
    data object OutOfCpuTime : ServerAnswer<Nothing>

    /** No connection, no such host, a failed handshake, or no whole answer. */
    data object Unreachable : ServerAnswer<Nothing>

    /** An answer with another HTTP status, a redirect among them: it is not the Worker's. */
    data object NotTheWorker : ServerAnswer<Nothing>

    /** The server's certificate is not one this phone trusts. */
    data object UntrustedCertificate : ServerAnswer<Nothing>

    /** An answer of the Worker whose bytes break the layout of its call, or a limit. */
    data object Broken : ServerAnswer<Nothing>
}

/** What `info` gives. */
data class ServerInfo(
    val lowest: Int,
    val highest: Int,
    val serverId: SyncId,
    val clock: Long,
    val state: ServerState,
    /** The three limits, each taken as the nearest bound if it is outside. */
    val limits: Limits,
) {
    /** True if the server speaks version 1 of its interface. */
    val speaksVersion1: Boolean get() = VERSION in lowest..highest

    companion object {
        /** The version of the server interface this code speaks. */
        const val VERSION: Int = 1
    }
}

/** Whether a server holds an account: byte 27 of `info`. */
enum class ServerState(internal val code: Int) {
    NO_ACCOUNT(0),
    IN_USE(1),
    CLOSED(2),
}

/** A new device code and the time it ends, by the server's clock. */
data class DeviceCode(val code: String, val endsAt: Long) {
    override fun toString(): String = "DeviceCode"
}

/** One device of the list (docs/architecture/sync-protocol.md, `devices`). Nothing here is secret. */
class ListedDevice(
    val id: SyncId,
    val publicKey: ByteArray,
    val removed: Boolean,
    val addedAt: Long,
    /** The first millisecond of the UTC day it was last seen. */
    val seenDay: Long,
    val sealedName: ByteArray,
) {
    override fun toString(): String = "ListedDevice(${id.hex}, removed $removed)"
}

/** One app that `heads` names: its head, and the highest number the server told this device for it. */
data class AppHead(val head: Long, val told: Long)

/** What `heads` gives. */
data class Heads(val epoch: SyncId, val keyId: KeyId, val revision: Long, val apps: Map<String, AppHead>) {
    /** The head of [app]: an app the answer does not name has the head 0, and the server told this device 0. */
    fun of(app: String): AppHead = apps[app] ?: AppHead(0, 0)
}

/** A page as the server answered a fetch: its bytes, which go to `import` as they are, and what the Sync app reads from them. */
class FetchedPage(val bytes: ByteArray, val page: Page) {
    override fun toString(): String = "FetchedPage(${page.records.size} records)"
}

/** The server's answer `00` to a batch: its bytes, which go to `exported` as they are, and what the Sync app reads from them. */
class SentBatch(val bytes: ByteArray, val answer: SendAnswer) {
    override fun toString(): String = "SentBatch"
}

/** What `files/delete` answered for one file. */
enum class DeleteResult {
    DELETED,
    NOT_DELETED,
    NOT_NOW,
}

/** The bytes of the bodies of the calls, and the reading of their answers, without any network. */
internal object ServerLayouts {
    const val DONE = 0x00
    const val KEY_ID_BYTES = 4
    const val ID_BYTES = 16
    const val HASH_BYTES = 32
    const val PUBLIC_KEY_BYTES = 65
    const val SHORTEST_SEALED_NAME = 52
    const val LONGEST_SEALED_NAME = 211
    const val MOST_DEVICES = 1_000
    const val DEVICE_CODE_LENGTH = 8

    /**
     * The answer in [bytes], read with [done] after the byte `00`. A
     * refusal is read with its own layout. Anything that breaks a layout
     * is [ServerAnswer.Broken].
     */
    fun <T> answer(bytes: ByteArray, done: (Reader) -> T?): ServerAnswer<T> {
        if (bytes.isEmpty()) return ServerAnswer.Broken
        val reader = Reader(bytes, 1)
        return try {
            val answer: ServerAnswer<T> = when (bytes[0].toInt() and 0xff) {
                DONE -> done(reader)?.let { ServerAnswer.Done(it) } ?: ServerAnswer.Broken
                // The lowest version is never above the highest.
                0x01 -> ServerAnswer.Version(reader.u8(), reader.u8()).takeIf { it.lowest <= it.highest } ?: return ServerAnswer.Broken
                0x02 -> ServerAnswer.NotADevice
                0x03 -> ServerAnswer.Removed
                0x04 -> ServerAnswer.DoesNotCheck
                0x05 -> ServerAnswer.Clock(reader.i64().also { if (!isTime(it)) return ServerAnswer.Broken })
                0x06 -> ServerAnswer.Closed
                0x07 -> when (reader.u8()) {
                    1 -> ServerAnswer.DayLimit(comparisonsOnly = true)
                    2 -> ServerAnswer.DayLimit(comparisonsOnly = false)
                    else -> return ServerAnswer.Broken
                }
                0x08 -> ServerAnswer.Full
                0x09 -> ServerAnswer.WrongCode
                0x0A -> ServerAnswer.OtherAccount(KeyId(reader.i32()))
                0x0B -> ServerAnswer.OtherEpoch(SyncId(reader.bytes(ID_BYTES)))
                0x0C -> ServerAnswer.TooMuch
                else -> return ServerAnswer.Broken
            }
            if (reader.remaining != 0) ServerAnswer.Broken else answer
        } catch (_: BrokenLayout) {
            ServerAnswer.Broken
        }
    }

    fun info(reader: Reader): ServerInfo? {
        val lowest = reader.u8()
        val highest = reader.u8()
        if (lowest > highest) return null
        val serverId = SyncId(reader.bytes(ID_BYTES))
        val clock = reader.i64()
        if (!isTime(clock)) return null
        val state = reader.u8().let { code -> ServerState.entries.firstOrNull { it.code == code } } ?: return null
        val limits = Limits.nearest(reader.u32(), reader.u32(), reader.u32())
        return ServerInfo(lowest, highest, serverId, clock, state, limits)
    }

    fun enrolBody(codeKind: CodeKind, code: String, statement: ByteArray, signature: ByteArray, accountKey: ByteArray, sealedName: ByteArray): ByteArray {
        val codeBytes = code.toByteArray(Charsets.US_ASCII)
        require(codeBytes.size in 1..255 && statement.size <= 0xffff) { "A code or a statement too long for the layout" }
        require(sealedName.size in SHORTEST_SEALED_NAME..LONGEST_SEALED_NAME) { "A sealed name is 52 to 211 bytes" }
        return Writer()
            .u8(codeKind.code)
            .u8(codeBytes.size)
            .bytes(codeBytes)
            .u16(statement.size)
            .bytes(statement)
            .bytes(signature)
            .bytes(accountKey)
            .u16(sealedName.size)
            .bytes(sealedName)
            .done()
    }

    fun epoch(reader: Reader): SyncId = SyncId(reader.bytes(ID_BYTES))

    fun deviceCode(reader: Reader): DeviceCode? {
        val code = String(reader.bytes(DEVICE_CODE_LENGTH), Charsets.US_ASCII)
        if (!code.all { it in SyncState.CODE_ALPHABET }) return null
        return DeviceCode(code, reader.i64().takeIf(::isTime) ?: return null)
    }

    fun devices(reader: Reader): List<ListedDevice>? {
        val count = reader.u16()
        if (count > MOST_DEVICES) return null
        val devices = List(count) {
            val id = SyncId(reader.bytes(ID_BYTES))
            val key = reader.bytes(PUBLIC_KEY_BYTES)
            val removed = when (reader.u8()) {
                1 -> false
                2 -> true
                else -> return null
            }
            val added = reader.i64()
            val seen = reader.i64()
            // Both are times; the day seen is the first millisecond of a UTC day.
            if (!isTime(added) || !isTime(seen) || seen % SyncRun.DAY_MILLIS != 0L) return null
            val nameLength = reader.u16()
            if (nameLength !in SHORTEST_SEALED_NAME..LONGEST_SEALED_NAME) return null
            ListedDevice(id, key, removed, added, seen, reader.bytes(nameLength))
        }
        return devices.takeIf { list -> list.map { it.id }.distinct().size == list.size }
    }

    fun revision(reader: Reader): Long? = reader.i64().takeIf { it >= 0 }

    fun sealedNameBody(sealedName: ByteArray): ByteArray {
        require(sealedName.size in SHORTEST_SEALED_NAME..LONGEST_SEALED_NAME) { "A sealed name is 52 to 211 bytes" }
        return Writer().u16(sealedName.size).bytes(sealedName).done()
    }

    fun heads(reader: Reader): Heads? {
        val epoch = SyncId(reader.bytes(ID_BYTES))
        val keyId = KeyId(reader.i32())
        val revision = reader.i64()
        if (revision < 0) return null
        val apps = mutableMapOf<String, AppHead>()
        repeat(reader.u8()) {
            val name = String(reader.bytes(reader.u8()), Charsets.US_ASCII)
            if (!SyncState.APP_NAME.matches(name) || name in apps) return null
            val head = reader.i64()
            val told = reader.i64()
            if (head < 0 || told < 0) return null
            apps[name] = AppHead(head, told)
        }
        return Heads(epoch, keyId, revision, apps)
    }

    fun fileResults(reader: Reader, count: Int): List<Int>? = List(count) { reader.u8() }

    fun filesSendBody(chunks: List<OutgoingChunk>): Pair<ByteArray, ByteArray> {
        val head = Writer().u16(chunks.size)
        chunks.forEach { head.bytes(it.fileId).bytes(it.streamHash).i32(it.number).i32(it.bytes.size).bytes(it.hash) }
        val signed = head.done()
        val all = ByteArrayOutputStream(signed.size + chunks.sumOf { it.bytes.size })
        all.write(signed)
        chunks.forEach { all.write(it.bytes) }
        return signed to all.toByteArray()
    }

    fun filesHaveBody(streams: List<StreamRef>): ByteArray {
        val writer = Writer().u16(streams.size)
        streams.forEach { writer.bytes(it.fileId).bytes(it.hash) }
        return writer.done()
    }

    fun filesFetchBody(chunks: List<ChunkRef>): ByteArray {
        val writer = Writer().u16(chunks.size)
        chunks.forEach { writer.bytes(it.fileId).bytes(it.streamHash).i32(it.number) }
        return writer.done()
    }

    /** The chunks of a `files/fetch` answer: the bytes of each one that is here, null for one that is not. Each must have the length asked for. */
    fun fetchedChunks(reader: Reader, chunks: List<ChunkRef>): List<ByteArray?>? {
        val lengths = chunks.map {
            when (reader.u8()) {
                0 -> reader.u32().also { length -> if (length != it.length.toLong()) return null }
                1 -> null
                else -> return null
            }
        }
        return lengths.map { length -> length?.let { reader.bytes(it.toInt()) } }
    }

    fun filesDeleteBody(files: List<Pair<ByteArray, Long>>): ByteArray {
        val writer = Writer().u16(files.size)
        files.forEach { (id, number) -> writer.bytes(id).i64(number) }
        return writer.done()
    }

    /** The page of a fetch: the whole answer, which [Page.read] reads from its byte `00` on. */
    fun page(bytes: ByteArray): ServerAnswer<FetchedPage> {
        if (bytes.isNotEmpty() && bytes[0].toInt() == DONE) {
            // A cut page ends at its last record: Through is that record's number (sync-protocol.md, "Fetch", point 2).
            return Page.read(bytes)?.takeIf { !it.more || it.records.lastOrNull()?.number == it.through }
                ?.let { ServerAnswer.Done(FetchedPage(bytes, it)) } ?: ServerAnswer.Broken
        }
        return answer(bytes) { null }
    }

    /** The answer to a batch of [count] records: the whole answer, which [SendAnswer.read] reads from its byte `00` on. */
    fun sent(bytes: ByteArray, count: Int): ServerAnswer<SentBatch> {
        if (bytes.isNotEmpty() && bytes[0].toInt() == DONE) {
            // The head after is the number of the last record stored, or the head before when none was ("Send", point 3).
            return SendAnswer.read(bytes, count)
                ?.takeIf { answer -> answer.headAfter == (answer.outcomes.lastOrNull { it.result.hasNumber }?.number ?: answer.headBefore) }
                ?.let { ServerAnswer.Done(SentBatch(bytes, it)) } ?: ServerAnswer.Broken
        }
        return answer(bytes) { null }
    }

    /** Thrown where an answer ends early. */
    class BrokenLayout : Exception("The answer breaks its layout")

    /** Reads big-endian numbers from [bytes], from [position] on. */
    class Reader(private val bytes: ByteArray, private var position: Int) {
        val remaining: Int get() = bytes.size - position

        fun u8(): Int {
            need(1)
            return bytes[position++].toInt() and 0xff
        }

        fun u16(): Int = (u8() shl 8) or u8()

        fun u32(): Long = (u16().toLong() shl 16) or u16().toLong()

        fun i32(): Int = u32().toInt()

        fun i64(): Long = (u32() shl 32) or u32()

        fun bytes(count: Int): ByteArray {
            need(count)
            return bytes.copyOfRange(position, position + count).also { position += count }
        }

        private fun need(count: Int) {
            if (count < 0 || remaining < count) throw BrokenLayout()
        }
    }

    /** Writes big-endian numbers. */
    class Writer {
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
}

/** One chunk to send: its file ID, its stream's hash, its number, its bytes and their SHA-256. */
class OutgoingChunk(val fileId: ByteArray, val streamHash: ByteArray, val number: Int, val bytes: ByteArray, val hash: ByteArray) {
    override fun toString(): String = "OutgoingChunk($number)"
}

/** One stream, by its file ID and its hash. */
class StreamRef(val fileId: ByteArray, val hash: ByteArray)

/** One chunk to fetch, by its stream and its number, with the length it must have. */
class ChunkRef(val fileId: ByteArray, val streamHash: ByteArray, val number: Int, val length: Int)
