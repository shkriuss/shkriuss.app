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

/**
 * Android starts this when a button on a notification of the app is
 * pressed (ADR 0034). It hands the press to the app's [Notify] and keeps
 * the broadcast open until the app has handled it.
 *
 * It is not exported: only the button's own pending intent, which this
 * app made, reaches it. The press carries a key, an action, a time and a
 * value, and no text.
 *
 * It does not check the phone's lock. Android's own notification list
 * asks for the unlock before it sends the press. An app with notification
 * access holds the pending intent and can send it without the unlock, and
 * a check here would not stop such an app: it can wait for the unlock.
 * While the app lock hides the text, [Notify] drops the press.
 */
class ButtonReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_BUTTON) return
        val key = intent.getStringExtra(EXTRA_KEY) ?: return
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        if (!intent.hasExtra(EXTRA_AT)) return
        val press = ButtonPress(key, action, intent.getLongExtra(EXTRA_AT, 0L), intent.getLongExtra(EXTRA_VALUE, 0L))
        val pending: PendingResult? = goAsync()
        notifyOf(context).buttonPressed(press) { pending?.finish() }
    }

    internal companion object {
        const val ACTION_BUTTON = "app.shkriuss.core.notify.BUTTON"
        const val EXTRA_KEY = "app.shkriuss.core.notify.KEY"
        const val EXTRA_ACTION = "app.shkriuss.core.notify.ACTION"
        const val EXTRA_AT = "app.shkriuss.core.notify.AT"
        const val EXTRA_VALUE = "app.shkriuss.core.notify.VALUE"

        /**
         * The broadcast of [press]. Two buttons differ in the identifier,
         * so Android keeps one pending intent for each key, action, time
         * and value. The time is part of it, so that the next notification
         * with the same key gets pending intents of its own. Otherwise
         * Android would give the buttons of the old notification the time
         * and the value of the new one, and an old button that is pressed
         * late would act as the new one. The value is part of it, so that
         * a notification shown again with another value never changes
         * what a button kept from before does: it always does what its
         * label said.
         */
        fun intentFor(context: Context, press: ButtonPress): Intent =
            Intent(context, ButtonReceiver::class.java)
                .setAction(ACTION_BUTTON)
                .setIdentifier("${press.key}/${press.action}/${press.atMillis}/${press.value}")
                .putExtra(EXTRA_KEY, press.key)
                .putExtra(EXTRA_ACTION, press.action)
                .putExtra(EXTRA_AT, press.atMillis)
                .putExtra(EXTRA_VALUE, press.value)
    }
}

private fun notifyOf(context: Context): Notify {
    val host = context.applicationContext as? NotifyHost
        ?: error("The app class must implement NotifyHost")
    return host.notify
}
