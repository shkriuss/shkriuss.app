package app.shkriuss.feature.reminders.ui

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
import app.shkriuss.feature.reminders.R

/**
 * Every screen of Reminders (docs/apps/reminders/spec.md, "As in Water",
 * navigation): Upcoming, Past and Settings in a navigation bar under
 * 600dp and a rail from 600dp. Upcoming is the start screen.
 *
 * - Each destination keeps its scroll position, and each list its open
 *   form, when the user switches between them.
 * - Back from Past or Settings goes to Upcoming. A form open as a sheet
 *   closes first. Back from Upcoming leaves the app.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open forms are in the
 * [RemindersModels]. The activity puts this in `AppLockGate`, and every
 * sheet and dialog of Reminders is drawn from inside it.
 */
@Composable
fun RemindersScreens(models: RemindersModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(RemindersDestination.UPCOMING) }
    // Before the content, so that the Back of a form open in place of a list comes first.
    BackHandler(enabled = destination != RemindersDestination.UPCOMING) { destination = RemindersDestination.UPCOMING }
    val saved = rememberSaveableStateHolder()
    ShkNavigationScaffold(
        destinations = RemindersDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { destination = RemindersDestination.entries[it] },
    ) {
        saved.SaveableStateProvider(destination.name) {
            when (destination) {
                RemindersDestination.UPCOMING -> UpcomingContent(models.upcoming, models.upcomingForm)
                RemindersDestination.PAST -> PastContent(models.past, models.pastForm)
                RemindersDestination.SETTINGS -> SettingsContent(versionName)
            }
        }
    }
}

/** The three destinations of Reminders, in the order the navigation shows them. */
private enum class RemindersDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    UPCOMING(R.string.reminders_upcoming, R.drawable.reminders_icon_upcoming),
    PAST(R.string.reminders_past, R.drawable.reminders_icon_past),
    SETTINGS(R.string.reminders_settings, R.drawable.reminders_icon_settings),
}
