package app.shkriuss.feature.reminders

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** The zone of the spec's examples, unless they say otherwise: Tbilisi, UTC+4, with no summer time. */
internal val TBILISI: ZoneId = ZoneId.of("Asia/Tbilisi")

/** The other zone of the spec's examples: Berlin, with summer time. */
internal val BERLIN: ZoneId = ZoneId.of("Europe/Berlin")

/** The zone of the tests of the database and the screens. Local time and UTC are the same, so a test reads the clock as it is written. */
internal val UTC: ZoneId = ZoneOffset.UTC

/** The Monday of the spec's examples: 16 November 2026. */
internal val MONDAY: LocalDate = LocalDate.of(2026, 11, 16)

/** [MONDAY] plus [days], at [hour]:[minute]. */
internal fun day(days: Long, hour: Int, minute: Int = 0, second: Int = 0): LocalDateTime =
    MONDAY.plusDays(days).atTime(hour, minute, second)

/** [MONDAY] at [hour]:[minute]. */
internal fun monday(hour: Int, minute: Int = 0, second: Int = 0): LocalDateTime = day(0, hour, minute, second)

/** What the clock shows at the local time [local] in [zone]. */
internal fun readingAt(local: LocalDateTime, zone: ZoneId = TBILISI): ClockReading =
    ClockReading(local.atZone(zone).toInstant().toEpochMilli(), zone)

/** The moment of the local time [local] in [zone], in milliseconds. */
internal fun millisAt(local: LocalDateTime, zone: ZoneId = TBILISI): Long = local.atZone(zone).toInstant().toEpochMilli()

/** A schedule at [hour]:[minute]. */
internal fun schedule(repeat: Repeat, date: LocalDate, hour: Int, minute: Int = 0, vararg days: DayOfWeek): Schedule =
    Schedule(repeat, date, hour * 60 + minute, Weekdays.of(*days))

/** "Pills": every day at 09:00, from [from]. */
internal fun pills(from: LocalDate = MONDAY.minusDays(1)): Schedule = schedule(Repeat.DAILY, from, 9)

/** "Call the bank": once, Monday 16 November 2026 at 14:00. */
internal val CALL_THE_BANK: Schedule = schedule(Repeat.ONCE, MONDAY, 14)

/** "Gym": every Monday, Wednesday and Friday at 18:30, from [from]. */
internal fun gym(from: LocalDate = MONDAY): Schedule =
    schedule(Repeat.WEEKLY, from, 18, 30, DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)

/** A clock that shows [time] in [UTC]. */
internal fun clockAt(time: LocalDateTime): TestClock = TestClock(time.toInstant(ZoneOffset.UTC).toEpochMilli())

/** Moves [clock] to [time] in [UTC]. */
internal fun TestClock.setTo(time: LocalDateTime) {
    nowMillis = time.toInstant(ZoneOffset.UTC).toEpochMilli()
}

/** The context of the Robolectric app. */
internal val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

/** A Reminders database in memory, on the system SQLite driver. Close it at the end of the test. */
internal fun memoryDatabase(): RemindersDatabase = inMemoryTestDatabaseBuilder<RemindersDatabase>(context).build()

/** A book in a preferences file of its own, empty at the start. */
internal fun emptyBook(name: String = ReminderBook.FILE): ReminderBook =
    ReminderBook(context.getSharedPreferences(name, Context.MODE_PRIVATE).also { check(it.edit().clear().commit()) })

/** Waits up to five seconds for a state that [condition] accepts, and returns it. */
internal fun <T> StateFlow<T>.await(condition: (T) -> Boolean): T = runBlocking {
    withTimeout(5_000) { first(condition) }
}
