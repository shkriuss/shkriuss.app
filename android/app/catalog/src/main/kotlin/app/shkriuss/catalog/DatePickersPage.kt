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
import app.shkriuss.core.design.ShkDatePicker
import app.shkriuss.core.design.ShkDatePickerInPlace
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTonalButton
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * The date picker with nothing chosen, with a date chosen, with an
 * earliest and a latest date, typing the date, and with a long title,
 * each drawn in place on March 2026, a month that does not change with
 * today's date. Then one to try, which opens in its window. Material 3
 * keeps the picker's state inside it, so the days of the samples respond
 * to taps; their buttons do nothing.
 */
@OptIn(ShkInPlace::class)
@Composable
fun DatePickersPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_date_pickers_title))
        PageIntro(stringResource(R.string.date_pickers_intro))

        val title = stringResource(R.string.sample_due_date)
        ComponentHeading(stringResource(R.string.date_picker_title), stringResource(R.string.date_picker_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_no_date) {
                    ShkDatePickerInPlace(title = title, month = SampleMonth)
                },
                ComponentState(R.string.state_date_chosen) {
                    ShkDatePickerInPlace(title = title, month = SampleMonth, selectedDate = SampleDate)
                },
                ComponentState(R.string.state_date_range) {
                    ShkDatePickerInPlace(
                        title = title,
                        month = SampleMonth,
                        selectedDate = SampleDate,
                        earliestDate = SampleDate.minusDays(3),
                        latestDate = SampleDate.plusDays(8),
                    )
                },
                ComponentState(R.string.state_typing_date) {
                    ShkDatePickerInPlace(title = title, month = SampleMonth, selectedDate = SampleDate, typing = true)
                },
                ComponentState(R.string.state_long_text) {
                    ShkDatePickerInPlace(
                        title = stringResource(R.string.sample_long_date_title),
                        month = SampleMonth,
                        selectedDate = SampleDate,
                    )
                },
                ComponentState(R.string.state_try_date) { DatePickerToTry() },
            ),
            wideColumns = 2,
            // Material 3's months are a list that scrolls sideways.
            equalHeights = false,
        )
    }
}

/**
 * A button that opens the date picker, and the due date chosen in it. It
 * starts on [SampleDate], so the picker opens on the same month every
 * day.
 */
@Composable
private fun DatePickerToTry() {
    var open by rememberSaveable { mutableStateOf(false) }
    var due by rememberSaveable { mutableStateOf(SampleDate) }
    val locale = LocalConfiguration.current.locales[0]
    ShkTonalButton(text = stringResource(R.string.sample_choose_due_date), onClick = { open = true })
    Spacer(Modifier.height(ShkSpacing.Small))
    val shown = due.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale))
    ShkText(text = stringResource(R.string.sample_due_on, shown), color = ShkTheme.colors.textSecondary)
    if (open) {
        ShkDatePicker(
            title = stringResource(R.string.sample_due_date),
            selectedDate = due,
            onDateChosen = { due = it },
            onDismissRequest = { open = false },
        )
    }
}

/** The month every sample shows. It is in the past, so no day of it is marked as today. */
private val SampleMonth = YearMonth.of(2026, 3)

/** The date chosen in the samples. */
private val SampleDate = LocalDate.of(2026, 3, 12)
