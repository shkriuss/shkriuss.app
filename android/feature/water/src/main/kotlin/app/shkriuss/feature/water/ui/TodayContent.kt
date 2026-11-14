package app.shkriuss.feature.water.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTonalButton
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.water.DayScreen
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.RemindersViewModel

/**
 * Today, the start screen (docs/apps/water/spec.md, "Today"): the summary,
 * the quick amounts and "Other amount", the reminder line while reminders
 * are on, and the drinks of today. One column that scrolls below 840dp;
 * from 840dp two panes side by side, each scrolling on its own, with the
 * reminder line in the start pane.
 */
@Composable
internal fun TodayContent(
    model: DayViewModel,
    reminders: RemindersViewModel,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val screen by model.state.collectAsState()
    val format = rememberWaterFormat()
    val snackbars = rememberShkSnackbarHostState()
    DaySnackbars(screen, model, snackbars, format)
    val twoPanes = windowWidth == ShkWindowWidth.Expanded
    ShkScreen(
        topBar = { ShkTopBar(title = stringResource(R.string.water_today)) },
        scrollable = !twoPanes,
        snackbarHostState = snackbars,
    ) {
        if (!screen.loaded) return@ShkScreen
        if (twoPanes) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraLarge)) {
                Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState())) {
                    DaySummary(screen, format)
                    Spacer(Modifier.height(ShkSpacing.ExtraLarge))
                    QuickAdd(screen, model, format, twoByTwo = false)
                    ReminderLineRow(reminders, format, Modifier.padding(top = ShkSpacing.Large))
                }
                Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState())) {
                    DrinkList(screen, format, onEdit = model::openEdit)
                }
            }
        } else {
            DaySummary(screen, format)
            Spacer(Modifier.height(ShkSpacing.ExtraLarge))
            QuickAdd(screen, model, format, twoByTwo = windowWidth == ShkWindowWidth.Compact)
            ReminderLineRow(reminders, format, Modifier.padding(top = ShkSpacing.Large))
            Spacer(Modifier.height(ShkSpacing.Small))
            DrinkList(screen, format, onEdit = model::openEdit)
        }
    }
    DrinkSheetHost(screen, model, format)
    NotificationQuestion(reminders)
}

/**
 * The three quick amounts, read "Add 250 millilitres", and "Other amount".
 * With [twoByTwo], two rows of two, or one row each when a button does
 * not fit in half the width, as at a large font. Otherwise one row that
 * wraps to more rows when they do not fit.
 */
@Composable
private fun QuickAdd(screen: DayScreen, model: DayViewModel, format: WaterFormat, twoByTwo: Boolean) {
    val buttons: @Composable () -> Unit = {
        screen.quickAmountsMl.forEachIndexed { index, amountMl ->
            val spoken = stringResource(R.string.water_quick_add_spoken, format.amountSpoken(amountMl, screen.unit))
            ShkFilledButton(
                text = stringResource(R.string.water_quick_add, format.amount(amountMl, screen.unit)),
                onClick = { model.addQuick(index) },
                modifier = Modifier.semantics { contentDescription = spoken },
            )
        }
        ShkTonalButton(text = stringResource(R.string.water_other_amount), onClick = model::openAdd)
    }
    if (twoByTwo) {
        TwoByTwo(buttons)
    } else {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
            verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) { buttons() }
    }
}

/**
 * Lays out its items in two columns of equal width, or in one column when
 * any item is wider than half the width, so they never squeeze their
 * text. Each item fills the width of its column.
 */
@Composable
private fun TwoByTwo(content: @Composable () -> Unit) {
    Layout(content = content) { measurables, constraints ->
        val gap = ShkSpacing.Small.roundToPx()
        val width = constraints.maxWidth
        val half = (width - gap) / 2
        val columns = if (measurables.all { it.maxIntrinsicWidth(Constraints.Infinity) <= half }) 2 else 1
        val columnWidth = if (columns == 2) half else width
        val placeables = measurables.map { it.measure(Constraints.fixedWidth(columnWidth)) }
        val rows = placeables.chunked(columns)
        val rowHeights = rows.map { row -> row.maxOf { it.height } }
        val height = rowHeights.sum() + gap * (rows.size - 1).coerceAtLeast(0)
        layout(width, height) {
            var y = 0
            rows.forEachIndexed { index, row ->
                row.forEachIndexed { column, placeable ->
                    val x = column * (columnWidth + gap)
                    placeable.placeRelative(x, y + (rowHeights[index] - placeable.height) / 2)
                }
                y += rowHeights[index] + gap
            }
        }
    }
}
