package app.shkriuss.feature.tasks

import android.content.Context
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** The zone of the spec's examples: Tbilisi, UTC+4, with no summer time. */
internal val TBILISI: ZoneId = ZoneId.of("Asia/Tbilisi")

/** A zone with summer time: Berlin. */
internal val BERLIN: ZoneId = ZoneId.of("Europe/Berlin")

/** The zone of the tests of the database and the screens. Local time and UTC are the same, so a test reads the clock as it is written. */
internal val UTC: ZoneId = ZoneOffset.UTC

/** The Monday of the spec's examples: 16 November 2026. */
internal val MONDAY: LocalDate = LocalDate.of(2026, 11, 16)

/** [MONDAY] plus [days]. */
internal fun day(days: Long): LocalDate = MONDAY.plusDays(days)

/** [MONDAY] at [hour]:[minute]:[second]. */
internal fun monday(hour: Int, minute: Int = 0, second: Int = 0): LocalDateTime = MONDAY.atTime(hour, minute, second)

/** What the clock shows at the local time [local] in [zone]. */
internal fun readingAt(local: LocalDateTime, zone: ZoneId = UTC): ClockReading = ClockReading(local.atZone(zone).toInstant().toEpochMilli(), zone)

/** A clock that shows [time] in [UTC]. */
internal fun clockAt(time: LocalDateTime): TestClock = TestClock(time.toInstant(ZoneOffset.UTC).toEpochMilli())

/** Moves [clock] to [time] in [UTC]. */
internal fun TestClock.setTo(time: LocalDateTime) {
    nowMillis = time.toInstant(ZoneOffset.UTC).toEpochMilli()
}

/** A repeat of [kind] from [from], with [days] for Every week. */
internal fun repeat(kind: Repeat, from: LocalDate, vararg days: DayOfWeek): TaskRepeat = TaskRepeat(kind, from, Weekdays.of(*days))

/** "Rent": every month from Sat 31 Oct 2026. */
internal val RENT: TaskRepeat = repeat(Repeat.MONTHLY, LocalDate.of(2026, 10, 31))

/** "Pills": every day from Mon 16 Nov 2026. */
internal val PILLS: TaskRepeat = repeat(Repeat.DAILY, MONDAY)

/** "Gym": every Mon, Wed and Fri, from Mon 16 Nov 2026. */
internal val GYM: TaskRepeat = repeat(Repeat.WEEKLY, MONDAY, DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)

/** The context of the Robolectric app. */
internal val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

/** A Tasks database in memory, on the system SQLite driver. Close it at the end of the test. */
internal fun memoryDatabase(): TasksDatabase = inMemoryTestDatabaseBuilder<TasksDatabase>(context).build()

/** A book in a preferences file of its own, empty at the start. */
internal fun emptyBook(name: String = TaskBook.FILE): TaskBook =
    TaskBook(context.getSharedPreferences(name, Context.MODE_PRIVATE).also { check(it.edit().clear().commit()) })

/**
 * Makes every write to [table] that SQLite would do fail from now on, as
 * when the disk is full: a trigger aborts each insert and update. Room
 * throws an `android.database.SQLException`, and the transaction rolls
 * back.
 */
internal fun TasksDatabase.refuseWritesTo(table: String) = runBlocking {
    useWriterConnection { connection ->
        connection.executeSQL("CREATE TRIGGER refuse_insert_$table BEFORE INSERT ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
        connection.executeSQL("CREATE TRIGGER refuse_update_$table BEFORE UPDATE ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
    }
}

/** Lets SQLite write to [table] again. */
internal fun TasksDatabase.acceptWritesTo(table: String) = runBlocking {
    useWriterConnection { connection ->
        connection.executeSQL("DROP TRIGGER refuse_insert_$table")
        connection.executeSQL("DROP TRIGGER refuse_update_$table")
    }
}

/** Waits up to five seconds for a state that [condition] accepts, and returns it. */
internal fun <T> StateFlow<T>.await(condition: (T) -> Boolean): T = runBlocking {
    withTimeout(5_000) { first(condition) }
}
