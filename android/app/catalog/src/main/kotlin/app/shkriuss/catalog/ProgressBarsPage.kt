package app.shkriuss.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkProgressBar
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTonalButton

/**
 * The progress bar empty, part of the way, full and past its end, then one
 * to try. The bar cannot be moved: only the buttons under "Try it" change
 * the one there.
 */
@Composable
fun ProgressBarsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_progress_bars_title))
        PageIntro(stringResource(R.string.progress_bars_intro))

        ComponentHeading(stringResource(R.string.progress_bar_title), stringResource(R.string.progress_bar_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_progress_empty) { WaterBar(percent = 0) },
                ComponentState(R.string.state_progress_part) { WaterBar(percent = PART_WAY) },
                ComponentState(R.string.state_progress_full) { WaterBar(percent = FULL) },
                ComponentState(R.string.state_progress_past) { WaterBar(percent = PAST_THE_END) },
                ComponentState(R.string.state_try_progress) { ProgressBarToTry() },
            ),
        )
    }
}

/** A bar at [percent] of a day's water, with the percent as a line above it, as an app would show it. */
@Composable
private fun WaterBar(percent: Int) {
    val valueText = pluralStringResource(R.plurals.sample_percent_spoken, percent, percent)
    Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
        ShkText(text = stringResource(R.string.sample_percent, percent), color = ShkTheme.colors.textSecondary)
        ShkProgressBar(
            value = percent / FULL.toFloat(),
            label = stringResource(R.string.sample_water_today),
            valueText = valueText,
        )
    }
}

/** A bar that Add 10% fills, and Reset empties. */
@Composable
private fun ProgressBarToTry() {
    var percent by rememberSaveable { mutableIntStateOf(0) }
    Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Medium)) {
        WaterBar(percent = percent)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
            verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
        ) {
            ShkTonalButton(text = stringResource(R.string.sample_add_ten_percent), onClick = { percent += STEP })
            ShkTonalButton(text = stringResource(R.string.sample_reset), onClick = { percent = 0 })
        }
    }
}

private const val PART_WAY = 62
private const val FULL = 100
private const val PAST_THE_END = 130
private const val STEP = 10
