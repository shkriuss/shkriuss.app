package app.shkriuss.feature.water

import java.time.LocalDate
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
 * Today's date for the screens of Water: one source that every ViewModel
 * observes, so that no two screens disagree about which day is today
 * (docs/apps/water/spec.md, "Units", point 11).
 *
 * While a ViewModel observes [date], it reads the phone's clock again:
 *
 * 1. at the next midnight,
 * 2. when the screen comes to the front ([check]),
 * 3. and at least once a minute. Android tells no screen that the clock
 *    or the time zone was changed, so a change shows within one minute.
 *
 * With no observer it waits for nothing: the app runs without a screen
 * when a reminder is due. [scope] lives as long as the app. [wait] waits
 * that many milliseconds. Tests pass their own.
 */
class WaterToday(
    private val time: WaterTime,
    scope: CoroutineScope,
    private val wait: suspend (millis: Long) -> Unit = { delay(it) },
) {
    private val today = MutableStateFlow(time.today())

    /** Today, on the phone's clock, as the screens show it. */
    val date: StateFlow<LocalDate> = today.asStateFlow()

    init {
        scope.launch {
            today.subscriptionCount.map { it > 0 }.distinctUntilChanged().collectLatest { observed ->
                while (observed) {
                    check()
                    wait(minOf(time.millisToNextDay(), MOST_WAIT_MILLIS))
                }
            }
        }
    }

    /** Reads the phone's clock now. The screen calls it each time it comes to the front. */
    fun check() {
        today.value = time.today()
    }

    private companion object {
        /** The longest wait between two reads of the clock: one minute. */
        const val MOST_WAIT_MILLIS = 60_000L
    }
}
