package app.shkriuss.feature.water.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkProgressBar
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.feature.water.DayScreen
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.Drink
import app.shkriuss.feature.water.DrinkSnackbar
import app.shkriuss.feature.water.R
import app.shkriuss.core.design.R as DesignR

/**
 * The summary of a day, on Today and on a Day of History
 * (docs/apps/water/spec.md, "Today", point 2): the total, large, the goal
 * and the percentage under it, the progress bar, and "Goal reached" with a
 * check once the total reaches the goal. TalkBack reads it as one item, so
 * the bar is not a second one.
 */
@Composable
internal fun DaySummary(screen: DayScreen, format: WaterFormat, modifier: Modifier = Modifier) {
    val spoken = format.summarySpoken(
        totalMl = screen.totalMl,
        goalMl = screen.goalMl,
        percent = screen.percent,
        unit = screen.unit,
        isToday = screen.isToday,
        goalReached = screen.goalReached,
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
    ) {
        ShkText(text = format.amount(screen.totalMl, screen.unit), style = ShkTextStyle.Headline)
        ShkText(text = format.ofGoal(screen.goalMl, screen.percent, screen.unit), color = ShkTheme.colors.textSecondary)
        ShkProgressBar(
            value = screen.totalMl / screen.goalMl.toFloat(),
            label = stringResource(R.string.water_progress_label),
            valueText = format.percentSpoken(screen.percent),
        )
        if (screen.goalReached) GoalReached()
    }
}

/**
 * The check and the words "Goal reached". The words are always there with
 * the check, so colour is never the only sign. The check is decorative,
 * and grows with the text as the icons of the design system do.
 */
@Composable
private fun GoalReached() {
    val iconSize = with(LocalDensity.current) { CHECK_SIZE.value.sp.toDp() }.coerceAtLeast(CHECK_SIZE)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
        Image(
            painter = painterResource(DesignR.drawable.shk_icon_check),
            contentDescription = null,
            modifier = Modifier.size(iconSize),
            colorFilter = ColorFilter.tint(ShkTheme.colors.success),
        )
        ShkText(text = stringResource(R.string.water_goal_reached))
    }
}

/**
 * The drinks of a day under their section header, newest first, or the
 * line that says there are none. A tap on a drink opens "Edit drink".
 * TalkBack reads each row as one item, "14:05, 250 millilitres", with the
 * action "Edit".
 */
@Composable
internal fun DrinkList(screen: DayScreen, format: WaterFormat, onEdit: (Drink) -> Unit) {
    ShkSectionHeader(stringResource(if (screen.isToday) R.string.water_drinks_today else R.string.water_drinks_of_day))
    if (screen.drinks.isEmpty()) {
        ShkText(
            text = stringResource(if (screen.isToday) R.string.water_no_drinks_today else R.string.water_no_drinks_on_day),
            color = ShkTheme.colors.textSecondary,
        )
        return
    }
    val editLabel = stringResource(R.string.water_edit)
    screen.drinks.forEach { drink ->
        key(drink.id) {
            val time = format.time(drink.minuteOfDay)
            val spoken = stringResource(R.string.water_drink_row_spoken, time, format.amountSpoken(drink.amountMl, screen.unit))
            ShkListItem(
                headline = stringResource(R.string.water_drink_row, time, format.amount(drink.amountMl, screen.unit)),
                onClick = { onEdit(drink) },
                modifier = Modifier.semantics {
                    contentDescription = spoken
                    onClick(label = editLabel) {
                        onEdit(drink)
                        true
                    }
                },
            )
        }
    }
}

/**
 * Shows the snackbar of [screen] on [host]: "Added 250 ml" or "Drink
 * deleted", each with Undo. TalkBack announces it with its action.
 */
@Composable
internal fun DaySnackbars(screen: DayScreen, model: DayViewModel, host: ShkSnackbarHostState, format: WaterFormat) {
    val snackbar = screen.snackbar
    val message = when (snackbar?.kind) {
        DrinkSnackbar.Kind.ADDED -> stringResource(R.string.water_added, format.amount(snackbar.amountMl, screen.unit))
        DrinkSnackbar.Kind.DELETED -> stringResource(R.string.water_drink_deleted)
        null -> null
    }
    val undo = stringResource(R.string.water_undo)
    LaunchedEffect(snackbar) {
        if (snackbar == null || message == null) return@LaunchedEffect
        when (host.show(message, undo)) {
            ShkSnackbarResult.ActionPerformed -> model.undo()
            ShkSnackbarResult.Dismissed -> model.snackbarDismissed()
        }
    }
}

/** The size of the check next to "Goal reached" at the default font size, that of the body text's line. */
private val CHECK_SIZE = 20.dp
