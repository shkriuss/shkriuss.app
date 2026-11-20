package app.shkriuss.feature.water

import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.notify.AlarmHandler
import app.shkriuss.core.notify.AlarmId
import app.shkriuss.core.notify.AlarmSource
import app.shkriuss.core.notify.ButtonHandler
import app.shkriuss.core.notify.ButtonPress
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.Notifications
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyChannel
import app.shkriuss.core.notify.NotifyState
import app.shkriuss.core.notify.OnScreen
import app.shkriuss.core.notify.ShkNotification
import app.shkriuss.core.notify.ShkNotificationButton
import app.shkriuss.core.notify.ShownReview
import app.shkriuss.feature.water.ui.WaterFormat
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZonedDateTime
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Water's reminders, through `core/notify` (docs/apps/water/spec.md,
 * "Reminders", and docs/architecture/notifications.md, "What an app
 * does"). Water keeps one alarm at a time, `next-drink`, at the time of
 * [NextReminder], and shows one reminder at a time, with the buttons
 * **Drank** and **Later** (ADR 0034).
 *
 * - As the [AlarmSource], it names `next-drink`, or nothing.
 * - As the [AlarmHandler], it shows the reminder when its time comes.
 * - As the [ButtonHandler], it logs a drink or sets a snooze.
 * - [afterChange] runs after every write of [repository]: it removes a
 *   reminder that is answered and calls `notify.sync()`. [afterRestore]
 *   does the same after a backup was restored.
 *
 * The handler, a press and [afterChange] take turns on one lock, so a
 * drink logged in the very moment a reminder is due never leaves that
 * reminder on screen. [notify] gives the app's one `Notify`, which is
 * built with this object, so it is read only when it is needed. [open] is
 * the screen a tap opens: Today. [work] runs the reads of [afterChange]
 * off the main thread. Tests pass their own.
 */
