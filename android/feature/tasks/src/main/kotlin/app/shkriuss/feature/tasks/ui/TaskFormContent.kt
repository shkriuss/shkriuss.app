package app.shkriuss.feature.tasks.ui

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
import app.shkriuss.core.design.ShkCheckbox
import app.shkriuss.core.design.ShkDatePicker
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkFilterChip
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTimePicker
import app.shkriuss.feature.tasks.FormScreen
import app.shkriuss.feature.tasks.INBOX
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskForm
import app.shkriuss.feature.tasks.TaskFormViewModel
import app.shkriuss.feature.tasks.TaskLimits
import app.shkriuss.feature.tasks.TextProblem
import app.shkriuss.feature.tasks.Weekdays
import java.time.LocalDate

/**
 * The task form, a bottom sheet over the screen that opened it, at every
 * width (docs/apps/tasks/spec.md, "The task form"): "New task" or "Edit
 * task". What is typed lives in the ViewModel, so it stays when the phone
 * is turned. A swipe down, a tap above it and Back close it, as Cancel
 * does. [today] is the first day the date picker offers.
 *
 * While the database cannot be read, the sheet says so, with Cancel.
 */
@Composable
internal fun TaskFormSheet(model: TaskFormViewModel, today: LocalDate, format: TasksFormat) {
    val screen by model.state.collectAsState()
    // The sheet slides down after it closes. Until then it shows what it showed.
    var shown by remember { mutableStateOf(screen) }
    if (screen.form != null) shown = screen
    val form = shown.form
    ShkBottomSheet(
        visible = screen.form != null,
        onDismissRequest = model::dismissSheet,
        title = form?.let { stringResource(if (it.isEdit) R.string.tasks_edit_task else R.string.tasks_new_task) },
    ) {
        if (form == null) return@ShkBottomSheet
        key(shown.opening) {
            if (shown.failed) {
                ShkErrorState(
                    title = stringResource(R.string.tasks_could_not_open),
                    action = ShkStateAction(stringResource(R.string.tasks_cancel), model::cancel),
                )
            } else {
                FormFields(form, shown, model, format, today)
            }
        }
    }
}

/**
 * The fields of the form, from top to bottom: the title, the list, the
 * due date, and with a due date the repeat, its days and dates, and the
 * reminder; for a done task when it was done; and the buttons. A wrong
 * field shows its words under it, and TalkBack announces them. A new task
 * starts with the keyboard on the title. The keyboard is asked not to
 * learn the title.
 */
@Composable
private fun FormFields(form: TaskForm, screen: FormScreen, model: TaskFormViewModel, format: TasksFormat, today: LocalDate) {
    var open by rememberSaveable { mutableStateOf<FormPart?>(null) }
    val titleField = remember { FocusRequester() }
    if (!form.isEdit) LaunchedEffect(Unit) { titleField.requestFocus() }
    ShkTextField(
        value = form.title,
        onValueChange = model::onTitleChange,
        label = stringResource(R.string.tasks_title),
        errorText = form.titleError?.let { titleProblemText(it, format) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
        modifier = Modifier.focusRequester(titleField),
        // The title is the user's own text: the keyboard is asked not to learn it (spec, "The task form", point 1).
        keyboardLearns = false,
    )

    Spacer(Modifier.height(ShkSpacing.Small))
    FieldItem(
        name = stringResource(R.string.tasks_list),
        value = screen.list?.name ?: stringResource(R.string.tasks_inbox),
        onClick = { open = FormPart.LIST },
    )
    DueDate(form, format, onPick = { open = FormPart.DATE }, onRemove = model::removeDate)

    if (form.date != null) {
        ShkSectionHeader(stringResource(R.string.tasks_repeat))
        ShkRadioGroup {
            Repeat.entries.forEach { repeat ->
                ShkRadioButton(text = format.repeatName(repeat), selected = form.repeat == repeat, onClick = { model.onRepeatChange(repeat) })
            }
        }
        if (form.repeat == Repeat.WEEKLY) DayChips(form, model, format)
        if (screen.dates.isNotEmpty()) {
            Spacer(Modifier.height(ShkSpacing.Small))
            ShkText(text = format.dates(screen.dates, today), color = ShkTheme.colors.textSecondary)
        }

        Spacer(Modifier.height(ShkSpacing.Large))
        ShkCheckbox(text = stringResource(R.string.tasks_remind_me), checked = form.remind, onCheckedChange = model::onRemindChange)
        form.remindTime?.let { time ->
            FieldItem(name = stringResource(R.string.tasks_time), value = format.time(time), onClick = { open = FormPart.TIME })
        }
        if (form.timeError) ErrorLine(stringResource(R.string.tasks_time_passed))
    }

    screen.doneOn?.let { day ->
        Spacer(Modifier.height(ShkSpacing.Small))
        ShkText(text = stringResource(R.string.tasks_form_done_on, format.day(day, today)), color = ShkTheme.colors.textSecondary)
    }
    if (form.limitError) {
        Spacer(Modifier.height(ShkSpacing.Small))
        val most = TaskLimits.MOST_TASKS
        ErrorLine(pluralStringResource(R.plurals.tasks_tasks_limit, most, format.number(most)))
    }
    if (form.saveFailed) {
        Spacer(Modifier.height(ShkSpacing.Small))
        ErrorLine(stringResource(R.string.tasks_task_not_saved))
    }

    Spacer(Modifier.height(ShkSpacing.Large))
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small, alignment = Alignment.End),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
    ) {
        if (form.isEdit) ShkTextButton(text = stringResource(R.string.tasks_delete), onClick = model::delete)
        ShkTextButton(text = stringResource(R.string.tasks_cancel), onClick = model::cancel)
        ShkFilledButton(text = stringResource(R.string.tasks_save), onClick = model::save)
    }
    Spacer(Modifier.height(ShkSpacing.Large))

    val close = { open = null }
    when (open) {
        FormPart.LIST -> ListDialog(screen, model, onClose = close)
        FormPart.DATE -> ShkDatePicker(
            title = stringResource(R.string.tasks_due_date),
            onDateChosen = model::onDateChange,
            onDismissRequest = close,
            // A due date before today cannot be chosen again. The picker then opens
            // on this month with no date chosen, and the form keeps its date until
            // one is ("An earlier due date stays until it is changed").
            selectedDate = form.date?.takeIf { it in today..TaskLimits.LAST_PICKER_DATE },
            earliestDate = today,
            latestDate = TaskLimits.LAST_PICKER_DATE,
        )
        FormPart.TIME -> form.remindTime?.let { time ->
            val passed = stringResource(R.string.tasks_time_passed)
            ShkTimePicker(
                title = stringResource(R.string.tasks_time),
                initialTime = time,
                onTimeChosen = model::onTimeChange,
                onDismissRequest = close,
                refuse = { picked -> if (model.timeHasPassed(picked)) passed else null },
            )
        }
        null -> Unit
    }
}

