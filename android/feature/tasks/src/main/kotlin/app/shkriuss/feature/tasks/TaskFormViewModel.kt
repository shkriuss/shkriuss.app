package app.shkriuss.feature.tasks

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * The task form, "New task" ([taskId] null) or "Edit task"
 * (docs/apps/tasks/spec.md, "The task form"). It keeps what the user
 * typed while the phone is turned. [repeat], [weekdays] and the reminder
 * show only with a due date; [weekdays] stay as they are while another
 * repeat is chosen.
 */
data class TaskForm(
    /** The task being edited, or null for a new one. */
    val taskId: String?,
    /** The title field, as typed. */
    val title: String,
    /** The list chosen, or [INBOX]. */
    val listId: String,
    /** The due date, or null: "No due date". */
    val date: LocalDate?,
    /** The repeat chosen. [Repeat.ONCE] without a due date. */
    val repeat: Repeat = Repeat.ONCE,
    /** The days chosen for Every week ([Weekdays]). */
    val weekdays: Int = Weekdays.NONE,
    /** The reminder time, in minutes after midnight, while **Remind me** is on, else null. */
    val remindMinute: Int? = null,
    /** After a Save with a wrong title: the words under the field. */
    val titleError: TextProblem? = null,
    /** After a Save of a reminder moment that is not later than the current minute: "That time has passed." */
    val timeError: Boolean = false,
    /** After a Save of Every week with no day: "Choose at least one day." */
    val daysError: Boolean = false,
    /** After a Save of a new task while 5,000 are kept: "Tasks keeps 5,000 tasks. Delete some to add more." */
    val limitError: Boolean = false,
    /**
     * After a Save that the database refused: "Could not save the task. Try
     * again.", in the form, above its buttons. The form is a sheet over the
     * bottom of the screen, where a snackbar would be hidden (the owner's
     * decision). Nothing was written. It stays until the next Save.
     */
    val saveFailed: Boolean = false,
    /** True while Save writes. Another Save does nothing then, and the form takes no change. */
    val saving: Boolean = false,
    /** The task as stored when the form opened, for Edit. A Save with no change writes nothing. */
    val stored: Task? = null,
) {
    /** True for "Edit task", which also offers Delete. */
    val isEdit: Boolean
        get() = taskId != null

    /** True while **Remind me** is on. */
    val remind: Boolean
        get() = remindMinute != null

    /** The Time row as a [LocalTime], while **Remind me** is on. */
    val remindTime: LocalTime?
        get() = remindMinute?.let { LocalTime.of(it / MINUTES_PER_HOUR, it % MINUTES_PER_HOUR) }

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}

/** What the form shows. */
data class FormScreen(
    /** The form, while it is open. */
    val form: TaskForm? = null,
    /** True if the database could not be read: "Could not open your tasks." The form keeps what was typed. */
    val failed: Boolean = false,
    /** The list the form shows: null for Inbox, also for a list that is deleted or not stored. */
    val list: TaskList? = null,
    /** Inbox and every list, for the list dialog, in the order of Lists. */
    val lists: List<TaskList> = emptyList(),
    /** For a repeat, the line "Dates: Wed 18 Nov, Fri 20 Nov, Mon 23 Nov, …": the first three dates the form gives. */
    val dates: List<LocalDate> = emptyList(),
    /** For a done task, the line "Done on Mon 16 Nov.", as the phone's clock shows that day. */
    val doneOn: LocalDate? = null,
    /** The snackbar after a Save or a Delete, while it shows. */
    val snackbar: TasksSnackbar? = null,
    /**
     * Counts the forms opened. The screen starts each form afresh by it:
     * at its top, with the keyboard on the title of a new task.
     */
    val opening: Int = 0,
)

/** The rules of the form as plain code (docs/apps/tasks/spec.md, "The task form" and "Repeats"). */
object FormRules {
    /** The reminder time a reminder starts at, unless 09:00 has passed on a due day of today. */
    const val START_MINUTE: Int = 9 * 60

    /**
     * Where the Time row starts when **Remind me** is turned on, for the
     * due day [day]: 09:00. When [day] is today and 09:00 has passed, the
     * next full hour of today, or 23:59 when no full hour is left. In the
     * minute 23:59 that time has passed too, and Save says so.
     */
    fun startMinute(day: LocalDate, now: ClockReading): Int {
        if (day != now.today || !hasPassed(day, START_MINUTE, now)) return START_MINUTE
        val nextHour = now.local.truncatedTo(ChronoUnit.HOURS).plusHours(1)
        return if (nextHour.toLocalDate() == now.today) nextHour.hour * MINUTES_PER_HOUR else TaskLimits.LAST_MINUTE
    }

