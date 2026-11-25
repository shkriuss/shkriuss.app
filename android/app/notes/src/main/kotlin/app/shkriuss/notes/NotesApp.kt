package app.shkriuss.notes

import android.app.Application
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.security.AppGate
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.notes.NotesHost
import app.shkriuss.feature.notes.NotesServices
import app.shkriuss.feature.notes.data.NotesDatabase
import kotlinx.coroutines.flow.map

/**
 * The app class of Notes. It builds the one [ShkCrypto], the one
 * [AppLockWatcher] and the one [NotesServices] of the app, and hands them
 * to the screens, which Android creates itself
 * (docs/architecture/security-screens.md, "What an app does"). When it
 * starts, Notes sweeps: it wipes what is still deleted and removes the
 * streams that no file needs (docs/apps/notes/spec.md, "Removing a file,
 * and the wipe").
 */
class NotesApp : Application(), SecurityHost, NotesHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, NotesServices.APP_NAME).also { it.start() } }

    // Notes shows no notifications: there is no text the app lock must hide, and its screen offers no choice about it.
    override val appLock: AppLockWatcher by lazy { AppLockWatcher(this, crypto, onTextHidden = null) }

    override val notes: NotesServices by lazy {
        NotesServices(
            this,
            NotesDatabase.open(this),
            Clock.System,
            IdSource.RandomUuid,
            crypto,
            gateOpen = appLock.gate.map { it == AppGate.OPEN },
        )
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
        notes.start()
    }
}
