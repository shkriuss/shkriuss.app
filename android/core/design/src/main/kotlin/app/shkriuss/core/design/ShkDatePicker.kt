package app.shkriuss.core.design

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerColors
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerState
import androidx.compose.material3.DisplayMode
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * A dialog for choosing a date, such as the day a task is due. It shows
 * one month at a time, with buttons for the month before and after and a
 * list of years. The pencil button switches to typing the date instead,
 * which is quicker for a date far away, such as a birthday.
 *
 * [title] says what the date is for, such as "Due date". TalkBack reads
 * it when the dialog opens, and as a heading. Under it, the chosen date
 * is shown large; TalkBack announces it when it changes. [selectedDate]
 * is the date chosen when it opens, if any; the dialog then opens on its
 * month, otherwise on this month. Days before [earliestDate] and after
 * [latestDate] cannot be chosen, and dim.
 *
 * "OK" calls [onDismissRequest], then [onDateChosen] with the date. It is
 * turned off until a date is chosen. "Cancel", a tap outside the dialog
 * and Back call only [onDismissRequest]. Stop showing the dialog there.
 *
 * It is built on Material 3's date picker, which TalkBack reads day by
 * day, such as "Thursday, March 12, 2026", and which follows the
 * language of the phone. Every day, button and year has a 48dp touch
 * target. It sits in the dialog panel of [ShkDialog], and scrolls when it
 * is taller than the window.
 *
 * The month needs 360dp, as in Material 3. In a narrower window the
 * space around the dialog shrinks first. In a window narrower than
 * 360dp, as on a phone with a large display size, the month does not fit:
 * the dialog then offers typing the date only, which fits any width.
 */
@Composable
fun ShkDatePicker(
    title: String,
    onDateChosen: (LocalDate) -> Unit,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    selectedDate: LocalDate? = null,
    earliestDate: LocalDate? = null,
    latestDate: LocalDate? = null,
) {
    val state = rememberShkDatePickerState(
        selectedDate = selectedDate,
        month = null,
        earliestDate = earliestDate,
        latestDate = latestDate,
        typing = false,
    )
    Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints {
            val monthFits = maxWidth >= PickerWidth
            // The space at the sides shrinks to let the month fit.
            val sides = if (monthFits) ((maxWidth - PickerWidth) / 2).coerceAtMost(DialogWindowMargin) else DialogWindowMargin
            DatePickerPanel(
                title = title,
                state = state,
                inWindow = true,
                monthFits = monthFits,
                onConfirm = { date ->
                    onDismissRequest()
                    onDateChosen(date)
                },
                onCancel = onDismissRequest,
                modifier = modifier.padding(horizontal = sides, vertical = DialogWindowMargin),
            )
        }
    }
}

/**
 * Draws a [ShkDatePicker] in place, without its window, for the Catalog's
 * samples (see [ShkInPlace]). It shows [month], so the samples do not
 * change with today's date, or the typed date with [typing]. Its buttons
 * do nothing. In less than 360dp it shows the typed date, as the dialog
 * does.
 */
@ShkInPlace
@Composable
fun ShkDatePickerInPlace(
    title: String,
    month: YearMonth,
    modifier: Modifier = Modifier,
    selectedDate: LocalDate? = null,
    earliestDate: LocalDate? = null,
    latestDate: LocalDate? = null,
    typing: Boolean = false,
) {
    val state = rememberShkDatePickerState(
        selectedDate = selectedDate,
        month = month,
        earliestDate = earliestDate,
        latestDate = latestDate,
        typing = typing,
    )
    BoxWithConstraints(modifier) {
        DatePickerPanel(
            title = title,
            state = state,
            inWindow = false,
            monthFits = maxWidth >= PickerWidth,
            onConfirm = {},
            onCancel = {},
            modifier = Modifier,
        )
    }
}

/**
 * The panel of a date picker: Material 3's picker with the suite's title
 * and headline, and the buttons. Without [monthFits], it shows the field
 * for typing the date and no way to switch to the month, which would be
 * cut off.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DatePickerPanel(
    title: String,
    state: DatePickerState,
    inWindow: Boolean,
    monthFits: Boolean,
    onConfirm: (LocalDate) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier,
) {
    // Material 3 squeezes the month into less than 360dp, and cuts off its
    // last days. Typing fits any width.
    if (!monthFits && state.displayMode != DisplayMode.Input) state.displayMode = DisplayMode.Input
    val selected = state.selectedDateMillis?.let(::utcMillisToDate)
    DialogPanel(
        paneTitle = if (inWindow) title else null,
        scrollable = inWindow,
        modifier = modifier.then(if (monthFits) Modifier.width(PickerWidth) else Modifier.fillMaxWidth()),
        bodyPadding = PaddingValues(0.dp),
        buttonsPadding = PickerButtonsPadding,
        buttons = { PickerButtons(confirmEnabled = selected != null, onConfirm = { selected?.let(onConfirm) }, onCancel = onCancel) },
    ) {
        // In its window, Material 3 focuses the field for typing when the
        // pencil is tapped. In place on a page, nothing takes the focus.
        DatePicker(
            state = state,
            modifier = if (inWindow) Modifier else NoKeyboardFocus,
            colors = datePickerColors(),
            title = { PickerTitle(title) },
            headline = { DateHeadline(selected) },
            showModeToggle = monthFits,
            focusRequester = if (inWindow) remember { FocusRequester() } else null,
        )
    }
}

/**
 * The chosen date, large, under the title, or "No date chosen". Material
 * 3's own headline keeps to one line, which cuts off a long date at font
 * scale 2.0; this one wraps. TalkBack reads the date in full, and
 * announces it when it changes.
 */
