package app.shkriuss.feature.reminders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * The reminder form, "New reminder" ([reminderId] null) or "Edit
 * reminder" (docs/apps/reminders/spec.md, "The reminder form"). It keeps
 * what the user typed while the phone is turned. [date] is shown for Once,
 * Every month and Every year, [weekdays] for Every week; both stay as they
 * are while another repeat is chosen.
 */
data class ReminderForm(
    /** The reminder being edited, or null for a new one. */
    val reminderId: String?,
    /** The title field, as typed. */
    val title: String,
    /** The repeat chosen. */
    val repeat: Repeat,
    /** The date row. */
    val date: LocalDate,
    /** The days chosen for Every week ([Weekdays]). */
    val weekdays: Int,
    /** The time row, in minutes after midnight. */
    val minuteOfDay: Int,
    /** After a Save with a wrong title: the words under the field. */
    val titleError: TitleProblem? = null,
    /** After a Save of a one-time reminder whose time has passed: "That time has passed." */
    val timeError: Boolean = false,
    /** After a Save of Every week with no day: "Choose at least one day." */
    val daysError: Boolean = false,
    /** After a Save of a new reminder while 500 are kept: "Reminders keeps 500 reminders. Delete one to add another." */
    val limitError: Boolean = false,
    /** True while Save writes. Another Save does nothing then, and the form takes no change. */
    val saving: Boolean = false,
    /** The reminder as stored when the form opened, for Edit. A Save with no change writes nothing. */
    val stored: Reminder? = null,
) {
    /** True for "Edit reminder", which also offers Delete. */
    val isEdit: Boolean
        get() = reminderId != null

    /** The time row as a [LocalTime]. */
    val time: LocalTime
        get() = LocalTime.of(minuteOfDay / MINUTES_PER_HOUR, minuteOfDay % MINUTES_PER_HOUR)

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}

/** What the form shows. */
data class FormScreen(
    /** The form, while it is open. */
    val form: ReminderForm? = null,
    /** The line "Next: Wed 18 Nov, 18:30": the first time the form gives, as if saved now. Null if it gives none. */
    val next: LocalDateTime? = null,
    /** The snackbar after a Save or a Delete, while it shows. */
    val snackbar: FormSnackbar? = null,
)

/** The snackbars of the form. */
sealed interface FormSnackbar {
    /** "Reminder set for Wed 18 Nov, 18:30." [at] is when it shows next. */
    data class Saved(val at: LocalDateTime) : FormSnackbar

    /** "Reminder deleted", with Undo, which brings the reminder [reminderId] back. */
    data class Deleted(val reminderId: String) : FormSnackbar
}

/**
 * The rules of the form as plain code (spec, "The reminder form").
 */
object FormRules {
    /**
     * A new reminder: Once, today, at the next full hour. At 23:10 that
     * is tomorrow at 00:00.
     */
    fun newForm(now: ClockReading): ReminderForm {
        val start = now.local.truncatedTo(ChronoUnit.HOURS).plusHours(1)
        return ReminderForm(
            reminderId = null,
            title = "",
            repeat = Repeat.ONCE,
            date = start.toLocalDate(),
            weekdays = Weekdays.NONE,
            minuteOfDay = start.hour * MINUTES_PER_HOUR,
        )
    }

    /**
     * The form of [reminder]. For Every day and Every week, whose date is
     * not shown, the date row starts at [today], should another repeat be
     * chosen.
     */
    fun editForm(reminder: Reminder, today: LocalDate): ReminderForm {
        val schedule = reminder.schedule
        val showsDate = schedule.repeat in DATED
        return ReminderForm(
            reminderId = reminder.id,
            title = reminder.title,
            repeat = schedule.repeat,
            date = if (showsDate) schedule.date else today,
            weekdays = schedule.weekdays,
            minuteOfDay = schedule.minuteOfDay,
            stored = reminder,
        )
    }

    /**
     * The schedule the form gives, saved on [today]. For Every day and
     * Every week the date is the day it is saved (spec, table
     * `reminder`).
     */
    fun scheduleOf(form: ReminderForm, today: LocalDate): Schedule = when (form.repeat) {
        Repeat.ONCE, Repeat.MONTHLY, Repeat.YEARLY -> Schedule(form.repeat, form.date, form.minuteOfDay)
        Repeat.DAILY -> Schedule(Repeat.DAILY, today, form.minuteOfDay)
        Repeat.WEEKLY -> Schedule(Repeat.WEEKLY, today, form.minuteOfDay, form.weekdays)
    }

