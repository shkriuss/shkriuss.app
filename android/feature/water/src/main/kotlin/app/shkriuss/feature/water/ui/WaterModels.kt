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
    private val provider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { DayViewModel(services.repository, services.time) }
            initializer { HistoryViewModel(services.repository, services.time) }
            initializer { SettingsViewModel(services.repository, services.time) }
            initializer { RemindersViewModel(services.repository, services.reminders, services.time) }
            initializer { BackupViewModel(services.backups) }
        },
    )

    // The open day has a factory of its own, as the factory above makes Today's DayViewModel.
    private val openDayProvider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { DayViewModel(services.repository, services.time, fixedDay = services.time.today()) }
        },
    )

    /** Today: follows the phone's clock. */
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
     * Today and History move to the new day after midnight, and the
     * reminder line reads the state of notifications again: the user can
     * change it in Android's settings at any moment. Settings reads the
     * keys again: on the way back from a screen of `core/security` the
     * recovery key or the app lock may have changed. The activity calls it
     * each time it comes to the front.
     */
    fun checkTheDay() {
        today.checkTheDay()
        history.checkTheDay()
        reminders.refresh()
        backup.refresh()
    }

    private companion object {
        const val TODAY_KEY = "app.shkriuss.water.today"
        const val OPEN_DAY_KEY = "app.shkriuss.water.openDay"
    }
}
