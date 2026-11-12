package app.shkriuss.core.testing

import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Test

/** Checks that [TestIdSource] and [TestClock] behave as their tests expect. */
class TestSourcesTest {
    @Test
    fun testIdsAreRandomStyleUuidsInTheOrderHandedOut() {
        val source = TestIdSource()

        val ids = List(3) { source.newId() }

        assertEquals(TestIdSource.idNumber(1), ids[0])
        assertEquals(ids.sorted(), ids)
        ids.forEach { id ->
            val uuid = UUID.fromString(id)
            assertEquals(id, uuid.toString())
            assertEquals(4, uuid.version())
        }
    }

    @Test
    fun testClockMovesOnlyWhenTold() {
        val clock = TestClock()

        val start = clock.nowMillis()
        clock.advanceBy(1_500)

        assertEquals(TestClock.START_MILLIS, start)
        assertEquals(TestClock.START_MILLIS + 1_500, clock.nowMillis())
    }
}
