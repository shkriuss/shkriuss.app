package app.shkriuss.feature.water.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDestination
import app.shkriuss.core.design.ShkNavigationScaffold
import app.shkriuss.feature.water.R

/**
 * Every screen of Water (docs/apps/water/spec.md, "Navigation"): Today,
 * History and Settings in a navigation bar under 600dp and a rail from
 * 600dp. Today is the start screen.
 *
 * - Each destination keeps its scroll position, and History its open
 *   day, when the user switches between them.
 * - Back from History or Settings goes to Today. An open day of History
 *   closes first. Back from Today leaves the app.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open day is in the
 * [WaterModels.history]. The activity puts this in `AppLockGate`, and
 * every sheet and dialog of Water is drawn from inside it.
 */
@Composable
fun WaterScreens(models: WaterModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(WaterDestination.TODAY) }
    // Before the content, so that an open day's own Back comes first.
    BackHandler(enabled = destination != WaterDestination.TODAY) { destination = WaterDestination.TODAY }
    val saved = rememberSaveableStateHolder()
    ShkNavigationScaffold(
        destinations = WaterDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { destination = WaterDestination.entries[it] },
    ) {
        saved.SaveableStateProvider(destination.name) {
            when (destination) {
                WaterDestination.TODAY -> TodayContent(models.today)
                WaterDestination.HISTORY -> HistoryContent(models.history, models.openDay)
                WaterDestination.SETTINGS -> SettingsContent(models.settings, versionName)
            }
        }
    }
}

/** The three destinations of Water, in the order the navigation shows them. */
private enum class WaterDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    TODAY(R.string.water_today, R.drawable.water_icon_today),
    HISTORY(R.string.water_history, R.drawable.water_icon_history),
    SETTINGS(R.string.water_settings, R.drawable.water_icon_settings),
}
