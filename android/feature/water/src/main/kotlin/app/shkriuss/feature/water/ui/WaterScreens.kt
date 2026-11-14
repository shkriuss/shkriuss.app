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
import app.shkriuss.core.security.rememberRecoveryKeyFirstNeedState
import app.shkriuss.feature.water.R

/**
 * Every screen of Water (docs/apps/water/spec.md, "Navigation"): Today,
 * History and Settings in a navigation bar under 600dp and a rail from
 * 600dp. Today is the start screen.
 *
 * - Each destination keeps its scroll position, and History its open
 *   day, when the user switches between them.
 * - Back from History or Settings goes to Today. An open day of History
 *   closes first, and so does Licences, which Settings opens in its own
 *   place. Back from Today leaves the app.
 * - A backup, a restore and the moment the recovery key is first needed
 *   are drawn once, after the destinations ([BackupFlow]), so their
 *   dialogs and the results of the file picker do not depend on which
 *   destination shows.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open day is in the
 * [WaterModels.history]. The activity puts this in `AppLockGate`, and
 * every sheet and dialog of Water is drawn from inside it.
 */
@Composable
fun WaterScreens(models: WaterModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(WaterDestination.TODAY) }
    var licencesOpen by rememberSaveable { mutableStateOf(false) }
    // Before the content, so that an open day's own Back, and that of Licences, comes first.
    BackHandler(enabled = destination != WaterDestination.TODAY) { destination = WaterDestination.TODAY }
    val saved = rememberSaveableStateHolder()
    val firstNeed = rememberRecoveryKeyFirstNeedState()
    ShkNavigationScaffold(
        destinations = WaterDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { destination = WaterDestination.entries[it] },
    ) {
        val licences = destination == WaterDestination.SETTINGS && licencesOpen
        // Licences has a saved state of its own, so Settings keeps its scroll position under it.
        saved.SaveableStateProvider(if (licences) LICENCES_KEY else destination.name) {
            when (destination) {
                WaterDestination.TODAY -> TodayContent(models.today, models.reminders)
                WaterDestination.HISTORY -> HistoryContent(models.history, models.openDay)
                WaterDestination.SETTINGS -> if (licences) {
                    LicencesContent(onBack = { licencesOpen = false })
                } else {
                    SettingsContent(
                        model = models.settings,
                        reminders = models.reminders,
                        backup = models.backup,
                        firstNeed = firstNeed,
                        versionName = versionName,
                        onLicences = { licencesOpen = true },
                    )
                }
            }
        }
    }
    BackupFlow(models.backup, firstNeed)
}

/** The key of the saved state of Licences. No destination has this name. */
private const val LICENCES_KEY = "licences"

/** The three destinations of Water, in the order the navigation shows them. */
private enum class WaterDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    TODAY(R.string.water_today, R.drawable.water_icon_today),
    HISTORY(R.string.water_history, R.drawable.water_icon_history),
    SETTINGS(R.string.water_settings, R.drawable.water_icon_settings),
}
