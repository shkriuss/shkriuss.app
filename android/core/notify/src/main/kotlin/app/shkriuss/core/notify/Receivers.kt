package app.shkriuss.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Android starts this when an alarm of the app is due. It hands the alarm
 * to the app's [Notify] and keeps the broadcast open until the app has
 * handled it, so the device stays awake that long.
 *
 * It is not exported: only this app's own entry at `AlarmManager` reaches
 * it.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ALARM) return
        val id = intent.identifier ?: return
        val pending: PendingResult? = goAsync()
        notifyOf(context).alarmFired(AlarmId(id)) { pending?.finish() }
    }

    internal companion object {
        const val ACTION_ALARM = "app.shkriuss.core.notify.ALARM"

        /** The broadcast for the alarm [id]. Two alarms differ in the identifier, so Android keeps both. */
        fun intentFor(context: Context, id: AlarmId): Intent =
            Intent(context, AlarmReceiver::class.java).setAction(ACTION_ALARM).setIdentifier(id.value)
    }
}

/**
 * Android starts this after the moments that undo or move alarms, and the
 * app's alarms are registered again:
 *
 * - The device started and was unlocked once, or the profile the app
 *   lives in was. Android forgets every alarm when it stops.
 * - The app was updated. Android drops the old version's alarms.
 * - The time or the time zone changed. A reminder "at 09:00" is now due
 *   at another moment.
 *
 * It is not exported, and only Android can send these broadcasts.
 */
class SystemEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in EVENTS) return
        val pending: PendingResult? = goAsync()
        notifyOf(context).systemEvent { pending?.finish() }
    }

    internal companion object {
        /** The same four as in this module's manifest. */
        val EVENTS: Set<String> = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )
    }
}

private fun notifyOf(context: Context): Notify {
    val host = context.applicationContext as? NotifyHost
        ?: error("The app class must implement NotifyHost")
    return host.notify
}
