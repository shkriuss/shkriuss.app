package app.shkriuss.feature.tasks

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.Locale
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/** What Lists shows (docs/apps/tasks/spec.md, "Lists"). */
data class ListsScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** True if the database could not be read: "Could not open your tasks." */
    val failed: Boolean = false,
    /** Inbox first, then each list by name, each with its count of open tasks. */
    val rows: List<ListRow> = emptyList(),
)

/**
 * The ViewModel of Lists. The rows follow the database: Inbox first, then
 * each list by name in the phone's language order, [locale]. They are
 * put in order again at each reading of [now], so when the phone's
 * language changes, which starts the screen again, the order follows it
 * (`TasksNow.check`). **New list** opens the [ListNameViewModel]. A tap
 * opens the list in the [ListViewModel].
 */
class ListsViewModel(
    repository: TasksRepository,
    now: TasksNow,
    work: CoroutineContext = EmptyCoroutineContext,
    locale: () -> Locale = Locale::getDefault,
) : ViewModel() {
    /** What the screen shows. */
    val state: StateFlow<ListsScreen> = combine(repository.tasks(), repository.lists(), now.reading) { tasks, lists, _ ->
        ListsScreen(loaded = true, rows = TaskOrder.lists(tasks, lists, locale()))
    }.onReadFailure { ListsScreen(loaded = true, failed = true) }
        .stateIn(viewModelScope + work, SharingStarted.Eagerly, ListsScreen(loaded = false))
}

/** Why the name dialog does not save: the words under its field. */
enum class NameProblem {
    /** "Enter a name." */
    EMPTY,

    /** "A name has at most 60 characters." */
    TOO_LONG,

    /** "Tasks keeps 100 lists. Delete one to add another." */
    TOO_MANY_LISTS,

    /** "Could not save the list. Try again." */
    COULD_NOT_SAVE,
}

/** The dialog with one field, **Name**, of **New list** or **Rename**. */
data class NameDialog(
    /** The list being renamed, or null for **New list**. */
    val listId: String?,
    /** The field, as typed. */
    val name: String,
    /** The name as stored, for **Rename**. A Save with no change writes nothing. */
    val storedName: String? = null,
    /** After a Save that did not save: the words under the field. */
    val problem: NameProblem? = null,
    /** True while Save writes. Another Save does nothing then. */
    val saving: Boolean = false,
)

/**
 * The name dialog of **New list**, on Lists, and of **Rename**, in a
 * list's menu (docs/apps/tasks/spec.md, "Lists", point 2, and "A list",
 * point 1). A name has 1 to 60 code points. **New list** adds none while
 * 100 are kept. Save takes one press at a time and closes after it; a
 * write the database refuses keeps the dialog open with the name, and
 * says so under the field.
 */
class ListNameViewModel(
    private val repository: TasksRepository,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val dialog = MutableStateFlow<NameDialog?>(null)

    /** The dialog, while it is open. */
    val state: StateFlow<NameDialog?> = dialog.asStateFlow()

    /** **New list**: an empty name. */
    fun openNew() {
        dialog.value = NameDialog(listId = null, name = "")
    }

    /** **Rename** in the menu of [list]: its name. */
    fun openRename(list: TaskList) {
        dialog.value = NameDialog(listId = list.id, name = list.name, storedName = list.name)
    }

    /** The user typed in the field. It has one line. A shown problem of the name follows what is typed. */
    fun onNameChange(text: String) = change { open ->
        val name = TextRules.NAME.oneLine(text)
        val problem = when (open.problem) {
            NameProblem.EMPTY, NameProblem.TOO_LONG -> nameProblemOf(name)
            else -> open.problem
        }
        open.copy(name = name, problem = problem)
    }

    /**
     * **Save**. A wrong name shows its words and nothing is written. A
     * rename with no change closes and writes nothing. Otherwise it writes
     * and closes.
     */
    fun save() {
        val open = dialog.value ?: return
        if (open.saving) return
        nameProblemOf(open.name)?.let { problem ->
            dialog.value = open.copy(problem = problem)
            return
        }
        val name = TextRules.NAME.clean(open.name)
        if (open.listId != null && name == open.storedName) {
            dialog.value = null
            return
        }
        val writing = open.copy(problem = null, saving = true)
        dialog.value = writing
        viewModelScope.launch(work) {
            val after = try {
                val saved = if (open.listId == null) repository.addList(name) else repository.renameList(open.listId, name)
                when {
                    saved != null -> null
                    open.listId == null -> writing.copy(problem = NameProblem.TOO_MANY_LISTS, saving = false)
                    // The list was deleted in that moment: there is nothing to rename.
                    else -> null
                }
            } catch (_: SQLException) {
                writing.copy(problem = NameProblem.COULD_NOT_SAVE, saving = false)
            }
            dialog.compareAndSet(writing, after)
        }
    }

    /** **Cancel**: the dialog closes and nothing is written. While Save writes it does nothing: the dialog closes when the write ends. */
    fun cancel() {
        if (dialog.value?.saving == true) return
        dialog.value = null
    }

    private fun nameProblemOf(name: String): NameProblem? = when (TextRules.NAME.problemOf(name)) {
        TextProblem.EMPTY -> NameProblem.EMPTY
        TextProblem.TOO_LONG -> NameProblem.TOO_LONG
        null -> null
    }

    /** Changes the open dialog by [edit]. While Save writes, it takes no change. */
    private fun change(edit: (NameDialog) -> NameDialog) {
        dialog.value = dialog.value?.let { open -> if (open.saving) open else edit(open) }
    }
}
