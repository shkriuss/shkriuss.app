package app.shkriuss.feature.water.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTonalButton
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.HistoryDay
import app.shkriuss.feature.water.HistoryScreen
import app.shkriuss.feature.water.HistoryViewModel
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.WaterUnit
import app.shkriuss.core.design.R as DesignR
import java.time.LocalDate

/**
 * History (docs/apps/water/spec.md, "History"): one row per day, newest
 * first, and the open [Day][DayContent]. Below 840dp a tap opens the day
 * in place of the list, with Back; from 840dp the day opens beside the
 * list. The open day stays open while the user is on another destination.
 */
@Composable
internal fun HistoryContent(
    history: HistoryViewModel,
    openDay: DayViewModel,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val screen by history.state.collectAsState()
    val format = rememberWaterFormat()
    ShkListDetailScaffold(
        detailOpen = screen.openDay != null,
        onCloseDetail = history::close,
        list = {
            HistoryList(screen, format) { day ->
                openDay.show(day)
                history.open(day)
            }
        },
        detail = { onBack ->
            val day = screen.openDay
            if (day == null) {
                ShkScreen { ShkEmptyState(title = stringResource(R.string.water_choose_a_day), modifier = Modifier.weight(1f)) }
            } else {
                key(day) { DayContent(openDay, day, isToday = day == screen.today, onBack = onBack) }
            }
        },
        windowWidth = windowWidth,
    )
}

/** The list of days, or the line that says there is no history yet. */
@Composable
private fun HistoryList(screen: HistoryScreen, format: WaterFormat, onOpen: (LocalDate) -> Unit) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.water_history)) }) {
        if (!screen.loaded) return@ShkScreen
        if (screen.isEmpty) {
            ShkEmptyState(
                title = stringResource(R.string.water_history_empty_title),
                body = stringResource(R.string.water_history_empty_body),
                modifier = Modifier.weight(1f),
            )
            return@ShkScreen
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(screen.days, key = { it.day.toEpochDay() }) { row ->
                DayRow(row, screen.today, screen.unit, format, selected = row.day == screen.openDay) { onOpen(row.day) }
            }
        }
    }
}

/**
 * One day of History: its name, "1,800 of 2,000 ml" under it, and at the
 * end, when the goal was met, "Goal reached" with a check. TalkBack reads
 * it as one item: "Thursday 12 November, 1,800 of 2,000 millilitres, goal
 * reached".
 */
@Composable
private fun DayRow(row: HistoryDay, today: LocalDate, unit: WaterUnit, format: WaterFormat, selected: Boolean, onClick: () -> Unit) {
    val total = format.quantity(row.totalMl, unit)
    val spokenRow = stringResource(
        R.string.water_day_row_spoken,
        format.dayNameSpoken(row.day, today),
        total,
        format.amountSpoken(row.goalMl, unit),
    )
    val spoken = if (row.goalReached) stringResource(R.string.water_day_row_goal_reached_spoken, spokenRow) else spokenRow
    ShkListItem(
        headline = format.dayName(row.day, today),
        supportingText = stringResource(R.string.water_day_total, total, format.amount(row.goalMl, unit)),
        trailingText = if (row.goalReached) stringResource(R.string.water_goal_reached) else null,
        trailingIcon = if (row.goalReached) painterResource(DesignR.drawable.shk_icon_check) else null,
        onClick = onClick,
        selected = selected,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}

/**
 * One day from History, today included (docs/apps/water/spec.md, "Day"):
 * the full date, the summary with the goal that day had, "Add a drink",
 * and its drinks, with the same sheet and snackbars as Today.
 *
 * [day] is the day History opened. The title is always that day's, and
 * the rest shows only once [model] holds that day's drinks, so nothing of
 * the day open before shows in its place, not even for one frame.
 */
@Composable
internal fun DayContent(model: DayViewModel, day: LocalDate, isToday: Boolean, onBack: (() -> Unit)?) {
    val screen by model.state.collectAsState()
    val format = rememberWaterFormat()
    val snackbars = rememberShkSnackbarHostState()
    DaySnackbars(screen, model, snackbars, format)
    ShkScreen(
        topBar = { ShkTopBar(title = format.dayTitle(day, isToday), onBack = onBack) },
        scrollable = true,
        snackbarHostState = snackbars,
    ) {
        if (!screen.loaded || screen.day != day) return@ShkScreen
        DaySummary(screen, format)
        Spacer(Modifier.height(ShkSpacing.ExtraLarge))
        ShkTonalButton(text = stringResource(R.string.water_add_drink), onClick = model::openAdd)
        Spacer(Modifier.height(ShkSpacing.Small))
        DrinkList(screen, format, onEdit = model::openEdit)
    }
    DrinkSheetHost(screen, model, format)
}
