package app.shkriuss.feature.reminders

import androidx.room3.withWriteTransaction
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The ViewModels of Upcoming, Past and the reminder form on a real
 * database in memory and a real preferences file, at 09:30 on Monday 16
 * November 2026, in UTC. Their work runs at once on the thread that
 * starts it, and each test waits for the state it expects: Room's reads
 * come a moment later.
 */
@RunWith(RobolectricTestRunner::class)
class ViewModelsTest {
    private val database: RemindersDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30, 15))
    private val time = RemindersTime(clock) { UTC }
    private val book = emptyBook()
    private val ids = TestIdSource()
    private val repository = RemindersRepository(database, clock, ids, time, book, work = Dispatchers.Unconfined)

    /** How long the clock of the screens asked to wait, each time, in milliseconds. */
    private val waits = CopyOnWriteArrayList<Long>()
    private val waitEnds = Channel<Unit>(Channel.UNLIMITED)
    private val sourceScope = CoroutineScope(Dispatchers.Unconfined)

    /** The one clock of the screens, as `RemindersServices` builds it, with a wait that the test ends. */
    private val now = RemindersNow(time, sourceScope) { millis ->
        waits += millis
        waitEnds.receive()
    }

    @After
    fun closeTheDatabase() {
        sourceScope.cancel()
        database.close()
    }

    private fun upcoming() = UpcomingViewModel(repository, now, Dispatchers.Unconfined)

    private fun past() = PastViewModel(repository, now, Dispatchers.Unconfined)

    private fun form() = ReminderFormViewModel(repository, time, now, Dispatchers.Unconfined)

    private fun add(title: String, schedule: Schedule): Reminder = runBlocking { checkNotNull(repository.add(title, schedule)) }

    private fun live() = runBlocking { repository.reminders().first() }

    /**
     * Waits until the reminders that are not deleted are [expected]. Undo
     * starts its write and returns at once, so a test waits for it.
     */
    private fun liveBecomes(expected: List<Reminder>) = runBlocking {
        withTimeout(5_000) { repository.reminders().first { it == expected } }
    }

    /** Waits until the phone-only entry of [id] is [expected]. The repository writes it right after the database. */
    private fun entryBecomes(id: String, expected: ReminderEntry) = repository.entries.await { (it[id] ?: ReminderEntry()) == expected }

    /** Moves the clock to [local] and lets the clock of the screens read it, as at a whole minute. */
    private fun clockTo(local: LocalDateTime) {
        clock.setTo(local)
        now.check()
    }

    private fun UpcomingViewModel.rows(count: Int) = state.await { it.loaded && it.rows.size == count }.rows

    private fun PastViewModel.rows(count: Int) = state.await { it.loaded && it.rows.size == count }.rows

    private fun ReminderFormViewModel.openForm(condition: (ReminderForm) -> Boolean = { true }): ReminderForm =
        state.await { screen -> screen.form?.let(condition) == true }.form!!

    // Upcoming.

    @Test
    fun upcomingStartsEmpty() {
        val screen = upcoming().state.await { it.loaded }
        assertTrue(screen.isEmpty)
        assertEquals(MONDAY, screen.today)
    }

    @Test
    fun upcomingIsSoonestFirstAndAtTheSameMomentTheOneCreatedFirst() {
        val gym = add("Gym", gym())
        val bank = add("Call the bank", CALL_THE_BANK)
        clock.advanceBy(1)
        val alsoAt14 = add("Also at 14:00", CALL_THE_BANK)
        val pills = add("Pills", pills())

        val rows = upcoming().rows(4)

        assertEquals(listOf(bank, alsoAt14, gym, pills), rows.map { it.reminder })
        assertEquals(NextShow.At(monday(14)), rows[0].next)
        assertEquals(NextShow.At(monday(18, 30)), rows[2].next)
        assertEquals("saved at 09:30: tomorrow", NextShow.At(day(1, 9)), rows[3].next)
    }

    @Test
    fun aDueReminderSaysNowAndASnoozeSaysUntilWhen() {
        val bank = add("Call the bank", schedule(Repeat.ONCE, MONDAY, 10))
        val pills = add("Pills", pills())
        book.update(pills.id) { it.copy(snoozeMillis = millisAt(monday(9, 40), UTC)) }
        val model = upcoming()

        assertEquals(NextShow.SnoozedUntil(monday(9, 40)), model.state.await { s -> s.rows.any { it.reminder == pills } }.rows.first().next)

        clockTo(monday(10, 0, 5))
        val rows = model.state.await { s -> s.rows.all { it.next == NextShow.Now } && s.rows.size == 2 }.rows
        // The snooze ended first, so it comes first.
        assertEquals(listOf(pills, bank), rows.map { it.reminder })
    }

    @Test
    fun aOneTimeReminderMovesToPastOnceItShowed() {
        val bank = add("Call the bank", schedule(Repeat.ONCE, MONDAY, 10))
        val upcoming = upcoming()
        val past = past()
        upcoming.rows(1)

        clockTo(monday(10, 0, 5))
        // The handler of its alarm writes the mark at its time.
        book.update(bank.id) { it.copy(mark = monday(10)) }

        upcoming.rows(0)
        assertEquals(listOf(PastRow(bank)), past.rows(1))
        assertEquals(monday(10), past.state.value.rows.single().time)
    }

    @Test
    fun theClockOfTheScreensWaitsForTheNextWholeMinuteWhileItIsObserved() {
        upcoming().state.await { it.loaded }
        // Read at 09:30:15: the next read at 09:31:00.
        assertEquals(45_000L, waits.first())
    }

    // Past.

    @Test
    fun pastIsNewestFirst() {
        val early = add("Early", schedule(Repeat.ONCE, MONDAY, 10))
        val late = add("Late", schedule(Repeat.ONCE, MONDAY, 11))
        add("Pills", pills())
        clockTo(monday(12))
        book.update(listOf(early.id, late.id)) { _, entry -> entry.copy(mark = monday(12)) }

        val model = past()

        assertEquals(listOf(late, early), model.rows(2).map { it.reminder })
        assertTrue(model.state.value.canDeleteAll)
    }

    @Test
    fun deleteAllAsksDeletesEveryPastReminderAndUndoBringsThemBack() {
        val early = add("Early", schedule(Repeat.ONCE, MONDAY, 10))
        val late = add("Late", schedule(Repeat.ONCE, MONDAY, 11))
        val pills = add("Pills", pills())
        clockTo(monday(12))
        book.update(listOf(early.id, late.id)) { _, entry -> entry.copy(mark = monday(12)) }
        val model = past()
        model.rows(2)

        model.askDeleteAll()
        assertEquals(2, model.state.await { it.question != null }.question!!.count)
        model.cancelDeleteAll()
        assertNull(model.state.await { it.question == null }.question)
        assertEquals(3, live().size)

        model.askDeleteAll()
        model.confirmDeleteAll()
        val deleted = model.state.await { it.snackbar != null && it.rows.isEmpty() }
        assertEquals(2, deleted.snackbar!!.count)
        assertNull(deleted.question)
        assertEquals(listOf(pills), live())

        model.undo()
        assertEquals(listOf(late, early), model.rows(2).map { it.reminder })
        assertNull(model.state.value.snackbar)
        // Undo counts from now: they stay past.
        entryBecomes(early.id, ReminderEntry(mark = monday(12)))
        entryBecomes(late.id, ReminderEntry(mark = monday(12)))
    }

    @Test
    fun deleteAllLeavesAReminderSnoozedWhileTheQuestionWasOpen() {
        val early = add("Early", schedule(Repeat.ONCE, MONDAY, 10))
        val late = add("Late", schedule(Repeat.ONCE, MONDAY, 11))
        clockTo(monday(12))
        book.update(listOf(early.id, late.id)) { _, entry -> entry.copy(mark = monday(12)) }
        val model = past()
        model.rows(2)
        model.askDeleteAll()
        assertEquals(2, model.state.await { it.question != null }.question!!.count)

        // Snooze 10 min on the notification of "Late" while the question is open: it is upcoming again.
        val snoozeEnd = millisAt(monday(12, 10), UTC)
        book.update(late.id) { it.copy(snoozeMillis = snoozeEnd) }
        model.confirmDeleteAll()

        val deleted = model.state.await { it.snackbar != null }
        assertEquals("only the one still past", 1, deleted.snackbar!!.count)
        assertEquals(listOf("Late"), live().map { it.title })
        assertEquals("its snooze stays", snoozeEnd, book.entryOf(late.id).snoozeMillis)
    }

    @Test
    fun deleteAllWithNoPastReminderAsksNothing() {
        val model = past()
        assertTrue(model.state.await { it.loaded }.isEmpty)
        model.askDeleteAll()
        assertNull(model.state.value.question)
        assertFalse(model.state.value.canDeleteAll)
    }

    // The form.

    @Test
    fun aNewReminderIsOnceTodayAtTheNextFullHour() {
        val model = form()
        model.openNew()

        val open = model.openForm()
        assertEquals(ReminderForm(null, "", Repeat.ONCE, MONDAY, Weekdays.NONE, 10 * 60), open)
        assertFalse(open.isEdit)
        assertEquals(monday(10), model.state.value.next)

        // At 23:10 that is tomorrow at 00:00.
        val late = FormRules.newForm(readingAt(monday(23, 10), UTC))
        assertEquals(MONDAY.plusDays(1), late.date)
        assertEquals(0, late.minuteOfDay)
    }

    @Test
    fun aNewReminderIsSavedTrimmedAndTheSnackbarSaysWhenItShows() {
        val model = form()
        model.openNew()
        model.onTitleChange("  Call the bank  ")
        model.onTimeChange(LocalTime.of(14, 0))
        model.save()

        val screen = model.state.await { it.form == null && it.snackbar != null }
        assertEquals(FormSnackbar.Saved(monday(14)), screen.snackbar)
        val stored = live().single()
        assertEquals("Call the bank", stored.title)
        assertEquals(CALL_THE_BANK, stored.schedule)
        assertEquals(ReminderEntry(mark = monday(9, 30)), book.entryOf(stored.id))
    }

    @Test
    fun everySaveTellsTheQuestionForNotificationsAlsoOneWithNoChangeButNotAWrongOne() {
        val saves = AtomicInteger()
        val model = ReminderFormViewModel(repository, time, now, Dispatchers.Unconfined, onSaved = { saves.incrementAndGet() })
        model.openNew()
        model.onTitleChange("Pills")
        model.save()
        model.state.await { it.form == null && it.snackbar != null }
        assertEquals(1, saves.get())

        // No change: nothing is written, and the question still follows (the owner's decision 9: after every save).
        model.snackbarDismissed()
        model.openEdit(live().single())
        model.save()
        model.state.await { it.form == null }
        assertEquals(2, saves.get())
        // A wrong title: nothing is written, and it is no save.
        model.openEdit(live().single())
        model.onTitleChange(" ")
        model.save()
        model.openForm { it.titleError != null }

        assertEquals(2, saves.get())
    }

    @Test
    fun theLineNextOfAnUnchangedFormShowsTheSnooze() {
        val bank = add("Call the bank", schedule(Repeat.ONCE, MONDAY, 10))
        clockTo(monday(10, 5))
        val snoozeEnd = millisAt(monday(10, 12), UTC)
        book.update(bank.id) { ReminderEntry(mark = monday(10), snoozeMillis = snoozeEnd) }
        val model = form()

        model.openEdit(bank)

        assertEquals("the snooze, as Upcoming says it", monday(10, 12), model.state.await { it.next != null }.next)
        model.onTimeChange(LocalTime.of(11, 0))
        assertEquals("a new time counts as if saved now", monday(11), model.state.await { it.next == monday(11) }.next)
    }

    @Test
    fun aWrongTitleIsNamedAndNothingIsWritten() {
        val model = form()
        model.openNew()
        model.onTitleChange("   ")
        model.save()
        assertEquals(TitleProblem.EMPTY, model.openForm { it.titleError != null }.titleError)

        model.onTitleChange("x".repeat(201))
        assertEquals("the error follows what is typed", TitleProblem.TOO_LONG, model.openForm { it.titleError == TitleProblem.TOO_LONG }.titleError)
        model.save()
        model.onTitleChange("x".repeat(200))
        assertNull(model.openForm { it.titleError == null }.titleError)
        assertEquals(emptyList<Reminder>(), live())
    }

    @Test
    fun aLineBreakInTheTitleBecomesASpace() {
        val model = form()
        model.openNew()
        model.onTitleChange("Call\nthe bank")
        assertEquals("Call the bank", model.openForm().title)
    }

    @Test
    fun aOneTimeReminderInThePastIsRefused() {
        val model = form()
        model.openNew()
        model.onTitleChange("Too late")
        assertTrue("the picker refuses 09:30", model.timeHasPassed(LocalTime.of(9, 30)))
        assertFalse(model.timeHasPassed(LocalTime.of(9, 31)))

        // The time passes while the form is open.
        clock.setTo(monday(10, 0, 1))
        model.save()

        assertTrue(model.openForm { it.timeError }.timeError)
        assertEquals(emptyList<Reminder>(), live())
        model.onTimeChange(LocalTime.of(10, 1))
        assertFalse(model.openForm { !it.timeError }.timeError)
    }

    @Test
    fun theTimePickerRefusesNothingForARepeat() {
        val model = form()
        model.openNew()
        model.onRepeatChange(Repeat.DAILY)
        assertFalse(model.timeHasPassed(LocalTime.of(8, 0)))
    }

    @Test
    fun everyWeekSelectsTheDayOfTheDateAndNeedsADay() {
        val model = form()
        model.openNew()
        model.onTitleChange("Gym")
        model.onRepeatChange(Repeat.WEEKLY)
        assertEquals(Weekdays.of(DayOfWeek.MONDAY), model.openForm { it.repeat == Repeat.WEEKLY }.weekdays)

        model.onDayChange(DayOfWeek.MONDAY, chosen = false)
        assertNull("no day, no next", model.state.await { it.form?.weekdays == Weekdays.NONE }.next)
        model.save()
        assertTrue(model.openForm { it.daysError }.daysError)

        model.onDayChange(DayOfWeek.WEDNESDAY, chosen = true)
        assertFalse(model.openForm { !it.daysError }.daysError)
        assertEquals(day(2, 10), model.state.await { it.next != null }.next)
    }

    @Test
    fun everyDayAndEveryWeekStartOnTheDayTheyAreSaved() {
        val model = form()
        model.openNew()
        model.onTitleChange("Pills")
        model.onDateChange(MONDAY.plusDays(10))
        model.onRepeatChange(Repeat.DAILY)
        model.save()

        model.state.await { it.form == null }
        assertEquals(Schedule(Repeat.DAILY, MONDAY, 10 * 60), live().single().schedule)
    }

    @Test
    fun theDatePickerGoesFromTodayTo2100() {
        val model = form()
        model.openNew()
        model.onDateChange(MONDAY.minusDays(1))
        assertEquals(MONDAY, model.openForm().date)
        model.onDateChange(LocalDate.of(2101, 1, 1))
        assertEquals(LocalDate.of(2100, 12, 31), model.openForm { it.date.year == 2100 }.date)
    }

    @Test
    fun aSaveWithNoChangeWritesNothing() {
        val pills = add("Pills", pills(from = MONDAY.minusDays(30)))
        val model = form()
        model.openEdit(pills)
        val open = model.openForm()
        assertTrue(open.isEdit)
        assertEquals("the date of Every day is not shown: the row starts today", MONDAY, open.date)

        model.save()

        model.state.await { it.form == null }
        assertNull(model.state.value.snackbar)
        assertEquals(1L, database.reminders().let { runBlocking { it.find(pills.id)!!.changeNumber } })
    }

    @Test
    fun aNewTitleAloneKeepsAPastTime() {
        val bank = add("Call the bank", CALL_THE_BANK)
        clockTo(monday(15))
        book.update(bank.id) { it.copy(mark = monday(14)) }
        val model = form()
        model.openEdit(bank)
        model.onTitleChange("Call the bank again")
        model.save()

        model.state.await { it.form == null }
        assertEquals("Call the bank again", live().single().title)
        assertEquals(CALL_THE_BANK, live().single().schedule)
        assertNull("it does not show again, so no snackbar", model.state.value.snackbar)
    }

    @Test
    fun aNewTitleAloneKeepsATimeThatAnotherFormChangedMeanwhile() {
        val bank = add("Call the bank", CALL_THE_BANK)
        clockTo(monday(8))
        val upcoming = form()
        upcoming.openEdit(bank)
        val past = form()
        past.openEdit(bank)
        past.onTimeChange(LocalTime.of(16, 0))
        past.save()
        past.state.await { it.form == null }
        val rescheduled = live().single().schedule

        upcoming.onTitleChange("Call the bank about the card")
        upcoming.save()

        upcoming.state.await { it.form == null }
        assertEquals("Call the bank about the card", live().single().title)
        assertEquals("the time the other form saved stays", rescheduled, live().single().schedule)
        assertEquals(16 * 60, rescheduled.minuteOfDay)
    }

    @Test
    fun aNewTimeCountsFromNow() {
        val pills = add("Pills", pills(from = MONDAY.minusDays(30)))
        book.update(pills.id) { ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L) }
        clockTo(monday(9, 45))
        val model = form()
        model.openEdit(pills)
        model.onTimeChange(LocalTime.of(9, 50))
        model.save()

        assertEquals(FormSnackbar.Saved(monday(9, 50)), model.state.await { it.snackbar != null }.snackbar)
        assertEquals(Schedule(Repeat.DAILY, MONDAY, 9 * 60 + 50), live().single().schedule)
        assertEquals(ReminderEntry(mark = monday(9, 45)), book.entryOf(pills.id))
    }

    @Test
    fun the501stReminderIsRefusedAndTheFormStays() {
        runBlocking { repeat(ReminderLimits.MOST_REMINDERS) { repository.add("Reminder $it", pills()) } }
        val model = form()
        model.openNew()
        model.onTitleChange("One more")
        model.save()

        val open = model.openForm { it.limitError }
        assertFalse(open.saving)
        assertEquals("One more", open.title)
        assertEquals(ReminderLimits.MOST_REMINDERS, live().size)
    }

    @Test
    fun deleteClosesTheFormAndUndoBringsTheReminderBack() {
        val pills = add("Pills", pills())
        val model = form()
        model.openEdit(pills)
        model.delete()

        assertEquals(FormSnackbar.Deleted(pills.id), model.state.await { it.form == null && it.snackbar != null }.snackbar)
        assertEquals(emptyList<Reminder>(), live())

        model.undo()
        assertNull(model.state.await { it.snackbar == null }.snackbar)
        liveBecomes(listOf(pills))
        entryBecomes(pills.id, ReminderEntry(mark = monday(9, 30)))
    }

    /**
     * While Save writes, the form takes no change, so nothing typed after
     * the tap is shown and then lost when the form closes. The test holds
     * the database's write lock on another thread, so the save waits.
     */
    @Test
    fun whileSaveWritesTheFormTakesNoChange() {
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val holder = thread {
            runBlocking {
                database.withWriteTransaction {
                    held.countDown()
                    release.await()
                }
            }
        }
        held.await()
        val model = form()
        model.openNew()
        model.onTitleChange("Call the bank")
        model.save()

        model.state.await { it.form?.saving == true }
        model.onTitleChange("Call the bank tomorrow")
        model.onRepeatChange(Repeat.DAILY)
        val waiting = checkNotNull(model.state.value.form)
        assertEquals("Call the bank", waiting.title)
        assertEquals(Repeat.ONCE, waiting.repeat)

        release.countDown()
        holder.join()
        model.state.await { it.form == null && it.snackbar != null }
        assertEquals(listOf("Call the bank"), live().map { it.title })
    }

    /**
     * A form opened while another one is being saved stays when that save
     * ends, with what was typed in it: the end of a save closes only the
     * form it saved. On a tablet the list is beside the form, so a row can
     * be tapped while Save writes.
     */
    @Test
    fun aFormOpenedWhileAnotherIsSavedStaysWhenTheSaveEnds() {
        val pills = add("Pills", pills())
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val holder = thread {
            runBlocking {
                database.withWriteTransaction {
                    held.countDown()
                    release.await()
                }
            }
        }
        held.await()
        val model = form()
        model.openNew()
        model.onTitleChange("Call the bank")
        model.save()
        model.state.await { it.form?.saving == true }

        model.openEdit(pills)
        model.onTitleChange("Vitamins")
        release.countDown()
        holder.join()

        val screen = model.state.await { it.snackbar != null }
        assertEquals(pills.id, screen.form?.reminderId)
        assertEquals("Vitamins", screen.form?.title)
        assertEquals(setOf("Pills", "Call the bank"), live().map { it.title }.toSet())
    }

    /**
     * Cancel while Save writes does nothing: the write has begun, so
     * closing the form then would say that nothing is written while it
     * is. The form closes when the save ends, with its snackbar.
     */
    @Test
    fun cancelWhileSaveWritesDoesNothing() {
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val holder = thread {
            runBlocking {
                database.withWriteTransaction {
                    held.countDown()
                    release.await()
                }
            }
        }
        held.await()
        val model = form()
        model.openNew()
        model.onTitleChange("Call the bank")
        model.save()
        model.state.await { it.form?.saving == true }

        model.cancel()
        assertEquals(true, model.state.value.form?.saving)
        release.countDown()
        holder.join()

        model.state.await { it.form == null && it.snackbar is FormSnackbar.Saved }
        assertEquals(listOf("Call the bank"), live().map { it.title })
    }

    /**
     * Delete while Save writes does nothing: the save of the edit has
     * begun, and a delete then would race it, so its Undo could be lost.
     * The form closes when the save ends, and the reminder stays.
     */
    @Test
    fun deleteWhileSaveWritesDoesNothing() {
        val pills = add("Pills", pills())
        holdingTheDatabase { release ->
            val model = form()
            model.openEdit(pills)
            model.onTitleChange("Vitamins")
            model.save()
            model.state.await { it.form?.saving == true }

            model.delete()
            assertEquals(true, model.state.value.form?.saving)
            release()

            model.state.await { it.form == null && it.snackbar is FormSnackbar.Saved }
            assertEquals(listOf("Vitamins"), live().map { it.title })
        }
    }

    /**
     * The sheet swiped away while Save writes is gone from the screen, so
     * its form closes at once, and the save goes on. A form opened then
     * opens a sheet of its own, and stays when the save ends.
     */
    @Test
    fun aSheetDismissedWhileSaveWritesClosesAtOnceAndTheSaveGoesOn() {
        holdingTheDatabase { release ->
            val model = form()
            model.openNew()
            model.onTitleChange("Call the bank")
            model.save()
            model.state.await { it.form?.saving == true }

            model.dismissSheet()
            model.state.await { it.form == null }
            model.openNew()
            model.onTitleChange("Water the plants")
            release()

            val screen = model.state.await { it.snackbar is FormSnackbar.Saved }
            assertEquals("Water the plants", screen.form?.title)
            assertEquals(listOf("Call the bank"), live().map { it.title })
        }
    }

    /** Each form opened is counted, so the screen starts it afresh, also a new form opened over a new form. */
    @Test
    fun eachFormOpenedIsCounted() {
        val pills = add("Pills", pills())
        val model = form()
        model.openNew()
        model.state.await { it.opening == 1 && it.form != null }
        model.openNew()
        model.state.await { it.opening == 2 }
        model.openEdit(pills)
        model.state.await { it.opening == 3 && it.form?.reminderId == pills.id }
    }

    /** Runs [test] while another thread holds the database's write lock, so that a save waits until [test] calls its release. */
    private fun holdingTheDatabase(test: (release: () -> Unit) -> Unit) {
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val holder = thread {
            runBlocking {
                database.withWriteTransaction {
                    held.countDown()
                    release.await()
                }
            }
        }
        held.await()
        try {
            test {
                release.countDown()
                holder.join()
            }
        } finally {
            release.countDown()
            holder.join()
        }
    }

    @Test
    fun cancelWritesNothing() {
        val model = form()
        model.openNew()
        model.onTitleChange("Not saved")
        model.cancel()
        model.state.await { it.form == null }
        assertEquals(emptyList<Reminder>(), live())
    }
}
