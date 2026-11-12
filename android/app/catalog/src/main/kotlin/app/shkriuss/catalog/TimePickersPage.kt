package app.shkriuss.catalog

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTimePicker
import app.shkriuss.core.design.ShkTimePickerInPlace
import app.shkriuss.core.design.ShkTonalButton
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * The time picker with the 12-hour clock and with the 24-hour clock, with
 * an impossible time it refuses, and with a long title, each drawn in
 * place. Then one to try, which opens in its window and follows the
 * phone's clock setting. Only the button under "Try it" does something
 * when tapped.
 */
@OptIn(ShkInPlace::class)
@Composable
fun TimePickersPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_time_pickers_title))
        PageIntro(stringResource(R.string.time_pickers_intro))

        val title = stringResource(R.string.sample_reminder)
        ComponentHeading(stringResource(R.string.time_picker_title), stringResource(R.string.time_picker_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_clock_12) {
                    ShkTimePickerInPlace(title = title, hour = "09", minute = "30", is24Hour = false)
                },
                ComponentState(R.string.state_clock_24) {
                    ShkTimePickerInPlace(title = title, hour = "14", minute = "45", is24Hour = true)
                },
                // 25 is no hour and 75 no minute, so both fields show an
                // error and OK is turned off.
                ComponentState(R.string.state_impossible_time) {
                    ShkTimePickerInPlace(title = title, hour = "25", minute = "75", is24Hour = true)
                },
                ComponentState(R.string.state_long_text) {
                    ShkTimePickerInPlace(
                        title = stringResource(R.string.sample_long_time_title),
                        hour = "07",
                        minute = "15",
                        is24Hour = false,
                        pm = true,
                    )
                },
                ComponentState(R.string.state_try_time) { TimePickerToTry() },
            ),
            wideColumns = 2,
            // Each panel keeps its own height, as in its window.
            equalHeights = false,
        )
    }
}

/** A button that opens the time picker, and the time chosen in it. */
@Composable
private fun TimePickerToTry() {
    var open by rememberSaveable { mutableStateOf(false) }
    var time by rememberSaveable { mutableStateOf(MorningTime) }
    val locale = LocalConfiguration.current.locales[0]
    ShkTonalButton(text = stringResource(R.string.sample_choose_time), onClick = { open = true })
    Spacer(Modifier.height(ShkSpacing.Small))
    val shown = time.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
    ShkText(text = stringResource(R.string.sample_reminder_at, shown), color = ShkTheme.colors.textSecondary)
    if (open) {
        ShkTimePicker(
            title = stringResource(R.string.sample_reminder),
            initialTime = time,
            onTimeChosen = { time = it },
            onDismissRequest = { open = false },
        )
    }
}

/** The time the picker to try starts at: 9:30 in the morning. */
private val MorningTime = LocalTime.of(9, 30)
