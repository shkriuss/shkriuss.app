package app.shkriuss.feature.reminders.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.shkriuss.feature.reminders.NotificationsViewModel
import app.shkriuss.feature.reminders.PastViewModel
import app.shkriuss.feature.reminders.ReminderFormViewModel
import app.shkriuss.feature.reminders.RemindersServices
import app.shkriuss.feature.reminders.UpcomingViewModel

/**
 * The ViewModels of Reminders' screens, made once for the activity
 * [owner] and kept while the phone is turned. Reminders has no navigation
 * library (ADR 0003, point 2): the three destinations and the open forms
 * are these ViewModels and the screen's saved state.
 *
 * Each list has a form of its own, so each keeps its open reminder while
 * the user is on another destination, as History in Water keeps its open
 * day.
 */
class RemindersModels(owner: ViewModelStoreOwner, services: RemindersServices) {
    /** The clock of the screens: the one source that every ViewModel observes. */
    private val now = services.now.also { it.check() }

    /** The line about notifications, the question for notifications, and a tap on a notification. */
    val notifications: NotificationsViewModel = ViewModelProvider(
        owner,
        viewModelFactory { initializer { NotificationsViewModel(services.alarms, services.repository, services.time) } },
    )[NotificationsViewModel::class.java]

    private val provider = notifications.let { asks ->
        ViewModelProvider(
            owner,
            viewModelFactory {
                initializer { UpcomingViewModel(services.repository, now) }
                initializer { PastViewModel(services.repository, now) }
                // A form outlives this object when the phone is turned, so it holds the question's ViewModel only, not this.
                initializer { ReminderFormViewModel(services.repository, services.time, now, onSaved = asks::saved) }
            },
        )
    }

    /** Upcoming. */
    val upcoming: UpcomingViewModel = provider[UpcomingViewModel::class.java]

    /** Past, with Delete all. */
    val past: PastViewModel = provider[PastViewModel::class.java]

    /** The form that Upcoming opens: a new reminder, or one of its rows. */
    val upcomingForm: ReminderFormViewModel = provider[UPCOMING_FORM_KEY, ReminderFormViewModel::class.java]

    /** The form that Past opens: one of its rows. */
    val pastForm: ReminderFormViewModel = provider[PAST_FORM_KEY, ReminderFormViewModel::class.java]

    /**
     * The clock is read again, so every screen shows what is upcoming and
     * what is past now, also if the clock or the time zone changed while
     * the app was away. The line about notifications reads their state
     * again: the user can change it in Android's settings at any moment.
     * The activity calls it each time it comes to the front.
     */
    fun check() {
        now.check()
        notifications.refresh()
    }

    private companion object {
        const val UPCOMING_FORM_KEY = "app.shkriuss.reminders.upcomingForm"
        const val PAST_FORM_KEY = "app.shkriuss.reminders.pastForm"
    }
}
