package app.shkriuss.core.security

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import androidx.compose.ui.Modifier
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.platform.LocalView

/**
 * Keeps other apps away from the window of [activity]
 * ("Overlays and accessibility services" in security-screens.md):
 *
 * 1. A tap is ignored where another app's window covers the screen. That
 *    stops a see-through window on top from steering a tap, for example
 *    onto "Give up the files".
 * 2. On Android 14 and later, only accessibility services that declare
 *    themselves accessibility tools, such as TalkBack, may read the window
 *    or act on it. Android 13 has no way to say this.
 *
 * Neither needs a permission. Every screen of this module calls it, through
 * [secureWindow] or itself, in `onCreate`, before anything is drawn. The
 * screen's dialogs take it over with [shieldedLike].
 *
 * [on] false undoes it. Only the Catalog does that, through [secureWindow].
 */
fun shieldWindow(activity: Activity, on: Boolean = true) = shieldRoot(activity.window.decorView, on)

/**
 * [shieldWindow] for the window whose root view is [root]. The views below
 * it inherit both settings.
 */
internal fun shieldRoot(root: View, on: Boolean) {
    root.filterTouchesWhenObscured = on
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        root.setAccessibilityDataSensitive(
            if (on) View.ACCESSIBILITY_DATA_SENSITIVE_YES else View.ACCESSIBILITY_DATA_SENSITIVE_AUTO,
        )
    }
}

/**
 * While the window of [activity] shows, Android hides the windows that
 * other apps draw over other apps: a fake screen on top, a see-through
 * window or a floating button. Android's own windows stay: the status
 * bar, the keyboard, TalkBack and the system prompt.
 *
 * It needs the permission `HIDE_OVERLAY_WINDOWS` (ADR 0033), which this
 * module's manifest asks for. Without it, Android would throw, so this
 * does nothing instead and the screen still works. `ManifestTest` checks
 * the module's manifest, and the APK rules check is to check each app
 * (security-screens.md, "Open").
 */
internal fun hideOtherAppsWindows(activity: Activity, hide: Boolean = true) {
    if (activity.checkSelfPermission(Manifest.permission.HIDE_OVERLAY_WINDOWS) != PackageManager.PERMISSION_GRANTED) return
    activity.window.setHideOverlayWindows(hide)
}

/**
 * A screen of this module. It ignores covered taps, speaks only to
 * accessibility tools, and hides other apps' windows itself, always. The
 * app lock leaves that part of its window alone.
 */
internal interface ShieldedScreen

/**
 * Gives a dialog's window the protection that [shieldWindow] gave the
 * window of [screen], the screen it opens over: if that screen is
 * shielded, so is the dialog. A dialog is a window of its own, so it does
 * not inherit this by itself, as it inherits `FLAG_SECURE`. A dialog over a
 * screen that is not shielded, such as a notice of the app lock over an
 * app's screen, stays as it is.
 *
 * Pass it as the modifier of the dialog, with the screen's
 * `LocalView.current`.
 */
internal fun Modifier.shieldedLike(screen: View): Modifier = this then ShieldedLikeElement(screen)

private class ShieldedLikeElement(private val screen: View) : ModifierNodeElement<ShieldedLikeNode>() {
    override fun create() = ShieldedLikeNode(screen)

    override fun update(node: ShieldedLikeNode) {
        node.screen = screen
        node.copyShield()
    }

    override fun equals(other: Any?) = other is ShieldedLikeElement && other.screen === screen

    override fun hashCode() = System.identityHashCode(screen)
}

/** Copies the shield of [screen]'s window onto the window the node is drawn in, when it is attached. */
private class ShieldedLikeNode(var screen: View) : Modifier.Node(), CompositionLocalConsumerModifierNode {
    override fun onAttach() = copyShield()

    fun copyShield() {
        if (!isAttached) return
        shieldRoot(currentValueOf(LocalView).rootView, on = screen.rootView.filterTouchesWhenObscured)
    }
}
