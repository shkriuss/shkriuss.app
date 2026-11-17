package app.shkriuss.feature.reminders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.plus

/** What Upcoming shows (docs/apps/reminders/spec.md, "Upcoming"). */
data class UpcomingScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** Today, so that a row can say "Today, 09:00" and leave out the year of this year. */
    val today: LocalDate,
    /** The upcoming reminders, soonest first. */
    val rows: List<UpcomingRow> = emptyList(),
) {
    /** True with no upcoming reminder: "No reminders yet. Tap Add a reminder to make one." */
    val isEmpty: Boolean
        get() = loaded && rows.isEmpty()
}

/**
 * The ViewModel of Upcoming. The list follows the database, the
 * phone-only entries and [now], the one source of the clock: a reminder
 * whose time comes says "Now" within a minute, and moves to Past once it
 * showed. The form is the [ReminderFormViewModel].
 */
class UpcomingViewModel(
    repository: RemindersRepository,
    now: RemindersNow,
    work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    /** What the screen shows. */
    val state: StateFlow<UpcomingScreen> = combine(repository.reminders(), repository.entries, now.reading) { reminders, entries, reading ->
        UpcomingScreen(loaded = true, today = reading.today, rows = ReminderLists.of(reminders, entries, reading).upcoming)
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, UpcomingScreen(loaded = false, today = now.reading.value.today))
}
