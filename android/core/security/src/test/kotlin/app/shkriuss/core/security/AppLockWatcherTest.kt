package app.shkriuss.core.security

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.os.Looper
import android.os.PowerManager
import android.view.WindowManager
import androidx.activity.ComponentActivity
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.RecoveryKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/**
 * When the app lock locks the app, what every window hides, and what the
 * watcher tells notifications (docs/architecture/security-screens.md,
 * "When the app locks"). The screens are started and stopped as Android
 * does; the clock the user cannot change is the test's.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class AppLockWatcherTest {
    private val app = RuntimeEnvironment.getApplication() as TestHostApp
    private val watcher get() = app.appLock
    private val power = shadowOf(app.getSystemService(PowerManager::class.java))

    @Before
    fun aPhoneWithItsScreenOn() {
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
        power.turnScreenOn(true)
    }

    /** Gives the app a recovery key and turns the app lock on, as the turn-on screen does. The app is unlocked. */
    private fun turnOn(): RecoveryKey {
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        app.crypto.appLock.beginTurnOn(app.crypto.setup.checkAllWords(key)!!).finish()
        watcher.turnedOn()
        return key
    }

    /** One screen of the app, started and on the screen. */
    private fun screen(): ActivityController<ComponentActivity> = Robolectric.buildActivity(ComponentActivity::class.java).setup()

    private fun leave(screen: ActivityController<*>) {
        screen.pause().stop()
    }

    private fun comeBack(screen: ActivityController<*>) {
        screen.restart().resume()
    }

    private fun assertLocked() {
        assertEquals(AppGate.LOCKED, watcher.gate.value)
        assertEquals(AppGate.LOCKED, watcher.gateNow)
        assertTrue("the file keys left memory", app.crypto.appLock.isLocked())
    }

    private fun assertOpen() {
        assertEquals(AppGate.OPEN, watcher.gate.value)
        assertFalse(app.crypto.appLock.isLocked())
    }

    // When it locks.

    @Test
    fun byDefaultTheAppLocksAsSoonAsItLeavesTheScreen() {
        turnOn()
        val screen = screen()
        assertOpen()

        leave(screen)

        assertLocked()
        comeBack(screen)
        assertLocked()
    }

    @Test
    fun withATimerTheAppLocksOnlyWhenItComesBackAfterTheTimeAway() {
        turnOn()
        watcher.lockAfter = LockAfter.FIVE_MINUTES
        val screen = screen()

        leave(screen)
        assertOpen()
        app.now += FIVE_MINUTES - 1
        comeBack(screen)
        assertOpen()

        leave(screen)
        app.now += FIVE_MINUTES
        comeBack(screen)
        assertLocked()
    }

    @Test
    fun eachChoiceOfTimeLocksAtItsOwnTime() {
        turnOn()
        val screen = screen()
        LockAfter.entries.filter { it != LockAfter.LEAVING }.forEach { choice ->
            watcher.lockAfter = choice
            leave(screen)
            app.now += choice.millis - 1
            comeBack(screen)
            assertEquals("$choice, a moment early", AppGate.OPEN, watcher.gate.value)
            leave(screen)
            app.now += choice.millis
            comeBack(screen)
            assertEquals("$choice, on time", AppGate.LOCKED, watcher.gate.value)
            app.crypto.appLock.beginUnlock().finish()
            watcher.unlocked()
        }
    }

    @Test
    fun theScreenTurningOffWithTheAppOnItLocksAtOnceWhateverTheTimer() {
        turnOn()
        watcher.lockAfter = LockAfter.ONE_HOUR
        val screen = screen()

        power.turnScreenOn(false)
        leave(screen)

        assertLocked()
    }

    @Test
    fun aScreenOffBroadcastLocksOnlyWhileTheScreenIsStillOff() {
        turnOn()
        watcher.lockAfter = LockAfter.ONE_HOUR
        leave(screen())

        // Android 14 and later hold the broadcast back while the app waits. One that comes after the screen is on again is ignored.
        app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
        shadowOf(Looper.getMainLooper()).idle()
        assertOpen()

        power.turnScreenOn(false)
        app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
        shadowOf(Looper.getMainLooper()).idle()
        assertLocked()
    }

    @Test
    fun aTurnOfThePhoneIsNoLeaving() {
        turnOn()
        val screen = screen()

        screen.configurationChange(Configuration(app.resources.configuration).apply { orientation = Configuration.ORIENTATION_LANDSCAPE })

        assertOpen()
    }

    @Test
    fun goingFromOneScreenOfTheAppToAnotherIsNoLeaving() {
        turnOn()
        val first = screen()
        val second = screen()

        leave(first)
        assertOpen()

        leave(second)
        assertLocked()
    }

    @Test
    fun anAppWhoseFileKeysAreNotInMemoryStartsLocked() {
        turnOn()
        // What Android stopping the app leaves: no file keys in memory.
        app.crypto.appLock.lock()
        val fresh = AppLockWatcher(app, app.crypto, onTextHidden = {}, elapsed = { app.now }, background = atOnce, main = atOnce)
        assertEquals("nothing shows before the first read", AppGate.CHECKING, fresh.gate.value)

        fresh.refresh()

        assertEquals(AppGate.LOCKED, fresh.gate.value)
    }

    @Test
    fun aKeysetWriteThatDropsTheKeysIsSeenAtTheNextRead() {
        val key = turnOn()
        assertOpen()

        // Keeping the recovery key writes a keyset file, and every keyset leaves memory with it.
        app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        watcher.refresh()

        assertLocked()
    }

    // What the windows hide.

    @Test
    fun theOptionBlocksScreenshotsInEveryScreenOfTheAppButLeavesTheWordScreensAlone() {
        val screen = screen().get()
        val words = Robolectric.buildActivity(EnterRecoveryKeyActivity::class.java).setup().get()
        assertFalse(screen.isSecure())

        watcher.blocksScreenshots = true
        assertTrue(screen.isSecure())
        assertTrue("a new screen too", screen().get().isSecure())

        watcher.blocksScreenshots = false
        assertFalse(screen.isSecure())
        assertTrue("the word screens always block screenshots", words.isSecure())
    }

    private fun ComponentActivity.isSecure() = window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test
    fun whileTheAppIsLockedEveryScreenOfItHidesOtherAppsWindows() {
        app.allowHidingOtherAppsWindows(true)
        turnOn()
        val screen = screen()
        assertFalse("unlocked: the app's screens leave other apps alone", screen.get().hidesOtherAppsWindows())

        leave(screen)
        assertLocked()
        assertTrue(screen.get().hidesOtherAppsWindows())
        assertTrue("a screen that starts while locked too", screen().get().hidesOtherAppsWindows())

        app.crypto.appLock.beginUnlock().finish()
        watcher.unlocked()
        assertOpen()
        assertFalse(screen.get().hidesOtherAppsWindows())
    }

    @Test
    fun aLockOnTheWayBackHidesOtherAppsWindowsBeforeTheScreenStarts() {
        app.allowHidingOtherAppsWindows(true)
        turnOn()
        watcher.lockAfter = LockAfter.FIVE_MINUTES
        val screen = screen()
        leave(screen)
        assertFalse(screen.get().hidesOtherAppsWindows())
        var hidingWhenStarted: Boolean? = null
        app.registerActivityLifecycleCallbacks(
            object : EmptyLifecycleCallbacks() {
                // Called after the watcher's own, before onStart: Android has not drawn the screen again yet.
                override fun onActivityPreStarted(activity: Activity) {
                    hidingWhenStarted = activity.hidesOtherAppsWindows()
                }
            },
        )

        app.now += FIVE_MINUTES
        comeBack(screen)

        assertLocked()
        assertEquals("set before the screen starts again and is drawn", true, hidingWhenStarted)
    }

    @Test
    fun theScreensOfTheModuleHideOtherAppsWindowsAlsoWhileTheAppIsUnlocked() {
        app.allowHidingOtherAppsWindows(true)
        turnOn()
        val words = Robolectric.buildActivity(EnterRecoveryKeyActivity::class.java).setup().get()
        val settings = Robolectric.buildActivity(AppLockActivity::class.java).setup().get()

        assertOpen()
        assertTrue(words.hidesOtherAppsWindows())
        assertTrue(settings.hidesOtherAppsWindows())
    }

    @Test
    fun withoutThePermissionALockedAppStillShowsItsLockScreen() {
        app.allowHidingOtherAppsWindows(false)
        turnOn()
        val screen = screen()

        leave(screen)
        comeBack(screen)

        assertLocked()
        assertFalse(screen.get().hidesOtherAppsWindows())
    }

    /** Lifecycle callbacks that do nothing, so a test overrides only the one it needs. */
    private open class EmptyLifecycleCallbacks : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

        override fun onActivityStarted(activity: Activity) = Unit

        override fun onActivityResumed(activity: Activity) = Unit

        override fun onActivityPaused(activity: Activity) = Unit

        override fun onActivityStopped(activity: Activity) = Unit

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    // Notifications.

    @Test
    fun notificationsHideTheirTextWhileTheAppLockIsOnUnlessTheUserAsks() {
        assertFalse(watcher.hidesNotificationText())
        turnOn()
        assertTrue(watcher.hidesNotificationText())

        watcher.showsNotificationText = true
        assertFalse(watcher.hidesNotificationText())
    }

    @Test
    fun theTextOfShownNotificationsIsHiddenWhenTheAppLockTurnsOnOrTheSwitchGoesOff() {
        watcher.showsNotificationText = false
        assertEquals("the app lock is off: nothing to hide", 0, app.textHidden)

        turnOn()
        assertEquals(1, app.textHidden)

        watcher.showsNotificationText = true
        assertEquals(1, app.textHidden)
        watcher.showsNotificationText = false
        assertEquals(2, app.textHidden)
    }

    // What the user is told.

    @Test
    fun aRemovedScreenLockWhileLockedResetsTheAppLockAndSaysSoOnce() {
        turnOn()
        leave(screen())
        assertLocked()

        app.keys.screenLock = false
        watcher.refresh()

        assertEquals(AppLockState.RESET, app.crypto.appLock.state())
        assertEquals(AppLockNotice.RESET, watcher.notice)
        assertEquals("the records are no longer behind the lock", AppGate.OPEN, watcher.gate.value)
        watcher.dismissNotice()
        watcher.refresh()
        assertNull(watcher.notice)
    }

    @Test
    fun aRemovedScreenLockWhileUnlockedTurnsTheAppLockOffAndSaysSo() {
        turnOn()

        app.keys.screenLock = false
        watcher.refresh()

        assertEquals(AppLockState.OFF, app.crypto.appLock.state())
        assertEquals(AppLockNotice.TURNED_OFF, watcher.notice)
    }

    @Test
    fun turningItOffYourselfSaysNothing() {
        turnOn()

        app.crypto.appLock.turnOff()
        watcher.turnedOff()

        assertNull(watcher.notice)
        assertEquals(AppGate.OPEN, watcher.gate.value)
    }

    @Test
    fun aQuietReadSaysNothing() {
        turnOn()

        app.keys.screenLock = false
        watcher.refresh(announce = false)

        assertNull(watcher.notice)
    }

    private companion object {
        const val FIVE_MINUTES = 5 * 60_000L
    }
}
