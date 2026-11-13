package app.shkriuss.core.notify

import android.app.NotificationManager
import android.content.pm.PackageManager
import app.shkriuss.core.testing.TestDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The notification permission and the channels on a real Android. The
 * emulator starts with a newly installed test APK: nobody was asked, and
 * nothing is granted.
 */
class PermissionOnAndroidTest {
    private val app = DeviceApp.running
    private val notificationManager = app.getSystemService(NotificationManager::class.java)

    @Test
    fun theStateFollowsThePermissionFromNeverAskedToAllowed() {
        // Newly installed: Android shows no notification of this app, and nobody was asked.
        assertFalse("a new install has the permission already", notificationManager.areNotificationsEnabled())
        assertEquals(NotifyState.NotAsked, app.notify.state(DeviceReminders.CHANNEL))

        // The user answers Android's question with no.
        app.notify.permissionAnswered()
        assertEquals(NotifyState.Denied, app.notify.state(DeviceReminders.CHANNEL))

        // Later the user allows notifications in Android's settings.
        TestDevice.instrumentation.uiAutomation.grantRuntimePermission(app.packageName, Notify.PERMISSION)
        val allowed = TestDevice.waitUntil(WAIT_MILLIS) { notificationManager.areNotificationsEnabled() }
        assertTrue("Android does not show notifications after the permission was granted", allowed)
        assertEquals(NotifyState.Ready, app.notify.state(DeviceReminders.CHANNEL))
    }

    @Test
    fun theAppHasTheThreePermissionsOfTheModulesManifestAndNoOther() {
        val asked = app.packageManager
            .getPackageInfo(app.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
            .requestedPermissions.orEmpty().toSet()

        assertEquals(
            setOf(
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.USE_EXACT_ALARM",
                "android.permission.RECEIVE_BOOT_COMPLETED",
            ),
            asked,
        )
    }

    @Test
    fun startMadeTheChannel() {
        val channel = notificationManager.getNotificationChannel(DeviceReminders.CHANNEL.id)

        assertEquals("Reminders", channel.name.toString())
        assertEquals("Reminders of the tests of core/notify", channel.description)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
    }

    private companion object {
        const val WAIT_MILLIS = 10_000L
    }
}
