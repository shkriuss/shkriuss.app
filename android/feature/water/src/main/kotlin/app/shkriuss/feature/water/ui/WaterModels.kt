package app.shkriuss.feature.water.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.shkriuss.feature.water.BackupViewModel
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.HistoryViewModel
import app.shkriuss.feature.water.RemindersViewModel
import app.shkriuss.feature.water.SettingsViewModel
import app.shkriuss.feature.water.WaterServices

/**
 * The six ViewModels of Water's screens, made once for the activity
 * [owner] and kept while the phone is turned. Water has no navigation
 * library (ADR 0003, point 2): the three destinations and the open day
 * are these ViewModels and the screen's saved state.
 */
class WaterModels(owner: ViewModelStoreOwner, services: WaterServices) {
    /** Today's date: the one source that Today, History, the open day, Settings and the reminder line observe. */
    private val date = services.today.also { it.check() }

    private val provider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { DayViewModel(services.repository, services.time, date) }
            initializer { HistoryViewModel(services.repository, date) }
            initializer { SettingsViewModel(services.repository, date) }
            initializer { RemindersViewModel(services.repository, services.reminders, date) }
            initializer { BackupViewModel(services.backups) }
        },
    )

    // The open day has a factory of its own, as the factory above makes Today's DayViewModel.
    private val openDayProvider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { DayViewModel(services.repository, services.time, date, fixedDay = date.date.value) }
        },
    )

    /** Today: follows today's date. */
    val today: DayViewModel = provider[TODAY_KEY, DayViewModel::class.java]

    /** History: the list of days and which day is open. */
    val history: HistoryViewModel = provider[HistoryViewModel::class.java]

    /** The day open in History. [DayViewModel.show] moves it to the day opened. */
    val openDay: DayViewModel = openDayProvider[OPEN_DAY_KEY, DayViewModel::class.java]

    /** Settings. */
    val settings: SettingsViewModel = provider[SettingsViewModel::class.java]

    /** The reminder line of Today and Settings, and the question for notifications. */
    val reminders: RemindersViewModel = provider[RemindersViewModel::class.java]

    /** Backup and restore, and the rows "Recovery key" and "App lock" of Settings. */
    val backup: BackupViewModel = provider[BackupViewModel::class.java]

    /**
     * Today's date is read again, so every screen moves to the new day if
     * midnight passed, or the clock or the time zone changed, while the
     * app was away. The reminder line reads the state of notifications
     * again: the user can change it in Android's settings at any moment.
     * Settings reads the keys again: on the way back from a screen of
     * `core/security` the recovery key or the app lock may have changed.
     * The activity calls it each time it comes to the front.
     */
    fun checkTheDay() {
        date.check()
        reminders.refresh()
        backup.refresh()
    }

    private companion object {
        const val TODAY_KEY = "app.shkriuss.water.today"
        const val OPEN_DAY_KEY = "app.shkriuss.water.openDay"
    }
}
