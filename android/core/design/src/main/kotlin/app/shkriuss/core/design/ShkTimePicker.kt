package app.shkriuss.core.design

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.text.DateFormatSymbols
import java.time.LocalTime

/**
 * A dialog for choosing a time of day, such as when a reminder rings. It
 * has a field for the hour and one for the minute, with large numbers and
 * the number keyboard. It follows the phone's "Use 24-hour format"
 * setting: with the 12-hour clock, a choice of AM or PM sits under the
 * fields.
 *
 * [title] says what the time is for, such as "Reminder". TalkBack reads
 * it when the dialog opens, and as a heading. The fields start at
 * [initialTime]. TalkBack reads each field with its label, its number and
 * the range it takes, such as "Hour, 09, from 1 to 12", and AM and PM as
 * radio buttons in one group.
 *
 * Only digits can be typed, two at most. An hour or a minute out of range,
 * such as 25 or 61, is refused with an error under its field, which
 * TalkBack reads as the field's error, and "OK" turns off until it is
 * fixed. "OK" also stays off while a field is empty.
 *
 * "OK" calls [onDismissRequest], then [onTimeChosen] with the time.
 * "Cancel", a tap outside the dialog and Back call only
 * [onDismissRequest]. Stop showing the dialog there.
 *
 * It is built from the suite's own parts, not Material 3's time picker,
 * whose AM and PM buttons are 40dp tall and whose clock face puts the
 * touch targets of its numbers on top of each other (owner decision on
 * this batch). Every field, button and choice has a 48dp touch target.
 * It sits in the dialog panel of [ShkDialog], is 280 to 560dp wide, and
 * scrolls when it is taller than the window.
 */
@Composable
fun ShkTimePicker(
    title: String,
    initialTime: LocalTime,
    onTimeChosen: (LocalTime) -> Unit,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    var hour by rememberSaveable { mutableStateOf(hourText(initialTime, is24Hour)) }
    var minute by rememberSaveable { mutableStateOf(twoDigits(initialTime.minute)) }
    var pm by rememberSaveable { mutableStateOf(initialTime.hour >= NOON) }
    Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        TimePickerPanel(
            title = title,
            fields = TimeFields(hour = hour, minute = minute, pm = pm, is24Hour = is24Hour),
            onHourChange = { hour = it },
            onMinuteChange = { minute = it },
            onPmChange = { pm = it },
            inWindow = true,
            onConfirm = { time ->
                onDismissRequest()
                onTimeChosen(time)
            },
            onCancel = onDismissRequest,
            modifier = modifier.padding(DialogWindowMargin),
        )
    }
}

/**
 * Draws a [ShkTimePicker] in place, without its window, for the Catalog's
 * samples (see [ShkInPlace]). It shows [hour] and [minute] as typed, so a
 * sample can show an impossible time, and [is24Hour] picks the clock, so
 * the samples do not change with the phone's setting. With the 12-hour
 * clock, [pm] picks PM. Nothing in it changes: the fields keep their
 * text, and its buttons do nothing.
 */
@ShkInPlace
@Composable
fun ShkTimePickerInPlace(
    title: String,
    hour: String,
    minute: String,
    is24Hour: Boolean,
    modifier: Modifier = Modifier,
    pm: Boolean = false,
) {
    TimePickerPanel(
        title = title,
        fields = TimeFields(hour = hour, minute = minute, pm = pm, is24Hour = is24Hour),
        onHourChange = {},
        onMinuteChange = {},
        onPmChange = {},
        inWindow = false,
        onConfirm = {},
        onCancel = {},
        modifier = modifier,
    )
}

/**
 * What a time picker shows: the hour and the minute as typed, AM or PM,
 * and which clock. It works out the time they make, if any, and what is
 * wrong with each field. It exists apart from the panel so the rules can
 * be tested without drawing anything.
 */
internal class TimeFields(val hour: String, val minute: String, val pm: Boolean, val is24Hour: Boolean) {
    /** The smallest and largest hour the clock takes: 0 to 23, or 1 to 12. */
    val hourRange: IntRange = if (is24Hour) 0..23 else 1..12

    /** True when the hour is typed and out of range. An empty field is not an error, but makes no time. */
    val hourIsWrong: Boolean = hour.isNotEmpty() && hour.toInt() !in hourRange

    /** True when the minute is typed and out of range. */
    val minuteIsWrong: Boolean = minute.isNotEmpty() && minute.toInt() !in MinuteRange

    /** The time the fields make, or null while a field is empty or wrong. */
    val time: LocalTime?
        get() {
            if (hour.isEmpty() || minute.isEmpty() || hourIsWrong || minuteIsWrong) return null
            val typed = hour.toInt()
            val hourOfDay = if (is24Hour) typed else typed % HOURS_ON_A_CLOCK + if (pm) NOON else 0
            return LocalTime.of(hourOfDay, minute.toInt())
        }

