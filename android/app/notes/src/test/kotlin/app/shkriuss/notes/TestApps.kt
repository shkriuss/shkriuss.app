package app.shkriuss.notes

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.security.AppGate
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.UnlockedAppForTests
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.notes.NotesHost
import app.shkriuss.feature.notes.NotesServices
import app.shkriuss.feature.notes.data.NotesDatabase
import app.shkriuss.feature.notes.data.SecureDelete
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.flow.map

/** The name of the app in keys, as `NotesApp` has it. */
private val NOTES: AppName = NotesServices.APP_NAME

/** The time the tests start at: Tuesday 24 November 2026 at 09:30, as in the spec's examples. */
val THE_TIME: LocalDateTime = LocalDateTime.of(2026, 11, 24, 9, 30)

/**
 * What Notes' screens get from the app class, on a database in memory,
 * with a clock the test controls, and the keys of the app class [app].
 */
class TestNotes(
    app: Application,
    val clock: TestClock = TestClock(THE_TIME.toInstant(ZoneOffset.UTC).toEpochMilli()),
    val database: NotesDatabase = inMemoryTestDatabaseBuilder<NotesDatabase>(app).addCallback(SecureDelete).build(),
    val ids: TestIdSource = TestIdSource(),
) {
    private val host = app as SecurityHost

    /** What the app class hands to the screens. */
    val services: NotesServices =
        NotesServices(app, database, clock, ids, host.crypto, gateOpen = host.appLock.gate.map { it == AppGate.OPEN })
}

/** The app class of every test of the screens. */
interface NotesTestApp : NotesHost {
    /** The database, the clock and the services of the test. */
    val test: TestNotes

    override val notes: NotesServices
        get() = test.services
}

/**
 * Notes' app class for the check that every screen is behind the app
 * lock: locked from the start, with what `NotesApp` hands to the screens.
 */
class LockedNotesApp : LockedAppForTests(NOTES), NotesTestApp {
    override val test: TestNotes by lazy { TestNotes(this) }
}

/** Notes' app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedNotesApp : UnlockedAppForTests(NOTES), NotesTestApp {
    override val test: TestNotes by lazy { TestNotes(this) }
}
