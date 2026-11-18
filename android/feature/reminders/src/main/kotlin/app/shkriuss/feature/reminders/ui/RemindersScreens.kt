package app.shkriuss.feature.reminders.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.TappedReminder

/**
 * Every screen of Reminders (docs/apps/reminders/spec.md, "As in Water",
 * navigation): Upcoming, Past and Settings in a navigation bar under
 * 600dp and a rail from 600dp. Upcoming is the start screen.
 *
 * - Each destination keeps its scroll position, and each list its open
 *   form, when the user switches between them.
 * - Back from Past or Settings goes to Upcoming. A form open as a sheet
 *   closes first, and so does Licences, which Settings opens in its own
 *   place. Back from Upcoming leaves the app.
 * - A backup, a restore and the moment the recovery key is first needed
 *   are drawn once, after the destinations ([BackupFlow]), so their
 *   dialogs and the results of the file picker do not depend on which
 *   destination shows.
 *
 * A tap on a notification opens the form of its reminder on the list it
 * is in, or Upcoming if that reminder is gone (spec, "The notification",
 * point 6). The question for notifications is drawn here, over every
 * destination.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open forms are in the
 * [RemindersModels]. The activity puts this in `AppLockGate`, and every
 * sheet and dialog of Reminders is drawn from inside it.
 */
@Composable
fun RemindersScreens(models: RemindersModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(RemindersDestination.UPCOMING) }
    var licencesOpen by rememberSaveable { mutableStateOf(false) }
    val notifications by models.notifications.state.collectAsState()
    LaunchedEffect(notifications.tapped) {
        when (val tapped = notifications.tapped) {
            null -> return@LaunchedEffect
            is TappedReminder.Open -> {
                destination = if (tapped.past) RemindersDestination.PAST else RemindersDestination.UPCOMING
                (if (tapped.past) models.pastForm else models.upcomingForm).openEdit(tapped.reminder)
            }
            TappedReminder.Missing -> destination = RemindersDestination.UPCOMING
        }
        models.notifications.tapOpened()
    }
    // Before the content, so that the Back of a form open in place of a list, and that of Licences, comes first.
    BackHandler(enabled = destination != RemindersDestination.UPCOMING) { destination = RemindersDestination.UPCOMING }
    val saved = rememberSaveableStateHolder()
    val firstNeed = rememberRecoveryKeyFirstNeedState()
    ShkNavigationScaffold(
        destinations = RemindersDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { destination = RemindersDestination.entries[it] },
    ) {
        val licences = destination == RemindersDestination.SETTINGS && licencesOpen
        // Licences has a saved state of its own, so Settings keeps its scroll position under it.
        saved.SaveableStateProvider(if (licences) LICENCES_KEY else destination.name) {
            when (destination) {
                RemindersDestination.UPCOMING -> UpcomingContent(models.upcoming, models.upcomingForm, models.notifications)
                RemindersDestination.PAST -> PastContent(models.past, models.pastForm)
                RemindersDestination.SETTINGS -> if (licences) {
                    LicencesContent(onBack = { licencesOpen = false })
                } else {
                    SettingsContent(models.backup, firstNeed, versionName, onLicences = { licencesOpen = true })
                }
            }
        }
    }
    NotificationQuestion(models.notifications)
    BackupFlow(models.backup, firstNeed)
}

/** The key of the saved state of Licences. No destination has this name. */
private const val LICENCES_KEY = "licences"


/** The three destinations of Reminders, in the order the navigation shows them. */
private enum class RemindersDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    UPCOMING(R.string.reminders_upcoming, R.drawable.reminders_icon_upcoming),
    PAST(R.string.reminders_past, R.drawable.reminders_icon_past),
    SETTINGS(R.string.reminders_settings, R.drawable.reminders_icon_settings),
}
