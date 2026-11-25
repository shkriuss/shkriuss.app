package app.shkriuss.notes

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.security.AppGate
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.testing.AppLockOnForTests
import app.shkriuss.core.testing.LockedAppForTests
import app.shkriuss.core.testing.NewAppForTests
import app.shkriuss.core.testing.StoppedSetupAppForTests
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
 * with a clock the test controls in UTC, and the keys of the app class
 * [app].
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
        NotesServices(app, database, clock, ids, host.crypto, gateOpen = host.appLock.gate.map { it == AppGate.OPEN }, zone = { ZoneOffset.UTC })
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

/** Notes' app class with the app lock on and the app open, for the check that every dialog and menu goes when the app locks. */
class AppLockOnNotesApp : AppLockOnForTests(NOTES), NotesTestApp {
    override val test: TestNotes by lazy { TestNotes(this) }
}

/** Notes' app class with the app lock off, for screenshots and tests of the screens. */
class UnlockedNotesApp : UnlockedAppForTests(NOTES), NotesTestApp {
    private var started: TestNotes? = null

    override val test: TestNotes
        get() = started ?: TestNotes(this).also { started = it }

    /**
     * The same app on a phone with no notes: new objects on an empty
     * database, with the same keys, clock and source of IDs. As a second
     * phone that has entered the same recovery words, before a restore.
     */
    fun startOnAPhoneWithNoData() {
        val before = test
        started = TestNotes(this, before.clock, ids = before.ids)
    }
}

/**
 * Notes' app class with no recovery key yet, as right after Notes was
 * installed, for what Settings shows before the recovery key is first
 * needed (Water's spec, "The recovery key when first needed").
 */
class NewNotesApp : NewAppForTests(NOTES), NotesTestApp {
    override val test: TestNotes by lazy { TestNotes(this) }
}

/** Notes' app class after a setup of the recovery key that stopped half way. */
class StoppedSetupNotesApp : StoppedSetupAppForTests(NOTES), NotesTestApp {
    override val test: TestNotes by lazy { TestNotes(this) }
}
