package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.nio.ByteBuffer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * A new recovery key (docs/architecture/sync-protocol.md, "A new recovery
 * key", and "What the tests must cover", `core/sync-client` point 9): P,
 * the app's current key, S, the key it syncs with, and C, the server's,
 * in every combination. S never moves to an older key.
 */
@RunWith(RobolectricTestRunner::class)
class NewRecoveryKeyTest : SyncTest() {
    private val newKey: RecoveryKey by lazy { SoftwareKeysApp(temporary.newFolder(), LISTS).crypto.setup.createRecoveryKey() }
    private val oldKeyId: KeyId get() = server.keyId

    private fun newKeys(): ShkCrypto = SoftwareKeysApp(temporary.newFolder(), LISTS).crypto.also { it.setup.storeDerivedKeys(newKey) }

    private fun keyIdsOnTheServer(): Set<KeyId> =
        server.ids(LISTS.value).map { KeyId(ByteBuffer.wrap(server.copyOf(LISTS.value, it)!!.blob, 6, 4).int) }.toSet()

    @Test
    fun withTheNewKeyBeforeTheServerTookItTheAppWaitsAndStillTakesWhatIsSealedWithS() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        phone.keys.addAndUse(newKeys())

        val status = phone.status()
        assertEquals(SendBlock.WAITS_FOR_THE_SERVER, status.sendBlock)
        phone.addItem("Milk")
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)))

        val bread = tablet.addItem("Bread")
        tablet.runUntilQuiet()
        phone.fetchAll()
        assertEquals("Bread", phone.database.items().find(bread.record.id)?.title)
    }

    @Test
    fun onceTheServerTookItTheAppFetchesOnceMoreThenSyncsWithItAndSealsEverythingAgain() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        tablet.addItem("Bread")
        tablet.addFile("photo.jpg", ByteArray(800) { 4 })
        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        val newKeys = newKeys()
        phone.keys.addAndUse(newKeys)
        val newKeyId = phone.keys.current

        // The server takes the statement: C is the new key.
        server.keyId = newKeyId
        val waiting = phone.status()
        assertTrue("one last fetch", waiting.wantsFetch)
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)))

        phone.runUntilQuiet()
        assertFalse(phone.status().wantsFetch)
        assertEquals("every record is sealed with the new key", setOf(newKeyId), keyIdsOnTheServer())
        assertTrue("the file keys were sealed again", phone.database.attachments().all().all { it.keyId == newKeyId.value })

        // A device that has only the new words can open all of it.
        val laptop = device("laptop", key = newKey)
        laptop.runUntilQuiet()
        assertEquals(phone.records(), laptop.records())
        assertEquals(phone.storedStreams(), laptop.storedStreams())
    }

    @Test
    fun aStopBeforeTheFileKeysAreSealedAgainIsFinishedAtTheNextImport() = runBlocking {
        val phone = device("phone")
        phone.addFile("photo.jpg", ByteArray(800) { 4 })
        phone.runUntilQuiet()
        phone.keys.addAndUse(newKeys())
        server.keyId = phone.keys.current

        phone.content.stopNextSeal = true
        try {
            phone.fetchAll()
        } catch (_: IllegalStateException) {
            // Expected: the app stopped after the switch, before it sealed its file keys again.
        }
        assertTrue("not sealed yet", phone.database.attachments().all().all { it.keyId != server.keyId.value })

        phone.runUntilQuiet()
        assertTrue(phone.database.attachments().all().all { it.keyId == server.keyId.value })
        assertEquals(setOf(server.keyId), keyIdsOnTheServer())
    }

    @Test
    fun anAppThatDoesNotHoldTheServersKeyAsksForItSendsNothingAndCatchesUpOnceItHasIt() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        tablet.addItem("Bread")
        tablet.runUntilQuiet()
        phone.keys.addAndUse(newKeys())
        server.keyId = phone.keys.current
        phone.runUntilQuiet()

        val status = tablet.status()
        assertEquals(SendBlock.ENTER_THE_NEW_RECOVERY_KEY, status.sendBlock)
        tablet.addItem("Tea")
        assertEquals(ExportResult.NothingToSend, tablet.client.export(tablet.call(), ExportRequest(false, 100, server.mostBytes)))
        tablet.fetchAll()
        assertTrue("records of the new key are skipped", tablet.status().counts.anotherRecoveryKey > 0)

        // The user enters the new words on the tablet.
        tablet.keys.addAndUse(newKeys())
        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        assertEquals(phone.records(), tablet.records())
        assertEquals(SendBlock.NONE, tablet.status().sendBlock)
        assertEquals(setOf(server.keyId), keyIdsOnTheServer())
    }

    @Test
    fun theLastFetchTakesWhatADeviceAlreadyOnTheNewKeySealedWithIt() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        tablet.addItem("Bread")
        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        // The phone follows the new key first: it seals everything again with it, and adds one more record.
        phone.keys.addAndUse(newKeys())
        server.keyId = phone.keys.current
        phone.runUntilQuiet()
        val tea = phone.addItem("Tea")
        phone.runUntilQuiet()

        // The tablet gets the new words. Its one last fetch meets only records sealed with P, the new key.
        tablet.keys.addAndUse(newKeys())
        val status = tablet.status()
        assertTrue(status.wantsFetch)
        val page = server.fetch(LISTS.value, tablet.deviceId, status.cursor, status.known, tablet.epoch, SyncFormat.MOST_RECORDS)
        assertEquals("one page", 0, page[1 + 16 + 8 + 8].toInt())
        tablet.client.import(tablet.call(), page)
        assertEquals("taken by the last fetch", "Tea", tablet.database.items().find(tea.record.id)?.title)

        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        assertEquals(phone.records(), tablet.records())
        assertEquals(setOf(server.keyId), keyIdsOnTheServer())
    }

    @Test
    fun syncTurnedOnWhileTheServerNamesAKeyTheAppDoesNotHoldWaitsForTheNewWords() = runBlocking {
        val phone = device("phone")
        phone.addItem("Bread")
        phone.keys.addAndUse(newKeys())
        server.keyId = phone.keys.current
        phone.runUntilQuiet()

        // A tablet with only the old words turns sync on: S is not set yet.
        val tablet = device("tablet", join = false)
        assertEquals(SendBlock.ENTER_THE_NEW_RECOVERY_KEY, tablet.status().sendBlock)
        val tea = tablet.addItem("Tea")
        assertEquals(ExportResult.NothingToSend, tablet.client.export(tablet.call(), ExportRequest(false, 100, server.mostBytes)))
        tablet.fetchAll()
        assertTrue("records of the new key are skipped", tablet.status().counts.anotherRecoveryKey > 0)
        assertFalse(tea.record.id in server.ids(LISTS.value))

        // The user enters the new words: S is the new key, and what was skipped is fetched again.
        tablet.keys.addAndUse(newKeys())
        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        assertEquals(SendBlock.NONE, tablet.status().sendBlock)
        assertEquals(phone.records(), tablet.records())
        assertEquals(setOf(server.keyId), keyIdsOnTheServer())
    }

    @Test
    fun syncTurnedOnWhileTheServerNamesAnOlderKeyTheAppHoldsNeverSyncsWithThatKey() = runBlocking {
        val phone = device("phone")
        phone.addItem("Bread")
        phone.runUntilQuiet()

        // A tablet whose app already holds the new key turns sync on while the server still names the old one.
        val tablet = device("tablet", join = false)
        tablet.keys.addAndUse(newKeys())
        val newKeyId = tablet.keys.current
        val tea = tablet.addItem("Tea")
        tablet.run()
        assertEquals(SendBlock.SERVER_NAMES_AN_OLDER_KEY, tablet.status().sendBlock)
        assertFalse("nothing is sent", tea.record.id in server.ids(LISTS.value))

        // The server takes the statement. The tablet syncs with the new key, never with the old one.
        server.keyId = newKeyId
        phone.keys.addAndUse(newKeys())
        repeat(2) { listOf(tablet, phone).forEach { it.runUntilQuiet() } }
        assertEquals(SendBlock.NONE, tablet.status().sendBlock)
        assertEquals(phone.records(), tablet.records())
        assertEquals(setOf(newKeyId), keyIdsOnTheServer())
    }

    @Test
    fun aServerThatNamesAnOlderKeyIsNotFollowedAndSNeverMovesBack() = runBlocking {
        val phone = device("phone")
        phone.keys.addAndUse(newKeys())
        val newKeyId = phone.keys.current
        val old = oldKeyId
        server.keyId = newKeyId
        phone.runUntilQuiet()

        // The server's database is put back: it names the old key again.
        server.keyId = old
        assertEquals(SendBlock.SERVER_NAMES_AN_OLDER_KEY, phone.status().sendBlock)
        phone.addItem("Milk")
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)))
        phone.fetchAll()

        // The statement is sent again: the server names the new key, and the app sends without a new comparison.
        server.keyId = newKeyId
        val status = phone.status()
        assertEquals(SendBlock.NONE, status.sendBlock)
        assertFalse(status.wantsFetch)
        assertEquals(ComparisonState.NONE, status.comparison)
        assertEquals(listOf(0x00), phone.sendAll(comparison = false))
    }

    @Test
    fun anOlderKeyThatTheAppStillSealsWithIsNotFollowedEither() = runBlocking {
        // P is the old key and S too, and the server names a key the app holds but that is neither: C is older.
        val phone = device("phone")
        val older = SoftwareKeysApp(temporary.newFolder(), LISTS).crypto.also { it.setup.storeDerivedKeys(it.setup.createRecoveryKey()) }
        val current = phone.keys.current
        phone.keys.addAndUse(older)
        phone.keys.current = current
        server.keyId = older.records.keyIds().current

        assertEquals(SendBlock.SERVER_NAMES_AN_OLDER_KEY, phone.status().sendBlock)
        phone.addItem("Milk")
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)))
    }
}
