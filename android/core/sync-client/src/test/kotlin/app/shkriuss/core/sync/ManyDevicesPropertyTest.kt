package app.shkriuss.core.sync

import kotlin.random.Random
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Property tests (docs/architecture/sync-protocol.md, "What the tests must
 * cover", `core/sync-client` point 1, and points 3 and 4 for stops): three
 * devices make many random edits, deletions, wipes and new seals of file
 * keys, often at the same millisecond, while their runs stop at random
 * points, pages come twice or late, batches lose their answer, the user
 * asks for comparisons, and the server is put back to an earlier day. Once
 * every device has run to the end, every device holds the same records,
 * and one more run sends nothing. The histories run in an app that wipes,
 * as Notes, and in one that does not, as Water, Reminders and Tasks.
 *
 * Each seed is one history. A failure names its seed, which repeats it.
 */
@RunWith(RobolectricTestRunner::class)
class ManyDevicesPropertyTest : SyncTest() {
    @Test
    fun everyDeviceEndsWithTheSameRecords() = runBlocking {
        SEEDS.forEach { seed -> history(seed, wipes = true) }
    }

    @Test
    fun everyDeviceEndsWithTheSameRecordsAlsoInAnAppThatDoesNotWipe() = runBlocking {
        SEEDS.forEach { seed -> history(seed, wipes = false) }
    }

    private suspend fun history(seed: Int, wipes: Boolean) {
        val random = Random(seed)
        newServer()
        val devices = List(3) { device("d$seed-$it", wipes = wipes, seed = seed * 10 + it) }
        val oldPages = mutableListOf<ByteArray>()
        var snapshot: Map<String, Any>? = null

        repeat(STEPS) {
            val device = devices[random.nextInt(devices.size)]
            when (random.nextInt(100)) {
                in 0..49 -> edit(device, random, wipes)
                in 50..79 -> disruptedRun(device, random, oldPages)
                in 80..89 -> clock.advanceBy(random.nextLong(0, 3) * random.nextLong(0, 1_500))
                in 90..92 -> device.client.compare(device.call())
                in 93..95 -> oldPages.randomOrNull(random)?.let { device.client.import(device.call(), it) }
                in 96..97 -> snapshot = server.snapshot()
                else -> snapshot?.let(server::putBack)
            }
        }

        // The end: in an app that wipes, Undo ends, so every deletion is wiped. A deleted record that is not wiped is held
        // back. Then every device runs until nothing changes, three times round, as phones do over the next hours.
        if (wipes) devices.forEach { it.wipeEveryDeletion() }
        repeat(3) { devices.forEach { it.runUntilQuiet() } }

        val expected = devices.first().records()
        devices.forEach { assertEquals("seed $seed, ${it.name}", expected, it.records()) }
        val stored = server.stored.size
        devices.forEach { it.run() }
        assertEquals("seed $seed: one more run sends nothing", stored, server.stored.size)
        devices.forEach { checkStreams(seed, it, devices.first()) }
    }

    /** Every file that is not deleted has its stream on every device, the same bytes. */
    private suspend fun checkStreams(seed: Int, device: TestDevice, first: TestDevice) {
        val live = device.database.attachments().all().filter { it.record.deletedAt == null }
        val streams = device.storedStreams()
        val expected = first.storedStreams()
        live.forEach { file ->
            assertTrue("seed $seed, ${device.name}: the stream of a file is here", file.record.id in streams)
            assertEquals("seed $seed, ${device.name}: the same bytes", expected[file.record.id], streams[file.record.id])
        }
    }

    /** One random edit. An app that does not wipe has no wipes, and its Undo works for as long as a record is deleted. */
    private suspend fun edit(device: TestDevice, random: Random, wipes: Boolean) {
        val items = device.database.items().all()
        val files = device.database.attachments().all()
        val item = items.randomOrNull(random)
        val file = files.randomOrNull(random)
        when (random.nextInt(11)) {
            0, 1 -> device.addItem("Item ${random.nextInt(1_000)}")
            2, 3 -> item?.let { device.editItem(it.record.id, "Edit ${random.nextInt(1_000)}") }
            4 -> item?.let { device.deleteItem(it.record.id) }
            // Undo, while the item is deleted and not wiped.
            5 -> item?.takeIf { it.record.deletedAt != null && it.title.isNotEmpty() }?.let { device.restoreItem(it.record.id) }
            6 -> if (wipes) item?.let { device.wipeItem(it.record.id) }
            7 -> device.addFile("file ${random.nextInt(1_000)}", random.nextBytes(random.nextInt(1, 3_000)))
            8 -> file?.let { device.deleteFile(it.record.id) }
            9 -> if (wipes) file?.let { device.wipeFile(it.record.id) }
            else -> file?.takeIf { it.keyId != null }?.let { device.sealFileAgain(it.record.id) }
        }
    }

    /**
     * A run of the Sync app that may stop after any call, with small pages
     * and batches so that a run takes many calls. A batch may lose its
     * answer: the Sync app stopped between the batch and its `exported`.
     */
    private suspend fun disruptedRun(device: TestDevice, random: Random, oldPages: MutableList<ByteArray>) {
        val most = random.nextInt(1, 6)
        val stopAfter = random.nextInt(1, 40)
        var calls = 0
        fun more(): Boolean = ++calls < stopAfter

        // Fetch.
        while (more()) {
            val status = device.status()
            val page = server.fetch(LISTS.value, device.deviceId, status.cursor, status.known, device.epoch, most)
            if (page[0].toInt() == 0x0B) {
                device.epoch = SyncId(page.copyOfRange(1, 17))
                continue
            }
            if (oldPages.size < 50) oldPages += page else oldPages[random.nextInt(oldPages.size)] = page
            device.client.import(device.call(), page)
            if (random.nextInt(10) == 0) device.client.import(device.call(), page)
            if (page[1 + 16 + 8 + 8].toInt() == 0) break
        }
        // Ordinary batches, streams, then the batches of a comparison.
        for (comparison in listOf(false, true)) {
            while (more()) {
                val batch = device.client.export(device.call(), ExportRequest(comparison, most, server.mostBytes)) as? ExportResult.Batch ?: break
                val answer = server.send(LISTS.value, device.deviceId, batch.bytes.copyOfRange(17, batch.bytes.size))
                if (answer[0].toInt() == 0x0B) {
                    device.epoch = SyncId(answer.copyOfRange(1, 17))
                    break
                }
                if (random.nextInt(8) == 0) continue
                device.client.exported(device.call(), batch.token, answer)
            }
            if (!comparison && more()) device.moveStreams()
        }
    }

    private companion object {
        val SEEDS = 1..30
        const val STEPS = 160
    }
}
