package app.shkriuss.feature.reminders.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkExtendedFloatingActionButton
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.reminders.NextShow
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.ReminderFormViewModel
import app.shkriuss.feature.reminders.UpcomingRow
import app.shkriuss.feature.reminders.UpcomingViewModel
import java.time.LocalDate

/**
 * Upcoming, the start screen (docs/apps/reminders/spec.md, "Upcoming"):
 * one row per upcoming reminder, soonest first, the floating button "Add
 * a reminder", and the [form] that both open ([ListAndForm]).
 */
@Composable
internal fun UpcomingContent(
    model: UpcomingViewModel,
    form: ReminderFormViewModel,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val screen by model.state.collectAsState()
    val formScreen by form.state.collectAsState()
    val format = rememberRemindersFormat()
    val snackbars = rememberShkSnackbarHostState()
    // The list leaves room under its last row for the floating button, so that row can scroll clear of it.
    var buttonHeight by remember { mutableIntStateOf(0) }
    ListAndForm(form, screen.today, snackbars, format, windowWidth) {
        ShkScreen(
            topBar = { ShkTopBar(title = stringResource(R.string.reminders_upcoming)) },
            floatingActionButton = {
                ShkExtendedFloatingActionButton(
                    text = stringResource(R.string.reminders_add),
                    icon = painterResource(R.drawable.reminders_icon_add),
                    onClick = form::openNew,
                    modifier = Modifier.onSizeChanged { buttonHeight = it.height },
                )
            },
            snackbarHostState = snackbars,
        ) {
            if (!screen.loaded) return@ShkScreen
            if (screen.isEmpty) {
                ShkEmptyState(
                    title = stringResource(R.string.reminders_upcoming_empty_title),
                    body = stringResource(R.string.reminders_upcoming_empty_body),
                    modifier = Modifier.weight(1f),
                )
                return@ShkScreen
            }
            val roomForButton = with(LocalDensity.current) { buttonHeight.toDp() } + ShkSpacing.Large
            LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                items(screen.rows, key = { it.reminder.id }) { row ->
                    val open = formScreen.form?.reminderId == row.reminder.id
                    UpcomingItem(row, screen.today, format, selected = open) { form.openEdit(row.reminder) }
                }
                item { Spacer(Modifier.height(roomForButton)) }
            }
        }
    }
}

/**
 * One upcoming reminder: its title, and under it when it shows next and
 * its repeat, "Today, 09:00 · Every day", or "Snoozed until 09:12", or
 * "Now". TalkBack reads it as one item, "Pills, tomorrow at 09:00, every
 * day", with the action "Edit".
 */
@Composable
private fun UpcomingItem(row: UpcomingRow, today: LocalDate, format: RemindersFormat, selected: Boolean, onEdit: () -> Unit) {
    val reminder = row.reminder
    val title = reminder.title
    val supporting: String
    val spoken: String
    when (val next = row.next) {
        NextShow.Now -> {
            supporting = stringResource(R.string.reminders_now)
            spoken = stringResource(R.string.reminders_row_spoken, title, stringResource(R.string.reminders_now_spoken))
        }
        is NextShow.SnoozedUntil -> {
            supporting = stringResource(R.string.reminders_snoozed_until, format.snoozeEnd(next.until, today))
            spoken = stringResource(
                R.string.reminders_row_spoken,
                title,
                stringResource(R.string.reminders_snoozed_until_spoken, format.snoozeEndSpoken(next.until, today)),
            )
        }
        is NextShow.At -> {
            val shown = format.next(next.time, today)
            val spokenTime = format.nextSpoken(next.time, today)
            val repeat = format.repeat(reminder.schedule)
            val spokenRepeat = format.repeatSpoken(reminder.schedule)
            supporting = if (repeat == null) shown else stringResource(R.string.reminders_when_and_repeat, shown, repeat)
            spoken = if (spokenRepeat == null) {
                stringResource(R.string.reminders_row_spoken, title, spokenTime)
            } else {
                stringResource(R.string.reminders_row_with_repeat_spoken, title, spokenTime, spokenRepeat)
            }
        }
    }
    ReminderItem(title, supporting, spoken, selected, onEdit)
}

/**
 * One reminder in a list: [title], and [supporting] under it. TalkBack
 * reads it as one item, [spoken], and offers "Edit", which [onEdit] does,
 * as a tap does. [selected] marks the reminder whose form is open.
 */
@Composable
internal fun ReminderItem(title: String, supporting: String, spoken: String, selected: Boolean, onEdit: () -> Unit) {
    val editLabel = stringResource(R.string.reminders_edit)
    ShkListItem(
        headline = title,
        supportingText = supporting,
        onClick = onEdit,
        selected = selected,
        modifier = Modifier.semantics {
            contentDescription = spoken
            onClick(label = editLabel) {
                onEdit()
                true
            }
        },
    )
}
