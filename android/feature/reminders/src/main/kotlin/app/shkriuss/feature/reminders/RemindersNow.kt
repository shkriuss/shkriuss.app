package app.shkriuss.feature.reminders

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The phone's clock for the screens of Reminders: one source that every
 * ViewModel observes, so that no two screens disagree about what is
 * upcoming, what is past and which day is today.
 *
 * While a ViewModel observes [reading], it reads the clock again:
 *
 * 1. at each whole minute, so a reminder whose time comes says "Now",
 *    and "Today" is the new day from midnight on;
 * 2. when the screen comes to the front ([check]).
 *
 * Android tells no screen that the clock or the time zone was changed, so
 * a change shows within one minute. With no observer it waits for
 * nothing. [scope] lives as long as the app. [wait] waits that many
 * milliseconds. Tests pass their own.
 */
class RemindersNow(
    private val time: RemindersTime,
    scope: CoroutineScope,
    private val wait: suspend (millis: Long) -> Unit = { delay(it) },
) {
    private val current = MutableStateFlow(time.reading())

    /** What the clock showed when it was read last. */
    val reading: StateFlow<ClockReading> = current.asStateFlow()

    init {
        scope.launch {
            current.subscriptionCount.map { it > 0 }.distinctUntilChanged().collectLatest { observed ->
                while (observed) {
                    check()
                    wait(time.millisToNextMinute())
                }
            }
        }
    }

    /** Reads the clock now. The screen calls it each time it comes to the front. */
    fun check() {
        current.value = time.reading()
    }
}
