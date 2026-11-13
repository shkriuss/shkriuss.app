package app.shkriuss.core.notify

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context

/**
 * The one door to Android's exact alarms. Everything else in
 * `core/notify` goes through it, so a test can pass one that only writes
 * down what was asked.
 */
interface AlarmScheduler {
    /**
     * Registers [alarm] with Android. An alarm with the same id is
     * replaced. A time that has passed fires within seconds: Android
     * fires no alarm sooner than about five seconds after it was set.
     */
    fun set(alarm: Alarm)

    /** Removes the alarm with this id. Nothing happens if there is none. */
    fun cancel(id: AlarmId)
}

/**
 * [AlarmScheduler] on Android's `AlarmManager`.
 *
 * - `setExactAndAllowWhileIdle` with `RTC_WAKEUP`: at the exact time on
 *   the wall clock, also when the device sleeps deeply (ADR 0010). The
 *   permission for it, `USE_EXACT_ALARM`, is in this module's manifest.
 * - Each alarm is one broadcast to [AlarmReceiver] of this app, and no
 *   other app can send it. Android tells two alarms apart by the id in
 *   the intent's identifier.
 * - The intent carries the id and nothing else.
 */
internal class AlarmManagerScheduler(private val context: Context) : AlarmScheduler {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)

    // The one lint check that is suppressed in this module, on this one
    // function. Android Lint 32.5.1, which comes with the Android Gradle
    // Plugin 9.5.1, knows only SCHEDULE_EXACT_ALARM as the permission for
    // an exact alarm. It reports MissingPermission here although the
    // module's manifest declares USE_EXACT_ALARM, which Android accepts
    // from version 13 and which ADR 0010 chose. ManifestTest checks that
    // the permission is declared, and AlarmsOnAndroidTest that Android
    // allows and fires the alarm. The owner decided this in pull request
    // 26 (ADR 0030). After an update of the Android Gradle Plugin, try
    // without it and remove it if lint passes.
    @SuppressLint("MissingPermission")
    override fun set(alarm: Alarm) {
        val operation = checkNotNull(operation(alarm.id, PendingIntent.FLAG_UPDATE_CURRENT))
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMillis, operation)
    }

    override fun cancel(id: AlarmId) {
        val operation = operation(id, PendingIntent.FLAG_NO_CREATE) ?: return
        alarmManager.cancel(operation)
        operation.cancel()
    }

    private fun operation(id: AlarmId, flag: Int): PendingIntent? =
        PendingIntent.getBroadcast(context, 0, AlarmReceiver.intentFor(context, id), flag or PendingIntent.FLAG_IMMUTABLE)
}
