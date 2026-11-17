package app.shkriuss.feature.reminders.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import app.shkriuss.core.design.ShkBottomSheet
import app.shkriuss.core.design.ShkDatePicker
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkFilterChip
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTimePicker
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.feature.reminders.FormScreen
import app.shkriuss.feature.reminders.FormSnackbar
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.ReminderForm
import app.shkriuss.feature.reminders.ReminderFormViewModel
import app.shkriuss.feature.reminders.ReminderLimits
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.TitleProblem
import app.shkriuss.feature.reminders.Weekdays
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * A list of reminders with the reminder form that it opens
 * (docs/apps/reminders/spec.md, "Past", the layout by width):
 *
 * - Under 840dp, [list] alone, and the form as a bottom sheet over it.
 * - From 840dp, `ShkListDetailScaffold`: [list], 360dp wide, and the form
 *   beside it, or "Choose a reminder." while none is open.
 *
 * The snackbars of the form show on [snackbars], the host of the list's
 * screen. [today] leaves out the year of this year, and is the first day
 * the date picker offers.
 */
@Composable
internal fun ListAndForm(
    form: ReminderFormViewModel,
    today: LocalDate,
    snackbars: ShkSnackbarHostState,
    format: RemindersFormat,
    windowWidth: ShkWindowWidth,
    list: @Composable () -> Unit,
) {
    val screen by form.state.collectAsState()
    FormSnackbars(screen, form, snackbars, format, today)
    val twoPanes = windowWidth == ShkWindowWidth.Expanded
    ShkListDetailScaffold(
        // In one pane the list always shows: the form is a sheet over it.
        detailOpen = twoPanes && screen.form != null,
        onCloseDetail = form::cancel,
        list = list,
        detail = { onBack -> FormPane(screen, form, format, today, onBack) },
        windowWidth = windowWidth,
    )
    if (!twoPanes) FormSheet(screen, form, format, today)
}

/** The form beside the list, from 840dp, or "Choose a reminder." Each reminder opens at its top. */
@Composable
private fun FormPane(screen: FormScreen, model: ReminderFormViewModel, format: RemindersFormat, today: LocalDate, onBack: (() -> Unit)?) {
    val open = screen.form
    if (open == null) {
        ShkScreen { ShkEmptyState(title = stringResource(R.string.reminders_choose_a_reminder), modifier = Modifier.weight(1f)) }
        return
    }
    key(open.reminderId) {
        ShkScreen(topBar = { ShkTopBar(title = formTitle(open), onBack = onBack) }, scrollable = true) {
            FormFields(open, screen.next, model, format, today)
        }
    }
}

/** The form as a bottom sheet over the list, under 840dp. What is typed lives in the ViewModel, so it stays when the phone is turned. */
@Composable
private fun FormSheet(screen: FormScreen, model: ReminderFormViewModel, format: RemindersFormat, today: LocalDate) {
    val open = screen.form
    // The sheet slides down after it closes. Until then it shows what it showed.
    var shown by remember { mutableStateOf(open) }
    if (open != null) shown = open
    val form = shown
    ShkBottomSheet(
        visible = open != null,
        onDismissRequest = model::cancel,
        title = form?.let { formTitle(it) },
    ) {
        if (form != null) key(form.reminderId) { FormFields(form, screen.next, model, format, today) }
    }
}

/** "New reminder" or "Edit reminder". */
@Composable
private fun formTitle(form: ReminderForm): String =
    stringResource(if (form.isEdit) R.string.reminders_edit_reminder else R.string.reminders_new_reminder)

/**
 * The fields of the form, from top to bottom (spec, "The reminder form"):
 * the title, the repeat, the date or the days, the time, the line "Next",
 * and the buttons. A wrong field shows its words under it, and TalkBack
 * announces them. A new reminder starts with the keyboard on the title.
 */
