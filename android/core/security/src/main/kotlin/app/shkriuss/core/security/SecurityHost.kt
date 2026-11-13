package app.shkriuss.core.security

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.view.View
import android.view.WindowManager
import app.shkriuss.core.crypto.ShkCrypto

/**
 * The app class of every app that uses these screens. Android creates the
 * screens itself, so nothing can be passed to them through a constructor.
 * They reach the app's one [ShkCrypto] through the app class instead, as
 * `core/notify` reaches its `Notify` (ADR 0030).
 */
interface SecurityHost {
    /** The app's one [ShkCrypto], built and started when the app starts. */
    val crypto: ShkCrypto
}

/**
 * The ways into the recovery key screens. An app's settings open the
 * security screen; its first start can open the create or enter flow
 * directly. Each is a screen of its own that blocks screenshots.
 */
object SecurityScreens {
    internal const val EXTRA_START_OVER = "app.shkriuss.core.security.START_OVER"

    /** The security screen: the recovery key, the screen lock, and where each key lives. */
    fun securityIntent(context: Context): Intent = Intent(context, SecurityActivity::class.java)

    /** Create a recovery key: the 24 words, four of them to confirm, then the keys. */
    fun createIntent(context: Context): Intent = Intent(context, CreateRecoveryKeyActivity::class.java)

    /** Enter the 24 words of a recovery key the user already has. */
    fun enterIntent(context: Context): Intent = Intent(context, EnterRecoveryKeyActivity::class.java)

    /** Show the kept recovery key again, after the system prompt. */
    internal fun showIntent(context: Context): Intent = Intent(context, ShowRecoveryKeyActivity::class.java)

    /** Start a setup that stopped over: with a new key ([create]) or with other words. */
    internal fun startOverIntent(context: Context, create: Boolean): Intent =
        (if (create) createIntent(context) else enterIntent(context)).putExtra(EXTRA_START_OVER, true)
}

/**
 * Blocks screenshots, screen recording and the recent-apps preview of the
 * window of [activity], and keeps autofill and content capture away from
 * it ("Screens that show or take the words" in crypto-design.md). Every
 * screen of this module calls it in `onCreate`, before anything is drawn.
 *
 * [on] false undoes it. Only the Catalog does that, so that its samples of
 * these screens can be sent as screenshots.
 */
fun secureWindow(activity: Activity, on: Boolean = true) {
    if (on) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
    activity.setRecentsScreenshotEnabled(!on)
    val decor = activity.window.decorView
    decor.importantForAutofill =
        if (on) View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS else View.IMPORTANT_FOR_AUTOFILL_AUTO
    decor.importantForContentCapture =
        if (on) View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS else View.IMPORTANT_FOR_CONTENT_CAPTURE_AUTO
}

/**
 * Marks the screens of this module drawn without their window. Shown
 * that way, they do not block screenshots. Only the Catalog opts in, to
 * show them with sample data. Apps open them through [SecurityScreens].
 */
@RequiresOptIn(
    level = RequiresOptIn.Level.ERROR,
    message = "Outside their own screen these do not block screenshots. Apps use SecurityScreens.",
)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.FUNCTION)
annotation class SecurityScreenSamples

/** The app's [SecurityHost]. */
internal val Activity.securityHost: SecurityHost
    get() = application as? SecurityHost ?: error("The app class must implement SecurityHost")

/** True for a preview build, whose application ID ends in `.preview`. */
internal val Context.isPreviewBuild: Boolean get() = packageName.endsWith(".preview")