    /**
     * True if the form holds another date, time or repeat than [stored],
     * as the user sees them: the date only where it shows, the days only
     * for Every week.
     */
    fun newTime(stored: Schedule, form: ReminderForm): Boolean =
        stored.repeat != form.repeat ||
            stored.minuteOfDay != form.minuteOfDay ||
            (form.repeat in DATED && stored.date != form.date) ||
            (form.repeat == Repeat.WEEKLY && stored.weekdays != form.weekdays)

    /**
     * True if a one-time reminder at [date] and [minuteOfDay] is not later
     * than the current minute: "That time has passed." Both the local
     * time and its moment must be later than now:
     *
     * - The moment, for the hour that happens twice: in its second pass,
     *   02:45 is the first 02:45, which has passed, as for an occurrence
     *   (spec, "Occurrences").
     * - The local time, for the hour that does not exist: after the jump,
     *   02:30 moves to 03:30, a moment still to come, but it is not later
     *   than the mark, so it would never show.
     */
    fun hasPassed(date: LocalDate, minuteOfDay: Int, now: ClockReading): Boolean {
        val time = date.atStartOfDay().plusMinutes(minuteOfDay.toLong())
        return time <= now.currentMinute || now.millisOf(time) <= now.millis
    }

    /** The line "Next: ...": the first occurrence of what the form gives, saved now. Null with no day of the week, or a time that has passed. */
    fun nextOf(form: ReminderForm, now: ClockReading): LocalDateTime? {
        if (form.repeat == Repeat.WEEKLY && form.weekdays == Weekdays.NONE) return null
        return Occurrences.firstAfter(scheduleOf(form, now.today), now.currentMinute)
    }

    /** The repeats that show the date row. */
    private val DATED = setOf(Repeat.ONCE, Repeat.MONTHLY, Repeat.YEARLY)

    private const val MINUTES_PER_HOUR = 60
}

