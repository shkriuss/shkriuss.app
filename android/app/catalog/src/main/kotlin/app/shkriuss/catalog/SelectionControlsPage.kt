package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkCheckbox
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSwitch

/**
 * The checkbox, the switch and the radio button, each off, on, disabled
 * both ways and with a long label, then a few of each to try. Only the
 * ones under "Try it" change when tapped; the others stay in the state
 * their caption names.
 */
@Composable
fun SelectionControlsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_selection_title))
        PageIntro(stringResource(R.string.selection_intro))

        ComponentHeading(stringResource(R.string.selection_checkbox_title), stringResource(R.string.selection_checkbox_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_not_checked) { FixedCheckbox(checked = false) },
                ComponentState(R.string.state_checked) { FixedCheckbox(checked = true) },
                ComponentState(R.string.state_disabled) { FixedCheckbox(checked = false, enabled = false) },
                ComponentState(R.string.state_checked_disabled) { FixedCheckbox(checked = true, enabled = false) },
                ComponentState(R.string.state_long_label) {
                    FixedCheckbox(checked = false, text = R.string.sample_long_checkbox)
                },
                ComponentState(R.string.state_try_checkbox) { CheckboxesToTry() },
            ),
        )

        ComponentHeading(stringResource(R.string.selection_switch_title), stringResource(R.string.selection_switch_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_switch_off) { FixedSwitch(checked = false) },
                ComponentState(R.string.state_switch_on) { FixedSwitch(checked = true) },
                ComponentState(R.string.state_disabled) { FixedSwitch(checked = false, enabled = false) },
                ComponentState(R.string.state_switch_on_disabled) { FixedSwitch(checked = true, enabled = false) },
                ComponentState(R.string.state_long_label) {
                    FixedSwitch(checked = true, text = R.string.sample_long_switch)
                },
                ComponentState(R.string.state_try_switch) { SwitchesToTry() },
            ),
        )

        ComponentHeading(stringResource(R.string.selection_radio_title), stringResource(R.string.selection_radio_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_not_selected) { FixedRadioButton(R.string.sample_ounces, selected = false) },
                ComponentState(R.string.state_selected) { FixedRadioButton(R.string.sample_millilitres, selected = true) },
                ComponentState(R.string.state_disabled) {
                    FixedRadioButton(R.string.sample_ounces, selected = false, enabled = false)
                },
                ComponentState(R.string.state_selected_disabled) {
                    FixedRadioButton(R.string.sample_millilitres, selected = true, enabled = false)
                },
                ComponentState(R.string.state_long_label) {
                    FixedRadioButton(R.string.sample_long_radio, selected = false)
                },
                ComponentState(R.string.state_try_radio) { RadioButtonsToTry() },
            ),
        )
    }
}

/** A checkbox that stays in the state it is drawn in, so its caption stays true. */
@Composable
private fun FixedCheckbox(checked: Boolean, enabled: Boolean = true, @StringRes text: Int = R.string.sample_remind_me) {
    ShkCheckbox(text = stringResource(text), checked = checked, onCheckedChange = {}, enabled = enabled)
}

/** A switch that stays in the state it is drawn in, so its caption stays true. */
@Composable
private fun FixedSwitch(checked: Boolean, enabled: Boolean = true, @StringRes text: Int = R.string.sample_daily_reminder) {
    ShkSwitch(text = stringResource(text), checked = checked, onCheckedChange = {}, enabled = enabled)
}

/** A radio button that stays in the state it is drawn in, so its caption stays true. */
@Composable
private fun FixedRadioButton(@StringRes text: Int, selected: Boolean, enabled: Boolean = true) {
    ShkRadioButton(text = stringResource(text), selected = selected, onClick = {}, enabled = enabled)
}

/** Two checkboxes that check and clear when tapped, as in an app. */
@Composable
private fun CheckboxesToTry() {
    var remind by rememberSaveable { mutableStateOf(true) }
    var repeat by rememberSaveable { mutableStateOf(false) }
    Column {
        ShkCheckbox(text = stringResource(R.string.sample_remind_me), checked = remind, onCheckedChange = { remind = it })
        ShkCheckbox(
            text = stringResource(R.string.sample_repeat_weekly),
            checked = repeat,
            onCheckedChange = { repeat = it },
        )
    }
}

/** Two switches that turn on and off when tapped, as in an app. */
@Composable
private fun SwitchesToTry() {
    var reminder by rememberSaveable { mutableStateOf(true) }
    var sound by rememberSaveable { mutableStateOf(false) }
    Column {
        ShkSwitch(
            text = stringResource(R.string.sample_daily_reminder),
            checked = reminder,
            onCheckedChange = { reminder = it },
        )
        ShkSwitch(text = stringResource(R.string.sample_sound), checked = sound, onCheckedChange = { sound = it })
    }
}

/** Three units in one group. Tapping one selects it and clears the others. */
@Composable
private fun RadioButtonsToTry() {
    val units = listOf(R.string.sample_millilitres, R.string.sample_ounces, R.string.sample_cups)
    var chosen by rememberSaveable { mutableIntStateOf(0) }
    ShkRadioGroup {
        units.forEachIndexed { index, unit ->
            ShkRadioButton(text = stringResource(unit), selected = chosen == index, onClick = { chosen = index })
        }
    }
}
