package app.shkriuss.core.crypto

import android.app.KeyguardManager
import android.os.SystemClock
import app.shkriuss.core.testing.TestDevice
import org.junit.Assert.assertTrue

/**
 * The emulator's screen lock, set and removed as the shell user with
 * Android's `locksettings` command. The lock is always a PIN.
 *
 * It remembers the PIN it set, so that every later step can give the old
 * PIN. A wrong PIN is never tried: Android slows down after wrong tries.
 */
internal object ScreenLock {
    private const val FIRST_PIN = "1357"
    private const val SECOND_PIN = "2468"
    private const val TIMEOUT_MILLIS = 30_000L
    private const val BOUNCER_MILLIS = 1_500L

    private var pin: String? = null

    private val keyguard: KeyguardManager
        get() = TestDevice.context.getSystemService(KeyguardManager::class.java)

    /** The PIN that is set now. Fails if there is none. */
    val currentPin: String get() = checkNotNull(pin) { "No screen lock is set" }

    /** Sets a PIN on an emulator that has no screen lock. The emulator stays unlocked. */
    fun set() {
        check(pin == null) { "A screen lock is already set" }
        // The screen must stay on: a screen that turns off locks the emulator.
        TestDevice.shell("svc power stayon true")
        val said = TestDevice.shell("locksettings set-pin $FIRST_PIN")
        assertTrue("The screen lock was not set: $said", TestDevice.waitUntil(TIMEOUT_MILLIS) { keyguard.isDeviceSecure })
        pin = FIRST_PIN
    }

    /** Changes the PIN to another one. */
    fun change() {
        val old = currentPin
        val new = if (old == FIRST_PIN) SECOND_PIN else FIRST_PIN
        val said = TestDevice.shell("locksettings set-pin --old $old $new")
        val verified = TestDevice.shell("locksettings verify --old $new")
        assertTrue("The screen lock was not changed: $said $verified", "verified successfully" in verified)
        pin = new
    }

    /** Removes the screen lock. */
    fun remove() {
        val said = TestDevice.shell("locksettings clear --old $currentPin")
        assertTrue("The screen lock was not removed: $said", TestDevice.waitUntil(TIMEOUT_MILLIS) { !keyguard.isDeviceSecure })
        pin = null
    }

    /** Leaves the emulator unlocked and without a screen lock, whatever a test did before. */
    fun reset() {
        if (pin == null && !keyguard.isDeviceSecure) return
        check(pin != null) { "The emulator has a screen lock that these tests did not set" }
        if (keyguard.isDeviceLocked) unlockPhone()
        remove()
    }

    /** Turns the screen off and waits until Android says the phone is locked. */
    fun lockPhone() {
        currentPin
        TestDevice.shell("input keyevent KEYCODE_SLEEP")
        assertTrue("The emulator did not lock", TestDevice.waitUntil(TIMEOUT_MILLIS) { keyguard.isDeviceLocked })
    }

    /** Turns the screen on and types the PIN. */
    fun unlockPhone() {
        TestDevice.shell("input keyevent KEYCODE_WAKEUP")
        TestDevice.shell("wm dismiss-keyguard")
        SystemClock.sleep(BOUNCER_MILLIS)
        TestDevice.shell("input text $currentPin")
        TestDevice.shell("input keyevent KEYCODE_ENTER")
        assertTrue("The emulator did not unlock", TestDevice.waitUntil(TIMEOUT_MILLIS) { !keyguard.isDeviceLocked })
    }
}
