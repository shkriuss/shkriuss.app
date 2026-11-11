package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkAssistChip
import app.shkriuss.core.design.ShkFilterChip
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing

/**
 * The filter chip and the assist chip in every state. The filter chips
 * under "Try it" select and clear when tapped; the others stay in the
 * state their caption names, so the page always shows every state.
 */
@Composable
fun ChipsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_chips_title))
        PageIntro(stringResource(R.string.chips_intro))

        ComponentHeading(stringResource(R.string.chips_filter_title), stringResource(R.string.chips_filter_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_not_selected) { FixedFilterChip(R.string.sample_today, selected = false) },
                ComponentState(R.string.state_selected) { FixedFilterChip(R.string.sample_this_week, selected = true) },
                ComponentState(R.string.state_disabled) {
                    FixedFilterChip(R.string.sample_today, selected = false, enabled = false)
                },
                ComponentState(R.string.state_selected_disabled) {
                    FixedFilterChip(R.string.sample_this_week, selected = true, enabled = false)
                },
                ComponentState(R.string.state_long_label) { FixedFilterChip(R.string.sample_long_chip, selected = false) },
                ComponentState(R.string.state_try_it) { FilterChipsToTry() },
            ),
        )

        ComponentHeading(stringResource(R.string.chips_assist_title), stringResource(R.string.chips_assist_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_with_icon) { ReminderChip(R.string.sample_add_reminder, withIcon = true) },
                ComponentState(R.string.state_without_icon) {
                    ReminderChip(R.string.sample_add_reminder, withIcon = false)
                },
                ComponentState(R.string.state_disabled) {
                    ReminderChip(R.string.sample_add_reminder, withIcon = true, enabled = false)
                },
                ComponentState(R.string.state_long_label) { ReminderChip(R.string.sample_long_chip, withIcon = true) },
            ),
        )
    }
}

/** A filter chip that stays in the state it is drawn in, so its caption stays true. */
@Composable
private fun FixedFilterChip(@StringRes text: Int, selected: Boolean, enabled: Boolean = true) {
    ShkFilterChip(text = stringResource(text), selected = selected, onClick = {}, enabled = enabled)
}

/**
 * Three filter chips that select and clear when tapped, as in an app.
 * They are stacked, so they fit at every font size.
 */
@Composable
private fun FilterChipsToTry() {
    var today by rememberSaveable { mutableStateOf(false) }
    var thisWeek by rememberSaveable { mutableStateOf(true) }
    var done by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall)) {
        ShkFilterChip(text = stringResource(R.string.sample_today), selected = today, onClick = { today = !today })
        ShkFilterChip(
            text = stringResource(R.string.sample_this_week),
            selected = thisWeek,
            onClick = { thisWeek = !thisWeek },
        )
        ShkFilterChip(text = stringResource(R.string.sample_done), selected = done, onClick = { done = !done })
    }
}

/** The sample assist chip, with or without the clock icon. */
@Composable
private fun ReminderChip(@StringRes text: Int, withIcon: Boolean, enabled: Boolean = true) {
    ShkAssistChip(
        text = stringResource(text),
        onClick = {},
        enabled = enabled,
        icon = if (withIcon) painterResource(R.drawable.sample_icon_alarm) else null,
    )
}
