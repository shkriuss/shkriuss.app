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
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
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

/** A Water database in memory that does its reads and writes on [work], so that a test decides their order ([NewestFirstWork]). */
internal fun memoryDatabaseOn(work: CoroutineDispatcher): WaterDatabase =
    inMemoryTestDatabaseBuilder<WaterDatabase>(context).setQueryCoroutineContext(work).build()

/**
 * One thread that runs the work it is given, the newest first, and that a
 * test can hold. A screen and its database that both work here do
 * nothing while it is held. When the test lets go, the change that was
 * made last gets to the database first, and it is finished before an
 * older one starts: the order that two changes can take on a busy phone
 * when nothing keeps them in line.
 */
internal class NewestFirstWork : CoroutineDispatcher(), AutoCloseable {
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private val waiting = ArrayDeque<Runnable>()
    private var held = false
    private var running = false
    private var closed = false

    init {
        thread(name = "newest-first-work", isDaemon = true) { runWhatWaits() }
    }

    override fun dispatch(context: CoroutineContext, block: Runnable) = lock.withLock {
        waiting.addLast(block)
        changed.signalAll()
    }

    /** From now on, the work that is given waits. */
    fun hold() = lock.withLock { held = true }

    /** The work that waited runs, the newest first. */
    fun letGo() = lock.withLock {
        held = false
        changed.signalAll()
    }

    /** Waits until all the work has run, with what it gave in turn. Fails after ten seconds. */
    fun awaitIdle() = lock.withLock {
        var left = TimeUnit.SECONDS.toNanos(10)
        while (held || running || waiting.isNotEmpty()) {
            check(left > 0) { "The work did not end in ten seconds" }
            left = changed.awaitNanos(left)
        }
    }

    override fun close() = lock.withLock {
        closed = true
        changed.signalAll()
    }

    private fun runWhatWaits() {
        while (true) {
            val next = lock.withLock {
                running = false
                changed.signalAll()
                while (!closed && (held || waiting.isEmpty())) changed.await()
                if (closed) return
                running = true
                waiting.removeLast()
            }
            next.run()
        }
    }
}

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
