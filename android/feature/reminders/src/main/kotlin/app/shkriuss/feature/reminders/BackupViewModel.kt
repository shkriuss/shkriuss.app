package app.shkriuss.feature.reminders

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.security.RecoveryKeyNeed
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A screen of Android or of `core/security` that the screen must open once, after the recovery key is there. */
sealed interface BackupOpen {
    /** Android's "create document" screen, with the suggested [name], such as `reminders-2026-11-16.shkbackup`. */
    data class NewDocument(val name: String) : BackupOpen

    /** Android's "open document" screen. */
    data object Document : BackupOpen

    /** The app lock screen of `core/security`. */
    data object AppLock : BackupOpen
}

/**
 * What the sections "Backup" and "Security" of Settings show, and where a
 * backup or a restore stands (docs/apps/water/spec.md, "Settings screen"
 * and "Backup and restore screens", as docs/apps/reminders/spec.md, "As
 * in Water", says).
 */
data class BackupScreen(
    /** False until the keys were read for the first time. The two sections show nothing until then. */
    val loaded: Boolean = false,
    /** Where the recovery key stands: the row "Recovery key", and the note at the top of "Backup". */
    val recoveryKey: RecoveryKeyLine = RecoveryKeyLine.NOT_SET_UP,
    /** True while the app lock is on: the row "App lock" says "On". */
    val appLockOn: Boolean = false,
    /** The dialog of a backup or a restore that shows now, or null. */
    val step: BackupStep? = null,
    /** A screen to open once. The screen opens it and calls [BackupViewModel.opened]. */
    val open: BackupOpen? = null,
)

/**
 * The ViewModel of backup and restore, and of the rows about the recovery
 * key and the app lock.
 *
 * A backup, a restore and the app lock need the recovery key. Whether the
 * app has one is asked by the first-need dialog of `core/security`
 * (ADR 0035). Once the key is there it calls [goOn], and this ViewModel
 * asks the screen to open what the user started, through
 * [BackupScreen.open].
 *
 * The screen calls [refresh] each time it starts, which is also the way
 * back from a screen of `core/security`: the keys may have changed there.
 */
class BackupViewModel(
    private val backups: RemindersBackups,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val screen = MutableStateFlow(BackupScreen())

    /** The one state of the two sections and of the dialogs. */
    val state: StateFlow<BackupScreen> = screen.asStateFlow()

    /** The file picked for a restore, between the question and the restore. It is never shown. */
    private var picked: Uri? = null

    /**
     * True from [goOn] until the screen has opened what it asked for
     * ([opened]). Read and written on the main thread only.
     */
    private var goingOn = false

    /** Reads the keys again. A pending move of the file keys is finished first (Water's spec, "Files"). */
    fun refresh() {
        viewModelScope.launch(work) { readKeys() }
    }

    private suspend fun readKeys() {
        val keys = backups.keys() ?: return
        screen.update { it.copy(loaded = true, recoveryKey = keys.recoveryKey, appLockOn = keys.appLockOn) }
    }

    /**
     * The app has its keys from a recovery key, and the user started
     * [need]. Reminders goes on with it, without another tap (Water's
     * spec, "After the flow"): the "create document" screen, the "open
     * document" screen, or the app lock screen. Before that, the keys are
     * read again, which finishes a pending move of the file keys.
     *
     * Settings can be tapped while the keys are read. A second [goOn]
     * before the screen has opened the first is ignored, as a second start
     * of the first-need dialog is: so only one screen opens.
     */
    fun goOn(need: RecoveryKeyNeed) {
        if (goingOn) return
        goingOn = true
        viewModelScope.launch(work) {
            readKeys()
            val next = when (need) {
                RecoveryKeyNeed.BACKUP -> BackupOpen.NewDocument(backups.suggestedName())
                RecoveryKeyNeed.RESTORE -> BackupOpen.Document
                RecoveryKeyNeed.APP_LOCK -> BackupOpen.AppLock
            }
            screen.update { it.copy(open = next) }
        }
    }

    /** The screen has opened what [BackupScreen.open] asked for. A new [goOn] may follow. */
    fun opened() {
        goingOn = false
        screen.update { it.copy(open = null) }
    }

    /**
     * The user picked the place [to] for a new backup, or left the picker
     * (null). The backup is written, and then the file is read again and
     * checked.
     */
    fun write(to: Uri?) {
        if (to == null || screen.value.step != null) return
        show(BackupStep.Writing)
        viewModelScope.launch(work) {
            val ended = backups.write(to)
            if (ended != null) {
                show(ended)
            } else {
                show(BackupStep.Checking)
                show(backups.checkWritten(to))
            }
        }
    }

    /**
     * The user picked the file [from] to restore, or left the picker
     * (null). The whole file is checked first. A good one gives the
     * question "Restore this backup?".
     */
    fun look(from: Uri?) {
        if (from == null || screen.value.step != null) return
        show(BackupStep.Checking)
        viewModelScope.launch(work) {
            val found = backups.look(from)
            picked = if (found is BackupStep.Question) from else null
            show(found)
        }
    }

    /** **Restore** at the question: the picked file is restored. */
    fun restore() {
        val from = picked ?: return
        if (screen.value.step !is BackupStep.Question) return
        picked = null
        show(BackupStep.Restoring)
        viewModelScope.launch(work) { show(backups.restore(from)) }
    }

    /** **OK** in a dialog that ended, or **Cancel** at the question: the dialog closes. Nothing else changes. */
    fun close() {
        val now = screen.value.step
        if (now == BackupStep.Writing || now == BackupStep.Checking || now == BackupStep.Restoring) return
        picked = null
        show(null)
    }

    private fun show(step: BackupStep?) {
        screen.update { it.copy(step = step) }
    }
}
