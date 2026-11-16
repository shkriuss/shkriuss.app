package app.shkriuss.core.notify

import android.app.NotificationManager
import android.content.Intent
import app.shkriuss.core.testing.TestDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Buttons on a notification on a real Android (ADR 0034): Android takes
 * the buttons, each asks for the phone's unlock, and a press reaches the
 * receiver of this app that is not exported, through the pending intent
 * the app made. Nothing here can press a button on the screen: the test
 * sends the button's pending intent, as Android does after the unlock.
 */
class ButtonsOnAndroidTest {
    private val app = DeviceApp.running
    private val reminders = app.reminders
    private val notificationManager = app.getSystemService(NotificationManager::class.java)

    @Before
    fun anAppThatMayShowNotifications() {
        TestDevice.instrumentation.uiAutomation.grantRuntimePermission(app.packageName, Notify.PERMISSION)
        clear()
    }

    @After
    fun clear() {
        reminders.presses.clear()
        notificationManager.cancelAll()
    }

    private fun show(): Long {
        val at = System.currentTimeMillis()
        app.notify.notifications.show(
            ShkNotification(
                KEY,
                DeviceReminders.CHANNEL,
                "A reminder of the tests",
                null,
                android.R.drawable.ic_popup_reminder,
                Intent(app, OpenedScreen::class.java),
                at,
                buttons = listOf(ShkNotificationButton("Done", "done", 7), ShkNotificationButton("Later", "later")),
            ),
        )
        // Android removes and shows a notification a moment after it is asked to. Until then the notification of the
        // test before, which has the same key, can still be listed. Its buttons are its own: they carry its time.
        assertTrue("the notification is not shown", TestDevice.waitUntil(WAIT_MILLIS) { shown()?.`when` == at })
        return at
    }

    private fun shown() = notificationManager.activeNotifications.firstOrNull { it.tag == KEY }?.notification

    @Test
    fun androidShowsTheButtonsAndEachAsksForTheUnlock() {
        show()

        val actions = checkNotNull(shown()).actions.toList()
        assertEquals(listOf("Done", "Later"), actions.map { it.title.toString() })
        actions.forEach { assertTrue(it.title.toString(), it.isAuthenticationRequired) }
    }

    @Test
    fun aPressReachesTheReceiverThatIsNotExportedAndTheApp() {
        val at = show()

        checkNotNull(shown()).actions[0].actionIntent.send()

        assertTrue("the press did not come", TestDevice.waitUntil(WAIT_MILLIS) { reminders.presses.isNotEmpty() })
        assertEquals(listOf(ButtonPress(KEY, "done", at, 7)), reminders.presses.toList())
        assertTrue("the app did not remove it", TestDevice.waitUntil(WAIT_MILLIS) { shown() == null })
    }

    private companion object {
        const val KEY = "buttons"
        const val WAIT_MILLIS = 10_000L
    }
}
