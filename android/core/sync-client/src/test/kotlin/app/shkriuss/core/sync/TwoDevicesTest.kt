package app.shkriuss.core.sync

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The plain case: what one device writes reaches the other, records and files. */
@RunWith(RobolectricTestRunner::class)
class TwoDevicesTest : SyncTest() {
    @Test
    fun anItemAndAFileReachTheOtherDevice() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        val item = phone.addItem("Milk")
        val file = phone.addFile("photo.jpg", ByteArray(5_000) { it.toByte() })

        phone.runUntilQuiet()
        tablet.runUntilQuiet()

        assertEquals(phone.records(), tablet.records())
        assertEquals("Milk", tablet.database.items().find(item.record.id)?.title)
        assertEquals(phone.storedStreams(), tablet.storedStreams())
        assertEquals(setOf(item.record.id, file.record.id), server.ids(LISTS.value))
    }

    @Test
    fun editsAndDeletionsGoBothWays() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        val item = phone.addItem("Milk")
        phone.runUntilQuiet()
        tablet.runUntilQuiet()

        clock.advanceBy(1_000)
        tablet.editItem(item.record.id, "Oat milk")
        val bread = tablet.addItem("Bread")
        tablet.runUntilQuiet()
        phone.runUntilQuiet()
        clock.advanceBy(1_000)
        phone.deleteItem(bread.record.id)
        phone.wipeItem(bread.record.id)
        phone.runUntilQuiet()
        tablet.runUntilQuiet()

        assertEquals(phone.records(), tablet.records())
        assertEquals("Oat milk", phone.database.items().find(item.record.id)?.title)
        assertEquals("", tablet.database.items().find(bread.record.id)?.title)
    }
}
