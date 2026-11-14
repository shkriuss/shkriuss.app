package app.shkriuss.feature.water.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.HistoryViewModel
import app.shkriuss.feature.water.SettingsViewModel
import app.shkriuss.feature.water.WaterServices

/**
 * The four ViewModels of Water's screens, made once for the activity
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

    /** Today and History move to the new day after midnight. The activity calls it each time it comes to the front. */
    fun checkTheDay() {
        today.checkTheDay()
        history.checkTheDay()
    }

    private companion object {
        const val TODAY_KEY = "app.shkriuss.water.today"
        const val OPEN_DAY_KEY = "app.shkriuss.water.openDay"
    }
}
