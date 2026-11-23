package app.shkriuss.feature.tasks.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.shkriuss.feature.tasks.ListNameViewModel
import app.shkriuss.feature.tasks.ListViewModel
import app.shkriuss.feature.tasks.ListsViewModel
import app.shkriuss.feature.tasks.TaskFormViewModel
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.TodayViewModel

/**
 * The ViewModels of Tasks' screens, made once for the activity [owner]
 * and kept while the phone is turned. Tasks has no navigation library
 * (ADR 0003, point 2): the three destinations, the open list and the open
 * forms are these ViewModels and the screen's saved state.
 *
 * Today and Lists each have a form of their own, so each keeps its open
 * task while the user is on another destination, as each list of
 * Reminders keeps its open reminder.
 */
class TasksModels(owner: ViewModelStoreOwner, services: TasksServices) {
    /** The clock of the screens: the one source that every ViewModel observes. */
    private val now = services.now.also { it.check() }

    private val provider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { TodayViewModel(services.repository, services.time, now) }
            initializer { ListsViewModel(services.repository, now) }
            initializer { ListViewModel(services.repository, services.time, now) }
            initializer { ListNameViewModel(services.repository) }
            initializer { TaskFormViewModel(services.repository, services.time, now) }
        },
    )

    /** Today, with its two sections. */
    val today: TodayViewModel = provider[TodayViewModel::class.java]

    /** Lists: Inbox and every list, with their counts of open tasks. */
    val lists: ListsViewModel = provider[ListsViewModel::class.java]

    /** The open list, or Inbox, with its menu and its questions. */
    val list: ListViewModel = provider[ListViewModel::class.java]

    /** The dialog of **New list** and **Rename**. */
    val listName: ListNameViewModel = provider[ListNameViewModel::class.java]

    /** The form that Today opens: a new task due today, or one of its rows. */
    val todayForm: TaskFormViewModel = provider[TODAY_FORM_KEY, TaskFormViewModel::class.java]

    /** The form that a list opens: a new task in it, or one of its rows. */
    val listForm: TaskFormViewModel = provider[LIST_FORM_KEY, TaskFormViewModel::class.java]

    /**
     * The clock is read again, so every screen shows what is overdue and
     * what is due today now, also if the clock, the time zone or the
     * phone's language changed while the app was away. The activity calls
     * it each time it comes to the front.
     */
    fun check() {
        now.check()
    }

    private companion object {
        const val TODAY_FORM_KEY = "app.shkriuss.tasks.todayForm"
        const val LIST_FORM_KEY = "app.shkriuss.tasks.listForm"
    }
}
