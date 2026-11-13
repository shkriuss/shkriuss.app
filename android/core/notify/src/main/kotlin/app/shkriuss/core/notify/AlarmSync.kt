package app.shkriuss.core.notify

import app.shkriuss.core.data.Clock

/**
 * Keeps the alarms at Android the same as the alarms the app wants, and
 * hands a fired alarm to the app once.
 *
 * There is one way in for every cause: [sync] asks the app's
 * [AlarmSource] for everything it wants now and makes Android's alarms
 * match. So a reboot, an update, a new time zone and a changed reminder
 * all run the same code. The rules are in
 * docs/architecture/notifications.md, "How alarms are kept right".
 *
 * Nothing here is safe to call from two threads at once. `Notify` runs it
 * on one worker thread.
 */
internal class AlarmSync(
    private val source: AlarmSource,
    private val handler: AlarmHandler,
    private val notifications: Notifications,
    private val scheduler: AlarmScheduler,
    private val registry: AlarmRegistry,
    private val clock: Clock,
) {
    /**
     * Registers what the app wants now, and removes what it no longer
     * wants.
     *
     * With [setAll], every alarm is set again, also those the file
     * already lists: Android may have dropped its alarms since, at a
     * reboot, an update or a "Force stop". That is for the start of the
     * app and for Android's own broadcasts. Without it, only an alarm
     * that is new or has a new time is set. An alarm that waits at
     * Android is then left alone, because Android fires no alarm sooner
     * than about five seconds after it was set, and setting one that is
     * almost due would make it late.
     */
    fun sync(setAll: Boolean) {
        val now = clock.nowMillis()
        val wanted = source.alarms()
        require(wanted.map { it.id }.toSet().size == wanted.size) { "An AlarmSource names each alarm id once" }
        val wantedNow = wanted.toSet()
        val before = registry.read()

        // An alarm that fired stays done for as long as the app names it
        // with the same time. A fired time that lies ahead means the clock
        // was set back: that alarm is due again.
        val fired = before.fired.filter { (id, at) -> at <= now && Alarm(id, at) in wantedNow }
        // The soonest ones are enough. Every alarm that fires ends in a
        // sync, which registers the ones after it.
        val next = wanted.filter { fired[it.id] != it.atMillis }.sortedBy { it.atMillis }.take(MOST_ALARMS)

        (before.registered.keys - next.map { it.id }.toSet()).forEach(scheduler::cancel)
        // Setting an alarm twice leaves one alarm.
        next.filter { setAll || before.registered[it.id] != it.atMillis }.forEach(scheduler::set)
        registry.write(AlarmState(registered = next.associate { it.id to it.atMillis }, fired = fired))
    }

    /**
     * Android fired the alarm [id]. The app's handler runs if that alarm
     * is registered and due, and so at most once for one id and time.
     * Anything else is an old or repeated broadcast and is dropped. Then
     * the alarms are registered again, which sets the next time of a
     * reminder that repeats.
     */
    fun fired(id: AlarmId) {
        val state = registry.read()
        val at = state.registered[id]
        val due = at != null && at <= clock.nowMillis()
        if (at != null && due) {
            try {
                handler.onAlarm(Alarm(id, at), notifications)
            } finally {
                // Written after the handler: if the app stops inside the
                // handler, the alarm fires again. Written also when the
                // handler fails, so that a broken reminder cannot fail at
                // every start of the app.
                registry.write(state.copy(registered = state.registered - id, fired = state.fired + (id to at)))
            }
        }
        // A broadcast that was dropped can mean that Android's alarms and
        // the file differ, for example after the clock was set back. Then
        // everything is set again.
        sync(setAll = !due)
    }

    private companion object {
        /**
         * How many alarms wait at Android at once. Android allows one app
         * 500. An app with more reminders than this still gets every one
         * of them, in order.
         */
        const val MOST_ALARMS = 100
    }
}