@Composable
private fun FormFields(form: ReminderForm, next: LocalDateTime?, model: ReminderFormViewModel, format: RemindersFormat, today: LocalDate) {
    var picker by rememberSaveable { mutableStateOf<FormPicker?>(null) }
    val titleField = remember { FocusRequester() }
    if (!form.isEdit) LaunchedEffect(Unit) { titleField.requestFocus() }
    ShkTextField(
        value = form.title,
        onValueChange = model::onTitleChange,
        label = stringResource(R.string.reminders_title),
        errorText = form.titleError?.let { titleProblemText(it, format) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
        modifier = Modifier.focusRequester(titleField),
    )

    ShkSectionHeader(stringResource(R.string.reminders_repeat))
    ShkRadioGroup {
        Repeat.entries.forEach { repeat ->
            ShkRadioButton(text = format.repeatName(repeat), selected = form.repeat == repeat, onClick = { model.onRepeatChange(repeat) })
        }
    }

    Spacer(Modifier.height(ShkSpacing.Small))
    when (form.repeat) {
        Repeat.ONCE, Repeat.MONTHLY, Repeat.YEARLY -> ShkListItem(
            headline = stringResource(R.string.reminders_date),
            supportingText = format.date(form.date),
            onClick = { picker = FormPicker.DATE },
        )
        Repeat.WEEKLY -> DayChips(form, model, format)
        Repeat.DAILY -> Unit
    }
    ShkListItem(
        headline = stringResource(R.string.reminders_time),
        supportingText = format.time(form.time),
        onClick = { picker = FormPicker.TIME },
    )
    if (form.timeError) ErrorLine(stringResource(R.string.reminders_time_passed))
    if (next != null) {
        Spacer(Modifier.height(ShkSpacing.Small))
        ShkText(text = stringResource(R.string.reminders_next, format.dateTime(next, today)), color = ShkTheme.colors.textSecondary)
    }
    if (form.limitError) {
        Spacer(Modifier.height(ShkSpacing.Small))
        val most = ReminderLimits.MOST_REMINDERS
        ErrorLine(pluralStringResource(R.plurals.reminders_limit, most, format.number(most)))
    }

    Spacer(Modifier.height(ShkSpacing.Large))
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small, alignment = Alignment.End),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
    ) {
        if (form.isEdit) ShkTextButton(text = stringResource(R.string.reminders_delete), onClick = model::delete)
        ShkTextButton(text = stringResource(R.string.reminders_cancel), onClick = model::cancel)
        ShkFilledButton(text = stringResource(R.string.reminders_save), onClick = model::save)
    }
    Spacer(Modifier.height(ShkSpacing.Large))

    val close = { picker = null }
    when (picker) {
        FormPicker.DATE -> ShkDatePicker(
            title = stringResource(R.string.reminders_date),
            onDateChosen = model::onDateChange,
            onDismissRequest = close,
            selectedDate = form.date,
            earliestDate = today,
            latestDate = ReminderLimits.LAST_PICKER_DATE,
        )
        FormPicker.TIME -> {
            val passed = stringResource(R.string.reminders_time_passed)
            ShkTimePicker(
                title = stringResource(R.string.reminders_time),
                initialTime = form.time,
                onTimeChosen = model::onTimeChange,
                onDismissRequest = close,
                refuse = { time -> if (model.timeHasPassed(time)) passed else null },
            )
        }
        null -> Unit
    }
}

/**
 * The seven days of Every week, from the phone's first day of the week,
 * and the words under them when none is chosen. TalkBack reads each chip
 * by the whole day: "Monday, selected".
 */
@Composable
private fun DayChips(form: ReminderForm, model: ReminderFormViewModel, format: RemindersFormat) {
    ShkSectionHeader(stringResource(R.string.reminders_days))
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
    ) {
        format.week.forEach { day ->
            val chosen = Weekdays.has(form.weekdays, day)
            val spoken = format.dayName(day)
            ShkFilterChip(
                text = format.dayShort(day),
                selected = chosen,
                onClick = { model.onDayChange(day, !chosen) },
                modifier = Modifier.semantics { contentDescription = spoken },
            )
        }
    }
    if (form.daysError) ErrorLine(stringResource(R.string.reminders_choose_a_day))
    Spacer(Modifier.height(ShkSpacing.Small))
}

/** Words that refuse a field, in the error colour, under it. A live region, so TalkBack announces them when they appear. */
@Composable
private fun ErrorLine(text: String) {
    ShkText(
        text = text,
        color = ShkTheme.colors.error,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** The words under the title field: "Enter a title." or "A title has at most 200 characters." */
@Composable
private fun titleProblemText(problem: TitleProblem, format: RemindersFormat): String = when (problem) {
    TitleProblem.EMPTY -> stringResource(R.string.reminders_title_empty)
    TitleProblem.TOO_LONG -> {
        val most = ReminderLimits.MOST_TITLE_CODE_POINTS
        pluralStringResource(R.plurals.reminders_title_too_long, most, format.number(most))
    }
}

/**
 * Shows the snackbar of the form on [host]: "Reminder set for Wed 18 Nov,
 * 18:30." after a Save, or "Reminder deleted" with Undo after a Delete.
 * TalkBack announces it with its action.
 */
@Composable
private fun FormSnackbars(screen: FormScreen, model: ReminderFormViewModel, host: ShkSnackbarHostState, format: RemindersFormat, today: LocalDate) {
    val snackbar = screen.snackbar
    val message = when (snackbar) {
        is FormSnackbar.Saved -> stringResource(R.string.reminders_saved, format.dateTime(snackbar.at, today))
        is FormSnackbar.Deleted -> stringResource(R.string.reminders_deleted)
        null -> null
    }
    val undo = if (snackbar is FormSnackbar.Deleted) stringResource(R.string.reminders_undo) else null
    LaunchedEffect(snackbar) {
        if (snackbar == null || message == null) return@LaunchedEffect
        when (host.show(message, undo)) {
            ShkSnackbarResult.ActionPerformed -> model.undo()
            ShkSnackbarResult.Dismissed -> model.snackbarDismissed()
        }
    }
}

/** The pickers of the form. At most one is open; which one is kept while the phone is turned. */
private enum class FormPicker { DATE, TIME }
