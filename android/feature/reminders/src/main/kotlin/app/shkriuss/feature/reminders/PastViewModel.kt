package app.shkriuss.feature.reminders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/** What Past shows (docs/apps/reminders/spec.md, "Past"). */
data class PastScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** Today, so that a row can leave out the year of this year. */
    val today: LocalDate,
    /** The past reminders, newest first. */
    val rows: List<PastRow> = emptyList(),
    /** The question "Delete all past reminders?", while it shows. */
    val question: DeleteAllQuestion? = null,
    /** The snackbar "12 reminders deleted", with Undo, while it shows. */
    val snackbar: AllDeleted? = null,
) {
    /** True with no past reminder: "No past reminders. A one-time reminder moves here after it shows." */
    val isEmpty: Boolean
        get() = loaded && rows.isEmpty()

    /** True while **Delete all** shows in the top bar: the list is not empty. */
    val canDeleteAll: Boolean
        get() = rows.isNotEmpty()
}

/** The question of **Delete all**: "This deletes 12 reminders." It deletes the reminders [ids] that were past when it opened. */
data class DeleteAllQuestion(
    /** The past reminders it deletes. */
    val ids: List<String>,
) {
    /** How many it deletes, for "This deletes 12 reminders." */
    val count: Int
        get() = ids.size
}

/** The snackbar after **Delete all**: "12 reminders deleted". Undo brings the reminders [ids] back. */
data class AllDeleted(
    /** The reminders that were deleted. */
    val ids: List<String>,
) {
    /** How many were deleted, for "12 reminders deleted". */
    val count: Int
        get() = ids.size
}

/**
 * The ViewModel of Past. The list follows the database, the phone-only
 * entries and [now], the one source of the clock. **Delete all** asks
 * first, then marks every past reminder as deleted in one write, and the
 * snackbar offers Undo, which brings them back counting from now. The
 * form is the [ReminderFormViewModel].
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
class PastViewModel(
    private val repository: RemindersRepository,
    now: RemindersNow,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val question = MutableStateFlow<DeleteAllQuestion?>(null)
    private val snackbar = MutableStateFlow<AllDeleted?>(null)

    /** What the screen shows. */
    val state: StateFlow<PastScreen> = combine(
        repository.reminders(),
        repository.entries,
        now.reading,
        question,
        snackbar,
    ) { reminders, entries, reading, openQuestion, shownSnackbar ->
        PastScreen(
            loaded = true,
            today = reading.today,
            rows = ReminderLists.of(reminders, entries, reading).past,
            question = openQuestion,
            snackbar = shownSnackbar,
        )
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, PastScreen(loaded = false, today = now.reading.value.today))

    /** **Delete all** in the top bar: the question opens, for the reminders past now. With none, nothing opens. */
    fun askDeleteAll() {
        val rows = state.value.rows
        if (rows.isEmpty()) return
        question.value = DeleteAllQuestion(rows.map { it.reminder.id })
    }

    /** **Cancel** in the question: it closes and nothing is deleted. */
    fun cancelDeleteAll() {
        question.value = null
    }

    /** **Delete** in the question: it closes, the reminders it named are marked as deleted, and the snackbar offers Undo. */
    fun confirmDeleteAll() {
        val asked = question.value ?: return
        question.value = null
        viewModelScope.launch(work) {
            val deleted = repository.delete(asked.ids)
            if (deleted.isNotEmpty()) snackbar.value = AllDeleted(deleted.map { it.id })
        }
    }

    /** Undo in the snackbar: the deleted reminders come back. */
    fun undo() {
        val shown = snackbar.value ?: return
        snackbar.value = null
        viewModelScope.launch(work) { repository.bringBack(shown.ids) }
    }

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }
}