@Composable
private fun DateHeadline(date: LocalDate?) {
    val locale = LocalConfiguration.current.locales[0]
    val none = stringResource(R.string.shk_no_date)
    val shown = date?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) ?: none
    val spoken = date?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)) ?: none
    Text(
        text = shown,
        color = ShkTheme.colors.text,
        style = ShkTextStyle.Headline.textStyle,
        modifier = Modifier
            .padding(PickerHeadlinePadding)
            .semantics {
                contentDescription = spoken
                liveRegion = LiveRegionMode.Polite
            },
    )
}

/**
 * The title of a picker, in the label style, as in Material 3, above the
 * large value. TalkBack reads it as a heading.
 */
@Composable
internal fun PickerTitle(title: String) {
    Text(
        text = title,
        color = ShkTheme.colors.textSecondary,
        style = ShkTextStyle.Label.textStyle,
        modifier = Modifier
            .padding(PickerTitlePadding)
            .semantics { heading() },
    )
}

/** "Cancel" and "OK", the buttons of both pickers. "OK" is turned off while [confirmEnabled] is false. */
@Composable
internal fun PickerButtons(confirmEnabled: Boolean, onConfirm: () -> Unit, onCancel: () -> Unit) {
    DialogButtons {
        ShkTextButton(text = stringResource(R.string.shk_cancel), onClick = onCancel)
        ShkTextButton(text = stringResource(R.string.shk_ok), onClick = onConfirm, enabled = confirmEnabled)
    }
}

/**
 * Material 3's date picker state for the suite's arguments, which are
 * [LocalDate]s rather than Material 3's milliseconds. It opens on [month],
 * or on the month of [selectedDate], or on this month.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun rememberShkDatePickerState(
    selectedDate: LocalDate?,
    month: YearMonth?,
    earliestDate: LocalDate?,
    latestDate: LocalDate?,
    typing: Boolean,
): DatePickerState {
    val years = (earliestDate?.year ?: DatePickerDefaults.YearRange.first)..(latestDate?.year ?: DatePickerDefaults.YearRange.last)
    return rememberDatePickerState(
        initialSelectedDateMillis = selectedDate?.let(::dateToUtcMillis),
        initialDisplayedMonthMillis = (month?.atDay(1) ?: selectedDate)?.let(::dateToUtcMillis),
        yearRange = years,
        initialDisplayMode = if (typing) DisplayMode.Input else DisplayMode.Picker,
        selectableDates = DateRange(earliestDate, latestDate),
    )
}

/** The days from [earliest] to [latest], both included. Either end may be open. */
@OptIn(ExperimentalMaterial3Api::class)
private class DateRange(private val earliest: LocalDate?, private val latest: LocalDate?) : SelectableDates {
    override fun isSelectableDate(utcTimeMillis: Long): Boolean {
        val date = utcMillisToDate(utcTimeMillis)
        return (earliest == null || date >= earliest) && (latest == null || date <= latest)
    }

    override fun isSelectableYear(year: Int): Boolean =
        (earliest == null || year >= earliest.year) && (latest == null || year <= latest.year)
}

/**
 * The suite's colours for Material 3's date picker. Most come from the
 * theme. The line under the headline only separates, so it is the
 * divider colour, as [ShkDivider] is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun datePickerColors(): DatePickerColors {
    val colors = ShkTheme.colors
    return DatePickerDefaults.colors(
        containerColor = colors.surfaceHigh,
        titleContentColor = colors.textSecondary,
        headlineContentColor = colors.text,
        dividerColor = colors.divider,
    )
}

/**
 * Keeps the fields and buttons of a date picker drawn in place from taking
 * the keyboard's focus, so a sample on a page never opens the keyboard.
 */
private val NoKeyboardFocus: Modifier = Modifier.focusProperties { canFocus = false }

/** Material 3 counts a day as its first millisecond in UTC. */
private fun dateToUtcMillis(date: LocalDate): Long = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

private fun utcMillisToDate(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()

/** The width of Material 3's date picker, which its month needs. */
private val PickerWidth = 360.dp

/** Where Material 3 puts the title of a picker. */
private val PickerTitlePadding = PaddingValues(start = DialogPadding, end = ShkSpacing.Medium, top = ShkSpacing.Large)

/** Where Material 3 puts the headline of a date picker. */
private val PickerHeadlinePadding = PaddingValues(start = DialogPadding, end = ShkSpacing.Medium, bottom = ShkSpacing.Medium)

/** The space around the buttons of a picker. Material 3's picker already leaves room above them. */
internal val PickerButtonsPadding = PaddingValues(start = DialogPadding, end = DialogPadding, bottom = DialogPadding)
