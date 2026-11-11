package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSlider
import kotlin.math.roundToInt

/**
 * The slider without steps, with steps, disabled, and with a label long
 * enough to wrap, then one to try. Only the one under "Try it" moves; the
 * others snap back to the value their caption names.
 */
@Composable
fun SlidersPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_sliders_title))
        PageIntro(stringResource(R.string.sliders_intro))

        ComponentHeading(stringResource(R.string.slider_title), stringResource(R.string.slider_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_without_steps) { VolumeSlider() },
                ComponentState(R.string.state_with_steps) { GoalSlider(glasses = FIXED_GOAL, onChange = {}) },
                ComponentState(R.string.state_disabled) {
                    GoalSlider(glasses = FIXED_GOAL, onChange = {}, enabled = false)
                },
                ComponentState(R.string.state_long_label) {
                    GoalSlider(glasses = FIXED_GOAL, onChange = {}, label = R.string.sample_long_slider)
                },
                ComponentState(R.string.state_try_slider) { SliderToTry() },
            ),
        )
    }
}

/** A volume slider without steps, at 40 percent. */
@Composable
private fun VolumeSlider() {
    val volume = 0.4f
    ShkSlider(
        label = stringResource(R.string.sample_volume),
        value = volume,
        onValueChange = {},
        valueText = stringResource(R.string.sample_percent, (volume * 100).roundToInt()),
    )
}

/**
 * A daily goal of one to twelve glasses, in whole glasses. [glasses] is
 * the goal now; [onChange] gets the new one.
 */
@Composable
private fun GoalSlider(
    glasses: Int,
    onChange: (Int) -> Unit,
    enabled: Boolean = true,
    @StringRes label: Int = R.string.sample_daily_goal,
) {
    ShkSlider(
        label = stringResource(label),
        value = glasses.toFloat(),
        onValueChange = { onChange(it.roundToInt()) },
        valueText = pluralStringResource(R.plurals.sample_glasses, glasses, glasses),
        enabled = enabled,
        valueRange = MIN_GOAL.toFloat()..MAX_GOAL.toFloat(),
        // A step for every whole glass between the two ends.
        steps = MAX_GOAL - MIN_GOAL - 1,
    )
}

/** The daily goal slider, moving as in an app. */
@Composable
private fun SliderToTry() {
    var glasses by rememberSaveable { mutableIntStateOf(FIXED_GOAL) }
    GoalSlider(glasses = glasses, onChange = { glasses = it })
}

private const val MIN_GOAL = 1
private const val MAX_GOAL = 12
private const val FIXED_GOAL = 8
