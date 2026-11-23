package app.shkriuss.feature.tasks.ui

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
import app.shkriuss.feature.tasks.R

/**
 * Every screen of Tasks (docs/apps/tasks/spec.md, "As in Water and
 * Reminders", navigation): Today, Lists and Settings in a navigation bar
 * under 600dp and a rail from 600dp. Today is the start screen.
 *
 * - Each destination keeps its scroll position, Lists its open list, and
 *   Today and Lists each their open form, when the user switches between
 *   them.
 * - Back from Lists or Settings goes to Today. A form, a dialog or a list
 *   open in place of Lists closes first: Back from an open list goes to
 *   Lists. Back from Today leaves the app.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open list and forms are in the
 * [TasksModels]. The activity puts this in `AppLockGate`, and every sheet
 * and dialog of Tasks is drawn from inside it. [versionName] is the
 * version name of the installed app, such as `1.0.0`.
 */
@Composable
fun TasksScreens(models: TasksModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(TasksDestination.TODAY) }
    // Before the content, so that the Back of an open list, a form or a dialog comes first.
    BackHandler(enabled = destination != TasksDestination.TODAY) { destination = TasksDestination.TODAY }
    val saved = rememberSaveableStateHolder()
    ShkNavigationScaffold(
        destinations = TasksDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { destination = TasksDestination.entries[it] },
    ) {
        saved.SaveableStateProvider(destination.name) {
            when (destination) {
                TasksDestination.TODAY -> TodayContent(models.today, models.todayForm)
                TasksDestination.LISTS -> ListsContent(models.lists, models.list, models.listName, models.listForm)
                TasksDestination.SETTINGS -> SettingsContent(versionName)
            }
        }
    }
}

/** The three destinations of Tasks, in the order the navigation shows them. */
private enum class TasksDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    TODAY(R.string.tasks_today, R.drawable.tasks_icon_today),
    LISTS(R.string.tasks_lists, R.drawable.tasks_icon_lists),
    SETTINGS(R.string.tasks_settings, R.drawable.tasks_icon_settings),
}
