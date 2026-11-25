package app.shkriuss.feature.water

import android.content.Context
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** The zone of the tests. Local time and UTC are the same, so a test reads the clock as it is written. */
internal val UTC: ZoneId = ZoneOffset.UTC

/** The day of the examples in the spec: Friday, 13 November 2026. */
internal val THE_DAY: LocalDate = LocalDate.of(2026, 11, 13)

/** [THE_DAY] at [hour]:[minute]. */
internal fun at(hour: Int, minute: Int, second: Int = 0): LocalDateTime = THE_DAY.atTime(LocalTime.of(hour, minute, second))

/** A clock that shows [time] in [UTC]. */
internal fun clockAt(time: LocalDateTime): TestClock = TestClock(time.toInstant(ZoneOffset.UTC).toEpochMilli())

/** Moves [clock] to [time] in [UTC]. */
internal fun TestClock.setTo(time: LocalDateTime) {
    nowMillis = time.toInstant(ZoneOffset.UTC).toEpochMilli()
}

/** The context of the Robolectric app. */
internal val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

/** A Water database in memory, on the system SQLite driver. Close it at the end of the test. */
internal fun memoryDatabase(): WaterDatabase = inMemoryTestDatabaseBuilder<WaterDatabase>(context).build()

/**
 * Makes every write to [table] that SQLite would do fail from now on, as
 * when the disk is full: a trigger aborts each insert and update. Room
 * throws an `android.database.SQLException`, and the transaction rolls
 * back.
 */
internal fun WaterDatabase.refuseWritesTo(table: String) = runBlocking {
    useWriterConnection { connection ->
        connection.executeSQL("CREATE TRIGGER refuse_insert_$table BEFORE INSERT ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
        connection.executeSQL("CREATE TRIGGER refuse_update_$table BEFORE UPDATE ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
    }
}

/**
 * Makes every read of [table] fail from now on, as when the database
 * cannot be read: the table is gone. Room throws an
 * `android.database.SQLException`.
 */
internal fun WaterDatabase.refuseReadsOf(table: String) = runBlocking {
    useWriterConnection { connection -> connection.executeSQL("DROP TABLE $table") }
}

/** Waits up to five seconds for a state that [condition] accepts, and returns it. */
internal fun <T> StateFlow<T>.await(condition: (T) -> Boolean): T = runBlocking {
    withTimeout(5_000) { first(condition) }
}