class WaterReminders(
    private val context: Context,
    private val repository: WaterRepository,
    private val time: WaterTime,
    private val book: ReminderBook,
    private val open: Intent,
    private val notify: () -> Notify,
    private val work: CoroutineContext = Dispatchers.IO,
) : AlarmSource, AlarmHandler, ButtonHandler, ShownReview {
    private val lock = Mutex()

    /** What the book holds now, for the reminder line. It changes when a reminder is shown, and after Later. */
    val entries = book.entries

    // As the AlarmSource.

    /**
     * `next-drink` at the time of the rule, or nothing. It never names a
     * time in the past, except a reminder that is due and has not reached
     * the handler yet, for one minute ([NextReminder], point 7).
     */
    override fun alarms(): List<Alarm> {
        val next = runBlocking { nextAt() }?.toInstant()?.toEpochMilli()
        book.update { it.copy(named = next) }
        return listOfNotNull(next?.let { Alarm(ALARM, it) })
    }

    /** The local time of the next reminder, as the rule gives it now, or null for none. */
    suspend fun next(): LocalDateTime? = nextAt()?.toLocalDateTime()

    /** The moment of the next reminder, as the rule gives it now, or null for none. */
    private suspend fun nextAt(): ZonedDateTime? {
        val now = time.nowZoned()
        val settings = repository.settingsNow()
        val day = repository.factsOf(now.toLocalDate())
        return NextReminder.after(now, settings, factsOf(now.toLocalDate(), day, entriesNow()))
    }

    /**
     * The book as the rule may use it now. A last alarm that lies later
     * than now means that the clock was set back. It is forgotten, so
     * that the alarm Water sets next is pending again, and the grace of
     * one minute holds for it. `core/notify` forgets its own fired times
     * that lie ahead in the same way.
     */
    private fun entriesNow(): ReminderEntries {
        val now = time.nowMillis()
        return book.update { entries ->
            val last = entries.lastAlarm
            if (last != null && last > now) entries.copy(lastAlarm = null) else entries
        }
    }

    // As the AlarmHandler.

    /**
     * `next-drink` fired at its time T (spec, "How Water uses core/notify",
     * point 3). It shows the reminder only while the rule still gives T:
     * reminders are on, today's goal is not met, T is inside today's
     * reminder hours, and nothing has answered it. A broadcast that comes
     * more than a minute late is skipped, as a missed reminder is.
     *
     * The alarm is written down first, so that a failure below never names
     * it again. Then, when it shows: last reminder shown at T, the
     * reminder showing now is T, no snooze. Doing it twice gives the same
     * result: the second time, the rule no longer gives T.
     *
     * A T that is still to come by this reading of the clock shows nothing
     * and writes nothing, as in Reminders: the clock was set back after
     * `core/notify` found T due, and it sets the alarm again for T. If the
     * handler fails, `core/notify` puts its notice in the reminder's place,
     * so T is stored as the reminder showing: a press on an older reminder
     * is then not current, and leaves the notice.
     */
    override fun onAlarm(alarm: Alarm, notifications: Notifications) {
        if (alarm.id != ALARM) return
        runBlocking {
            lock.withLock {
                if (alarm.atMillis > time.nowMillis()) return@withLock
                // The rule sees the book as it was when the alarm came: this alarm still pending.
                val before = entriesNow()
                book.update { it.copy(lastAlarm = alarm.atMillis) }
                try {
                    val now = time.nowZoned()
                    val today = now.toLocalDate()
                    val settings = repository.settingsNow()
                    val day = repository.factsOf(today)
                    val due = NextReminder.after(now, settings, factsOf(today, day, before))
                    if (due == null || due.toInstant().toEpochMilli() != alarm.atMillis) return@withLock
                    book.update { it.copy(lastShown = alarm.atMillis, showing = alarm.atMillis, snooze = null) }
                    notifications.show(reminderOf(alarm.atMillis, settings, day))
                } catch (failed: Exception) {
                    book.update { it.copy(showing = alarm.atMillis) }
                    throw failed
                }
            }
        }
    }

    /**
     * The reminder of [atMillis] (spec, "What a reminder shows"): "Time for
     * some water", today's total and goal, and the buttons. Drank carries
     * the first quick amount of this moment in millilitres, so it logs what
     * its label says. Android removes it at midnight. A [quiet] one is the
     * same reminder shown again, with no new sound.
     */
    private fun reminderOf(atMillis: Long, settings: WaterSettings, day: DayFacts, quiet: Boolean = false): ShkNotification {
        val format = format()
        val unit = settings.unit
        val drankAmount = settings.cup1Ml
        return ShkNotification(
            key = KEY,
            channel = CHANNEL,
            title = context.getString(R.string.water_reminder_title),
            text = context.getString(R.string.water_reminder_text, format.quantity(day.totalMl, unit), format.amount(day.goalMl, unit)),
            smallIcon = R.drawable.water_icon_today,
            open = open,
            atMillis = atMillis,
            buttons = listOf(
                ShkNotificationButton(context.getString(R.string.water_reminder_drank, format.amount(drankAmount, unit)), DRANK, drankAmount.toLong()),
                ShkNotificationButton(context.getString(R.string.water_reminder_later), LATER),
            ),
            endsAtMillis = time.nextMidnightMillis(),
            quiet = quiet,
        )
    }

    // As the ShownReview.

    /**
     * Looks at Water's reminder on screen, at every start and after a
     * change of the clock or the time zone (spec, "What a reminder shows",
     * point 6). One that is not the reminder showing goes: Water stopped
     * between taking it and removing it, or between storing a newer one
     * and showing it. One of another day goes too. After a change of the
     * time, one of today is shown again, quietly, with the numbers of now,
     * so that it ends at the new midnight. The notice of a failed
     * reminder, the only one with no end, stays until the next reminder
     * replaces it (spec, "How Water uses core/notify", point 5).
     */
    override fun review(onScreen: List<OnScreen>, notifications: Notifications, timeChanged: Boolean) {
        val shown = onScreen.firstOrNull { it.key == KEY && it.endsAtMillis != null } ?: return
        runBlocking {
            lock.withLock {
                val current = book.entries.value.showing == shown.atMillis
                val today = time.today()
                when {
                    !current -> notifications.cancel(KEY)
                    time.local(shown.atMillis).toLocalDate() != today -> {
                        book.update { it.copy(showing = null) }
                        notifications.cancel(KEY)
                    }
                    timeChanged && shown.endsAtMillis != time.nextMidnightMillis() ->
                        notifications.show(reminderOf(shown.atMillis, repository.settingsNow(), repository.factsOf(today), quiet = true))
                }
            }
        }
    }

    // As the ButtonHandler.

    /**
     * A press of **Drank** or **Later** (spec, "Buttons on a reminder").
     * It works once, and only while its reminder is the one showing, on
     * the day it showed: Android removes a reminder at midnight, and a
     * press that comes after that, for example from a watch, only takes
     * it. A press on an older one only removes it, and never a newer one.
     *
     * **Drank** takes its reminder only once the drink is stored: the
     * repository then calls [afterChange], which removes it. So a save
     * that fails leaves the reminder as it is, and `core/notify` leaves
     * the notification. A second press finds no reminder showing and does
     * nothing: presses run one after another on the worker of
     * `core/notify`. **Later** works out its snooze first, and stores it
     * with the end of the reminder in one write: a read of the settings
     * that fails leaves the reminder as it is. Any other press takes the
     * reminder.
     */
    override fun onButton(press: ButtonPress, notifications: Notifications) {
        if (press.key != KEY) {
            notifications.cancel(press.key)
            return
        }
        val logsADrink = press.action == DRANK && press.value in Amounts.DRINK_ML.first.toLong()..Amounts.DRINK_ML.last.toLong()
        val current = runBlocking {
            lock.withLock {
                val showing = book.entries.value.showing
                val isShowing = showing == press.atMillis
                val inTime = isShowing && time.local(press.atMillis).toLocalDate() == time.today()
                val taken = isShowing && !(inTime && logsADrink)
                when {
                    inTime && press.action == LATER -> {
                        val (pressedAt, snooze) = laterNow()
                        book.update { it.copy(showing = null, lastLater = pressedAt, snooze = snooze) }
                    }
                    taken -> book.update { it.copy(showing = null) }
                }
                // An older reminder is no longer on screen: its key now shows the newer one, which stays.
                if (taken || showing == null) notifications.cancel(KEY)
                inTime
            }
        }
        if (!current) return
        when {
            logsADrink -> drank(press.value.toInt())
            press.action == LATER -> notify().sync()
        }
    }

    /**
     * Logs one drink of [amountMl], the amount on the button, now. The
     * repository then calls [afterChange], which removes the reminder and
     * moves the alarm.
     */
    private fun drank(amountMl: Int) {
        val now = time.now()
        runBlocking { repository.addDrink(now.toLocalDate(), now.hour * MINUTES_PER_HOUR + now.minute, amountMl) }
    }

    /**
     * What a press of **Later** now stores: the moment of the press, which
     * moves the count to now, and a snooze 15 minutes later, or none if
     * that is after "Until".
     */
    private suspend fun laterNow(): Pair<Long, Long?> {
        val now = time.nowZoned()
        val snooze = NextReminder.snoozeAfter(now, repository.settingsNow())?.toInstant()?.toEpochMilli()
        return now.toInstant().toEpochMilli() to snooze
    }

    // After a change in the app.

    /**
     * Runs after every write that changed something. A reminder that is
     * showing is removed when a drink was logged, reminders are off,
     * today's goal is met, or it is from another day (spec, "What a
     * reminder shows", point 6). Then the alarm moves.
     */
    suspend fun afterChange(change: WaterChange) {
        withContext(work) {
            lock.withLock {
                val showing = book.entries.value.showing ?: return@withLock
                val today = time.today()
                val answered = change == WaterChange.DRINK_ADDED ||
                    !repository.settingsNow().remindersOn ||
                    repository.factsOf(today).goalMet ||
                    time.local(showing).toLocalDate() != today
                if (answered) {
                    book.update { it.copy(showing = null) }
                    notify().notifications.cancel(KEY)
                }
            }
        }
        notify().sync()
    }

    /**
     * Runs after a restore (spec, "After a restore"). The restored records
     * are written past [repository], so it does not call [afterChange] by
     * itself. The reminders follow the restored data as they follow an
     * edit: a reminder that is showing is removed when reminders are now
     * off, today's goal is now met, or it is from another day, and then
     * the alarm moves to the time the rule gives now.
     */
    suspend fun afterRestore() = afterChange(WaterChange.RESTORED)

    // For the screens.

    /** What the screens say about notifications of the channel of reminders. */
    fun state(): NotifyState = notify().state(CHANNEL)

    /** Android's question for notifications was answered. */
    fun permissionAnswered() = notify().permissionAnswered()

    /** The page of Android's settings that the line's **Open settings** opens. */
    fun settingsIntent(): Intent = notify().settingsIntent(CHANNEL)

    /** The facts the rule needs about [day], from the database and the book. */
    private fun factsOf(day: LocalDate, facts: DayFacts, entries: ReminderEntries) = ReminderFacts(
        day = day,
        latestDrinkMinute = facts.latestDrinkMinute,
        goalMet = facts.goalMet,
        lastShown = entries.lastShown?.let(time::zoned),
        lastLater = entries.lastLater?.let(time::zoned),
        snooze = entries.snooze?.let(time::zoned),
        pending = entries.pending?.let(time::zoned),
    )

    /** Numbers and amounts as the phone shows them now. */
    private fun format(): WaterFormat {
        val resources = context.resources
        return WaterFormat(resources, resources.configuration.locales[0], DateFormat.is24HourFormat(context))
    }

    companion object {
        /** Water's one alarm (spec, "When the next reminder comes"). */
        val ALARM: AlarmId = AlarmId("next-drink")

        /** The key of Water's one reminder. A new one replaces the old one. */
        const val KEY: String = "next-drink"

        /** The action of **Drank**. Its value is the amount in millilitres. */
        const val DRANK: String = "drank"

        /** The action of **Later**. */
        const val LATER: String = "later"

        /** The channel of the reminders (spec, "The channel"). Its id never changes. */
        val CHANNEL: NotifyChannel = NotifyChannel(
            id = "drink-reminders",
            name = R.string.water_channel_name,
            description = R.string.water_channel_description,
            importance = ChannelImportance.Normal,
        )

        private const val MINUTES_PER_HOUR = 60
    }
}