    companion object {
        /** The minutes of an hour. */
        val MinuteRange: IntRange = 0..59

        /**
         * What a field keeps of what was typed: [typed] if it is at most two
         * digits, else the [current] text. So letters, signs and a third
         * digit are refused as they are typed.
         */
        fun accept(current: String, typed: String): String =
            if (typed.length <= 2 && typed.all { it in '0'..'9' }) typed else current
    }
}

/** The panel of a time picker: the title, the two fields, AM and PM, and the buttons. */
@Composable
private fun TimePickerPanel(
    title: String,
    fields: TimeFields,
    onHourChange: (String) -> Unit,
    onMinuteChange: (String) -> Unit,
    onPmChange: (Boolean) -> Unit,
    inWindow: Boolean,
    onConfirm: (LocalTime) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier,
) {
    val time = fields.time
    DialogPanel(
        paneTitle = if (inWindow) title else null,
        scrollable = inWindow,
        modifier = modifier.sizeIn(minWidth = TimePickerMinWidth, maxWidth = TimePickerMaxWidth),
        bodyPadding = PaddingValues(start = DialogPadding, top = DialogPadding, end = DialogPadding),
        buttonsPadding = PaddingValues(DialogPadding),
        buttons = { PickerButtons(confirmEnabled = time != null, onConfirm = { time?.let(onConfirm) }, onCancel = onCancel) },
    ) {
        ShkText(
            text = title,
            style = ShkTextStyle.Title,
            color = ShkTheme.colors.text,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(ShkSpacing.ExtraLarge))
        Row(horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Large)) {
            NumberField(
                value = fields.hour,
                onValueChange = { onHourChange(TimeFields.accept(fields.hour, it)) },
                label = stringResource(R.string.shk_hour),
                range = fields.hourRange,
                errorText = if (fields.hourIsWrong) {
                    stringResource(R.string.shk_hour_error, fields.hourRange.first, fields.hourRange.last)
                } else {
                    null
                },
                imeAction = ImeAction.Next,
                modifier = Modifier.weight(1f),
            )
            NumberField(
                value = fields.minute,
                onValueChange = { onMinuteChange(TimeFields.accept(fields.minute, it)) },
                label = stringResource(R.string.shk_minute),
                range = TimeFields.MinuteRange,
                errorText = if (fields.minuteIsWrong) {
                    stringResource(R.string.shk_minute_error, TimeFields.MinuteRange.first, TimeFields.MinuteRange.last)
                } else {
                    null
                },
                imeAction = ImeAction.Done,
                modifier = Modifier.weight(1f),
            )
        }
        if (!fields.is24Hour) {
            Spacer(Modifier.height(ShkSpacing.Large))
            AmOrPm(pm = fields.pm, onPmChange = onPmChange)
        }
    }
}

/**
 * The field of the hour or of the minute: a [ShkTextField] with large
 * numbers, the number keyboard, and the range it takes under it, which
 * an error replaces.
 */
@Composable
private fun NumberField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    range: IntRange,
    errorText: String?,
    imeAction: ImeAction,
    modifier: Modifier,
) {
    TextFieldInStyle(
        value = value,
        onValueChange = onValueChange,
        label = label,
        textStyle = ShkTextStyle.Headline,
        modifier = modifier,
        supportingText = stringResource(R.string.shk_number_range, range.first, range.last),
        errorText = errorText,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction),
    )
}

/**
 * AM and PM, as two radio buttons in one group, each a row 48dp tall.
 * Their words are the phone's own, so they follow its language.
 */
@Composable
private fun AmOrPm(pm: Boolean, onPmChange: (Boolean) -> Unit) {
    val words = DateFormatSymbols.getInstance(LocalConfiguration.current.locales[0]).amPmStrings
    ShkRadioGroup {
        ShkRadioButton(text = words[0], selected = !pm, onClick = { onPmChange(false) })
        ShkRadioButton(text = words[1], selected = pm, onClick = { onPmChange(true) })
    }
}

/** The hour of [time] as the field first shows it: two digits, from 1 to 12 on the 12-hour clock. */
private fun hourText(time: LocalTime, is24Hour: Boolean): String {
    val hour = if (is24Hour) time.hour else (time.hour % HOURS_ON_A_CLOCK).let { if (it == 0) HOURS_ON_A_CLOCK else it }
    return twoDigits(hour)
}

/** [number] with a leading zero below 10, as a clock shows it. */
private fun twoDigits(number: Int): String = number.toString().padStart(2, '0')

/** The hours on the face of a 12-hour clock. */
private const val HOURS_ON_A_CLOCK = 12

/** The first hour of the afternoon, 12:00, on the 24-hour clock. */
private const val NOON = 12

/** The narrowest a time picker gets, as a dialog does. */
private val TimePickerMinWidth = 280.dp

/** The widest a time picker gets, as a dialog does. */
private val TimePickerMaxWidth = 560.dp