/**
 * The due date: "No due date" and **Add a due date**, or "Mon 16 Nov 2026"
 * and **Remove**. A tap on the date, or on Add a due date, opens the date
 * picker ([onPick]). Remove also removes the repeat and the reminder.
 */
@Composable
private fun DueDate(form: TaskForm, format: TasksFormat, onPick: () -> Unit, onRemove: () -> Unit) {
    val name = stringResource(R.string.tasks_due_date)
    val date = form.date
    if (date == null) {
        FieldItem(name = name, value = stringResource(R.string.tasks_no_due_date), onClick = null)
        ShkTextButton(text = stringResource(R.string.tasks_add_due_date), onClick = onPick)
    } else {
        FieldItem(name = name, value = format.date(date), onClick = onPick)
        ShkTextButton(text = stringResource(R.string.tasks_remove), onClick = onRemove)
    }
}

/** One field of the form with its [value] under its [name]. TalkBack reads both: "List, Home". */
@Composable
private fun FieldItem(name: String, value: String, onClick: (() -> Unit)?) {
    val spoken = stringResource(R.string.tasks_field_spoken, name, value)
    ShkListItem(
        headline = name,
        supportingText = value,
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}

/**
 * The dialog of the field List: Inbox and every list, by name, as a
 * `ShkRadioGroup`. A tap on one chooses it and closes the dialog; Cancel
 * closes it with no change (the owner's decision). A task whose list is
 * gone shows Inbox chosen, as the form does.
 */
@Composable
private fun ListDialog(screen: FormScreen, model: TaskFormViewModel, onClose: () -> Unit) {
    val chosen = screen.list?.id ?: INBOX
    val choose = { listId: String ->
        model.onListChange(listId)
        onClose()
    }
    ShkDialog(
        title = stringResource(R.string.tasks_list),
        // The only button is the way out.
        confirmAction = ShkDialogAction(text = stringResource(R.string.tasks_cancel), onClick = {}),
        onDismissRequest = onClose,
    ) {
        ShkRadioGroup {
            ShkRadioButton(text = stringResource(R.string.tasks_inbox), selected = chosen == INBOX, onClick = { choose(INBOX) })
            screen.lists.forEach { list ->
                ShkRadioButton(text = list.name, selected = chosen == list.id, onClick = { choose(list.id) })
            }
        }
    }
}

/**
 * The seven days of Every week, from the phone's first day of the week,
 * and the words under them when none is chosen. TalkBack reads each chip
 * by the whole day: "Monday, selected".
 */
@Composable
private fun DayChips(form: TaskForm, model: TaskFormViewModel, format: TasksFormat) {
    ShkSectionHeader(stringResource(R.string.tasks_days))
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
    if (form.daysError) ErrorLine(stringResource(R.string.tasks_choose_a_day))
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
private fun titleProblemText(problem: TextProblem, format: TasksFormat): String = when (problem) {
    TextProblem.EMPTY -> stringResource(R.string.tasks_title_empty)
    TextProblem.TOO_LONG -> {
        val most = TaskLimits.MOST_TITLE_CODE_POINTS
        pluralStringResource(R.plurals.tasks_title_too_long, most, format.number(most))
    }
}

/** The dialogs of the form. At most one is open; which one is kept while the phone is turned. */
private enum class FormPart { LIST, DATE, TIME }