/**
 * The ViewModel of the reminder form, which both lists open: a new
 * reminder from **Add a reminder** on Upcoming, an existing one from a tap
 * on its row. It checks the form as the spec says, writes through
 * [repository], and shows the snackbar of a Save or a Delete.
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
class ReminderFormViewModel(
    private val repository: RemindersRepository,
    private val time: RemindersTime,
    now: RemindersNow,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val form = MutableStateFlow<ReminderForm?>(null)
    private val snackbar = MutableStateFlow<FormSnackbar?>(null)

    /** The form being saved whose sheet was dismissed while it wrote. It closes when the save ends, also when the save is refused. */
    private var dismissedWhileSaving: ReminderForm? = null

    /** What the form shows. The line "Next" follows the clock. */
    val state: StateFlow<FormScreen> = combine(form, snackbar, now.reading) { open, shown, reading ->
        FormScreen(form = open, next = open?.let { FormRules.nextOf(it, reading) }, snackbar = shown)
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, FormScreen())

    /** **Add a reminder**: an empty form, Once, today, at the next full hour. */
    fun openNew() {
        form.value = FormRules.newForm(time.reading())
    }

    /** A tap on a row: the form of [reminder]. */
    fun openEdit(reminder: Reminder) {
        form.value = FormRules.editForm(reminder, time.reading().today)
    }

    /** The user typed in the title field. It has one line. A shown error follows what is typed. */
    fun onTitleChange(text: String) = change { open ->
        val title = TitleRules.oneLine(text)
        open.copy(title = title, titleError = open.titleError?.let { TitleRules.problemOf(title) })
    }

    /** The user chose [repeat]. Choosing Every week with no day chosen selects the day of the date. */
    fun onRepeatChange(repeat: Repeat) = change { open ->
        val weekdays = if (repeat == Repeat.WEEKLY && open.weekdays == Weekdays.NONE) Weekdays.bitOf(open.date.dayOfWeek) else open.weekdays
        open.copy(repeat = repeat, weekdays = weekdays, timeError = false, daysError = open.daysError && weekdays == Weekdays.NONE)
    }

    /** The user picked a date in `ShkDatePicker`, from today to 31 Dec 2100. */
    fun onDateChange(date: LocalDate) = change { open ->
        open.copy(date = date.coerceIn(time.reading().today, ReminderLimits.LAST_PICKER_DATE), timeError = false)
    }

    /** The user chose [day] of the week, or not. */
    fun onDayChange(day: DayOfWeek, chosen: Boolean) = change { open ->
        val weekdays = Weekdays.with(open.weekdays, day, chosen)
        open.copy(weekdays = weekdays, daysError = open.daysError && weekdays == Weekdays.NONE)
    }

    /** The user picked a time in `ShkTimePicker`. The picker itself refuses a time that [timeHasPassed]. */
    fun onTimeChange(picked: LocalTime) = change { open ->
        open.copy(minuteOfDay = picked.hour * MINUTES_PER_HOUR + picked.minute, timeError = false)
    }

    /**
     * True if the time picker refuses [picked] with "That time has passed.":
     * for Once, the date and [picked] are not later than the current minute.
     */
    fun timeHasPassed(picked: LocalTime): Boolean {
        val open = form.value ?: return false
        return open.repeat == Repeat.ONCE && FormRules.hasPassed(open.date, picked.hour * MINUTES_PER_HOUR + picked.minute, time.reading())
    }

    /**
     * Save. A wrong field shows its words and nothing is written. With no
     * change it closes and writes nothing. Otherwise it writes, closes,
     * and the snackbar says when the reminder shows next. A new reminder
     * while 500 are kept is refused: the form stays, with its words.
     */
    fun save() {
        val open = form.value ?: return
        if (open.saving) return
        val now = time.reading()
        val title = TitleRules.clean(open.title)
        val stored = open.stored
        val newTime = stored == null || FormRules.newTime(stored.schedule, open)
        if (stored != null && !newTime && title == stored.title) {
            form.value = null
            return
        }
        val checked = open.copy(
            titleError = TitleRules.problemOf(open.title),
            daysError = open.repeat == Repeat.WEEKLY && open.weekdays == Weekdays.NONE,
            // A change of the title alone keeps a past time.
            timeError = newTime && open.repeat == Repeat.ONCE && FormRules.hasPassed(open.date, open.minuteOfDay, now),
            limitError = false,
        )
        if (checked.titleError != null || checked.daysError || checked.timeError) {
            form.value = checked
            return
        }
        val schedule = if (stored != null && !newTime) stored.schedule else FormRules.scheduleOf(open, now.today)
        val writing = checked.copy(saving = true)
        form.value = writing
        viewModelScope.launch(work) {
            // The mark is the minute the time was checked in, so a time that was later than it stays later.
            val saved = if (stored == null) repository.add(title, schedule, now) else repository.change(stored.id, title, schedule, now)
            // Only the form that was saved closes, or says it was refused. A form opened, or one closed, while it wrote stays as it is.
            // A refused form whose sheet was dismissed meanwhile closes too: the sheet is gone.
            val dismissed = dismissedWhileSaving == writing
            dismissedWhileSaving = null
            if (saved == null && stored == null) {
                form.compareAndSet(writing, if (dismissed) null else checked.copy(limitError = true))
                return@launch
            }
            form.compareAndSet(writing, null)
            saved?.let(::savedSnackbarOf)?.let { snackbar.value = it }
        }
    }

    /**
     * Cancel: the form closes and nothing is written. While Save writes it
     * does nothing: the write has begun, and the form closes when it ends.
     */
    fun cancel() {
        if (form.value?.saving == true) return
        form.value = null
    }

    /**
     * The sheet of the form was swiped away, or closed with Back or by a
     * tap above it. As Cancel, except while Save writes: the sheet is gone
     * from the screen then, so the form closes when the save ends, also
     * when the 500 limit refuses it.
     */
    fun dismissSheet() {
        val open = form.value ?: return
        if (open.saving) dismissedWhileSaving = open else cancel()
    }

    /**
     * Delete in "Edit reminder": the form closes, the reminder is marked as
     * deleted, and the snackbar offers Undo. While Save writes it does
     * nothing: the save has begun, and a delete then would race it, so its
     * Undo could be lost.
     */
    fun delete() {
        val open = form.value ?: return
        if (open.saving) return
        val id = open.reminderId ?: return
        form.value = null
        viewModelScope.launch(work) {
            repository.delete(listOf(id)).firstOrNull()?.let { snackbar.value = FormSnackbar.Deleted(it.id) }
        }
    }

    /** Undo in the snackbar "Reminder deleted": the reminder comes back, counting from now. */
    fun undo() {
        val shown = snackbar.value as? FormSnackbar.Deleted ?: return
        snackbar.value = null
        viewModelScope.launch(work) { repository.bringBack(listOf(shown.reminderId)) }
    }

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }

    /** "Reminder set for ...": when the rule shows [reminder] next, as the phone's clock shows it. None if it does not show again. */
    private fun savedSnackbarOf(reminder: Reminder): FormSnackbar? {
        val now = time.reading()
        val alarm = ReminderLists.alarmOf(reminder, repository.entries.value[reminder.id], now) ?: return null
        return FormSnackbar.Saved(now.local(alarm.atMillis).truncatedTo(ChronoUnit.MINUTES))
    }

    /**
     * Changes the open form by [edit]. While Save writes, the form takes no
     * change: the write is of what the form showed when Save was tapped,
     * and the form closes when it ends, so a change then would be shown and
     * lost.
     */
    private fun change(edit: (ReminderForm) -> ReminderForm) {
        form.value = form.value?.let { open -> if (open.saving) open else edit(open) }
    }

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