    /**
     * True if the reminder moment on [day] at [minuteOfDay] is not later
     * than the current minute: "That time has passed." Both the local time
     * and its moment must be later than now, as in Reminders: in the second
     * pass of the hour that happens twice, 02:45 is the first 02:45, which
     * has passed; and after the jump, 02:30 moves to 03:30, a moment still
     * to come, but the local time is not later than the mark of now.
     */
    fun hasPassed(day: LocalDate, minuteOfDay: Int, now: ClockReading): Boolean {
        val time = day.atStartOfDay().plusMinutes(minuteOfDay.toLong())
        return time <= now.currentMinute || now.millisOf(time) <= now.millis
    }

    /**
     * What the form gives, as Save would store it ("Repeats", point 2). A
     * repeat counts from the date in the form, and the due day is its
     * first date on or after it. Without a repeat, the due day is the date
     * in the form. While the date, the repeat and the days are as stored,
     * the stored due day and repeat stay, with the form's reminder time.
     * Null with no due date, and also for a repeat with no date up to
     * 9999-12-31, or Every week with no day.
     */
    fun dueOf(form: TaskForm): Due? {
        val date = form.date ?: return null
        val stored = form.stored?.due
        if (stored != null && !datesChanged(form)) return stored.copy(remindMinute = form.remindMinute)
        if (form.repeat == Repeat.ONCE) return Due(date, null, form.remindMinute)
        if (form.repeat == Repeat.WEEKLY && form.weekdays == Weekdays.NONE) return null
        val repeat = TaskRepeat(form.repeat, date, if (form.repeat == Repeat.WEEKLY) form.weekdays else Weekdays.NONE)
        val day = RepeatDates.firstOnOrAfter(repeat, date) ?: return null
        return Due(day, repeat, form.remindMinute)
    }

    /** True if the due date, the repeat or the days in the form are not those stored. Always true for a new task. */
    fun datesChanged(form: TaskForm): Boolean {
        val stored = form.stored ?: return true
        val due = stored.due
        return due?.day != form.date ||
            (due?.repeatKind ?: Repeat.ONCE) != form.repeat ||
            (form.repeat == Repeat.WEEKLY && due?.repeat?.weekdays != form.weekdays)
    }

    /** True if **Remind me** or the time in the form are not those stored. For a new task: true if it has a reminder. */
    fun reminderChanged(form: TaskForm): Boolean {
        val stored = form.stored ?: return form.remindMinute != null
        return stored.due?.remindMinute != form.remindMinute
    }

    /** The first three dates of a repeat the form gives, for the line "Dates: ...". None without a repeat. */
    fun datesOf(form: TaskForm): List<LocalDate> {
        val due = dueOf(form) ?: return emptyList()
        val repeat = due.repeat ?: return emptyList()
        return RepeatDates.datesFrom(repeat, due.day, DATES_SHOWN)
    }

    private const val DATES_SHOWN = 3
    private const val MINUTES_PER_HOUR = 60
}

/**
 * The ViewModel of the task form, a bottom sheet at every width, which
 * Today, a list and a notification open: a new task from **Add a task**,
 * an existing one from a tap on its row. It checks the form as the spec
 * says, writes through [repository], and shows the snackbar of a Save or
 * a Delete.
 *
 * Save and Delete take one press at a time and close the form after it.
 * A save the database refuses changes nothing: the form stays open with
 * what was typed, and says "Could not save the task. Try again."
 * ([TaskForm.saveFailed]). [onSaved] runs after each new or changed task is written, so
 * that the question for notifications can follow it.
 *
 * A form open on a task that is deleted elsewhere closes. Every change
 * runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
class TaskFormViewModel(
    private val repository: TasksRepository,
    private val time: TasksTime,
    now: TasksNow,
    private val work: CoroutineContext = EmptyCoroutineContext,
    private val onSaved: (Task) -> Unit = {},
) : ViewModel() {
    private val form = MutableStateFlow<TaskForm?>(null)
    private val snackbar = MutableStateFlow<TasksSnackbar?>(null)
    private val opened = MutableStateFlow(0)
    private val rows = RowActions(repository, time, viewModelScope, work, snackbar)

    /**
     * What the form shows. A read of the lists that fails shows as
     * [FormScreen.failed], and the form goes on taking what is typed, so
     * Cancel still closes it. The list dialog's order is the phone's
     * language order at each reading of [now], as on Lists.
     */
    val state: StateFlow<FormScreen> =
        combine(form, repository.lists().orNullOnReadFailure(), now.reading, snackbar, opened) { open, read, reading, shown, opening ->
            val lists = read.orEmpty()
            FormScreen(
                form = open,
                failed = read == null,
                list = open?.let { lists.firstOrNull { list -> list.id == it.listId } },
                lists = TaskOrder.byName(lists),
                dates = open?.let(FormRules::datesOf).orEmpty(),
                doneOn = open?.stored?.doneAt?.let { reading.local(it).toLocalDate() },
                snackbar = shown,
                opening = opening,
            )
        }.stateIn(viewModelScope + work, SharingStarted.Eagerly, FormScreen())

    init {
        // A task deleted anywhere closes a form open on it: a Save there could write nothing. The list can be a moment
        // behind the database, so a task missing from it is looked up once more before its form closes. A read that
        // fails closes nothing: [state] shows it.
        viewModelScope.launch(work) {
            combine(form, repository.tasks()) { open, live -> open?.taskId?.takeIf { id -> live.none { it.id == id } } }
                .ignoreReadFailure()
                .collect { missing -> if (missing != null && isGone { repository.findTask(missing) }) closeIfDeleted(missing) }
        }
    }

    /** **Add a task** on Today: a new task due today, in Inbox. */
    fun openNewDueToday() = openNew(INBOX, time.reading().today)

    /** **Add a task** in a list: a new task in the list [listId], or Inbox for [INBOX], with no due day. */
    fun openNewIn(listId: String) = openNew(listId, null)

    private fun openNew(listId: String, date: LocalDate?) {
        form.value = TaskForm(taskId = null, title = "", listId = listId, date = date)
        opened.update { it + 1 }
    }

    /** A tap on a row: the form of [task]. */
    fun openEdit(task: Task) {
        val due = task.due
        form.value = TaskForm(
            taskId = task.id,
            title = task.title,
            listId = task.listId,
            date = due?.day,
            repeat = due?.repeatKind ?: Repeat.ONCE,
            weekdays = due?.repeat?.weekdays ?: Weekdays.NONE,
            remindMinute = due?.remindMinute,
            stored = task,
        )
        opened.update { it + 1 }
    }

    /** The user typed in the title field. It has one line. A shown error follows what is typed. */
    fun onTitleChange(text: String) = change { open ->
        val title = TextRules.TITLE.oneLine(text)
        open.copy(title = title, titleError = open.titleError?.let { TextRules.TITLE.problemOf(title) })
    }

    /** The user chose a list in the list dialog: [listId], or [INBOX]. */
    fun onListChange(listId: String) = change { it.copy(listId = listId) }

    /**
     * The user picked a due date in `ShkDatePicker`, from today to 31 Dec
     * 2100, by **Add a due date** or a tap on the date. An earlier due date
     * stays until it is changed.
     */
    fun onDateChange(date: LocalDate) = change { open ->
        // From today to 31 Dec 2100, as the picker offers; today wins should the clock be past 2100.
        open.copy(date = maxOf(minOf(date, TaskLimits.LAST_PICKER_DATE), time.reading().today), timeError = false)
    }

    /** **Remove** beside the due date: no due date, and so no repeat and no reminder. */
    fun removeDate() = change { open ->
        open.copy(date = null, repeat = Repeat.ONCE, remindMinute = null, timeError = false, daysError = false)
    }

    /** The user chose [repeat]. Only with a due date. Choosing Every week with no day chosen selects the day of the date. */
    fun onRepeatChange(repeat: Repeat) = change { open ->
        val date = open.date ?: return@change open
        val weekdays = if (repeat == Repeat.WEEKLY && open.weekdays == Weekdays.NONE) Weekdays.bitOf(date.dayOfWeek) else open.weekdays
        open.copy(repeat = repeat, weekdays = weekdays, timeError = false, daysError = open.daysError && weekdays == Weekdays.NONE)
    }

    /** The user chose [day] of the week, or not. */
    fun onDayChange(day: DayOfWeek, chosen: Boolean) = change { open ->
        val weekdays = Weekdays.with(open.weekdays, day, chosen)
        open.copy(weekdays = weekdays, timeError = false, daysError = open.daysError && weekdays == Weekdays.NONE)
    }

    /**
     * **Remind me** turned on or off. Only with a due date. Turned on, the
     * time starts at 09:00, or at the next full hour when the due day is
     * today and 09:00 has passed.
     */
    fun onRemindChange(on: Boolean) = change { open ->
        val date = open.date ?: return@change open
        val minute = if (!on) null else open.remindMinute ?: FormRules.startMinute(FormRules.dueOf(open)?.day ?: date, time.reading())
        open.copy(remindMinute = minute, timeError = false)
    }

    /** The user picked a time in `ShkTimePicker`. The picker itself refuses a time that [timeHasPassed]. */
    fun onTimeChange(picked: LocalTime) = change { open ->
        if (open.remindMinute == null) open else open.copy(remindMinute = minuteOf(picked), timeError = false)
    }

    /** True if the time picker refuses [picked] with "That time has passed.": its reminder moment is not later than the current minute. */
    fun timeHasPassed(picked: LocalTime): Boolean {
        val open = form.value ?: return false
        val due = FormRules.dueOf(open.copy(remindMinute = minuteOf(picked))) ?: return false
        return FormRules.hasPassed(due.day, minuteOf(picked), time.reading())
    }

    /**
     * Save. A wrong field shows its words and nothing is written. With no
     * change it closes and writes nothing. Otherwise it writes and closes;
     * a new task shows "Task added". A new task while 5,000 are kept is
     * refused: the form stays, with its words. A write the database
     * refuses keeps the form open with what was typed.
     */
    fun save() {
        val open = form.value ?: return
        if (open.saving) return
        val now = time.reading()
        val title = TextRules.TITLE.clean(open.title)
        val stored = open.stored
        val datesChanged = FormRules.datesChanged(open)
        val reminderChanged = FormRules.reminderChanged(open)
        val listChanged = stored == null || stored.listId != open.listId
        val titleChanged = stored == null || stored.title != title
        if (stored != null && !datesChanged && !reminderChanged && !listChanged && !titleChanged) {
            form.value = null
            return
        }
        val due = FormRules.dueOf(open)
        val weeklyWithNoDay = open.date != null && open.repeat == Repeat.WEEKLY && open.weekdays == Weekdays.NONE
        val checked = open.copy(
            titleError = TextRules.TITLE.problemOf(open.title),
            // Also a repeat with no date up to 9999-12-31: only a due date near it, from a restore, can have none.
            daysError = weeklyWithNoDay || (open.date != null && due == null),
            // Checked only when the due date, the repeat, the days, the time or Remind me changed (rule 3).
            timeError = (datesChanged || reminderChanged) && due?.remindMinute?.let { FormRules.hasPassed(due.day, it, now) } == true,
            limitError = false,
            saveFailed = false,
        )
        if (checked.titleError != null || checked.daysError || checked.timeError) {
            form.value = checked
            return
        }
        val writing = checked.copy(saving = true)
        form.value = writing
        viewModelScope.launch(work) {
            val saved = try {
                if (stored == null) {
                    repository.addTask(NewTask(title, open.listId, due), now)
                } else {
                    val edit = TaskEdit(
                        title = title.takeIf { titleChanged },
                        listId = open.listId.takeIf { listChanged },
                        due = DueEdit(due, datesChanged, reminderChanged).takeIf { datesChanged || reminderChanged },
                    )
                    repository.changeTask(stored.id, edit, now)
                }
            } catch (_: SQLException) {
                // Nothing changed. Only the form that was saved stays open, with what was typed, and says so.
                form.compareAndSet(writing, checked.copy(saveFailed = true))
                return@launch
            }
            // Only the form that was saved closes, or says it was refused. A form opened, or one closed, while it wrote stays as it is.
            if (saved == null && stored == null) {
                form.compareAndSet(writing, checked.copy(limitError = true))
                return@launch
            }
            form.compareAndSet(writing, null)
            if (saved == null) return@launch
            if (stored == null) snackbar.value = TasksSnackbar.TaskAdded
            onSaved(saved)
        }
    }

    /** Cancel: the form closes and nothing is written. While Save writes it does nothing: the form closes when the write ends. */
    fun cancel() {
        if (form.value?.saving == true) return
        form.value = null
    }

    /**
     * The sheet of the form was swiped away, or closed with Back or by a
     * tap above it. The sheet is gone from the screen, so the form closes
     * at once, also while Save writes: that save goes on.
     */
    fun dismissSheet() {
        form.value = null
    }

    /**
     * Delete in "Edit task": the form closes at once, so a second press
     * does nothing, the task is marked as deleted, and the snackbar "Task
     * deleted" offers Undo. While Save writes it does nothing.
     */
    fun delete() {
        val open = form.value ?: return
        if (open.saving) return
        val id = open.taskId ?: return
        form.value = null
        viewModelScope.launch(work) {
            rows.changing { repository.deleteTask(id) }?.let { snackbar.value = TasksSnackbar.TaskDeleted(it) }
        }
    }

    /** **Undo** in the snackbar "Task deleted": the task comes back. */
    fun undo() = rows.undo()

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }

    /** The task [id] is deleted. A form open on it closes and writes nothing. One that is saving ends by its write. */
    private fun closeIfDeleted(id: String) {
        val open = form.value ?: return
        if (open.taskId == id && !open.saving) form.compareAndSet(open, null)
    }

    /** Changes the open form by [edit]. While Save writes, the form takes no change. */
    private fun change(edit: (TaskForm) -> TaskForm) {
        form.value = form.value?.let { open -> if (open.saving) open else edit(open) }
    }

    private fun minuteOf(time: LocalTime): Int = time.hour * MINUTES_PER_HOUR + time.minute

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
