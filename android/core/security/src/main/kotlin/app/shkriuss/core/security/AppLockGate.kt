package app.shkriuss.core.security

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.shkriuss.core.design.ShkScreen

/**
 * The gate of the optional app lock. Every screen of an app puts its
 * content in it, inside `ShkTheme`:
 *
 * ```kotlin
 * setContent { ShkTheme { AppLockGate { WaterScreen(model) } } }
 * ```
 *
 * While the app is locked, [content] is not composed: nothing of it is
 * drawn, and TalkBack cannot reach it. The lock screen shows instead, and
 * the system prompt unlocks the app. The saved state of [content] is
 * kept, and so are the screen's ViewModels, so the screen comes back as
 * it was, with the result of a picker it opened.
 *
 * The rows of the database are not encrypted by the app lock. This is an
 * access gate for them. The files need the prompt for their keys
 * ("The app lock" in crypto-design.md).
 *
 * It fails at once if the app's [AppLockWatcher] did not see this screen
 * start: the app class must call [AppLockWatcher.start] in its
 * `onCreate`.
 */
@Composable
fun AppLockGate(content: @Composable () -> Unit) {
    val activity = LocalActivity.current as? ComponentActivity ?: error("AppLockGate needs the screen's ComponentActivity")
    val host = activity.securityHost
    val watcher = host.appLock
    check(watcher.knows(activity)) { "The app class must call AppLockWatcher.start() in onCreate, before any screen starts" }
    val holder = rememberSaveableStateHolder()
    when (watcher.gateNow) {
        AppGate.OPEN -> holder.SaveableStateProvider(CONTENT_KEY) { content() }
        AppGate.LOCKED -> Locked(activity, watcher)
        AppGate.CHECKING -> ShkScreen {}
    }
    watcher.notice?.let { notice -> Notice(notice, activity, watcher) }
}

private const val CONTENT_KEY = "app.shkriuss.core.security.content"

@OptIn(SecurityScreenSamples::class)
@Composable
private fun Locked(activity: ComponentActivity, watcher: AppLockWatcher) {
    val crypto = activity.securityHost.crypto
    val model = remember(activity) { activity.viewModelOf { UnlockViewModel(crypto, watcher::unlocked) } }
    val screen by model.state.collectAsState()
    val lock = watcher.locks
    LaunchedEffect(lock) { model.onLocked(lock) }
    // Back leaves the app. It never reaches the screen behind the lock.
    BackHandler { activity.moveTaskToBack(true) }
    val appName = remember(activity) { activity.applicationInfo.loadLabel(activity.packageManager).toString() }
    LockContent(
        screen = screen,
        appName = appName,
        actions = LockActions(
            onUnlock = {
                watcher.refresh()
                model.onUnlock()
            },
            onRepair = { activity.startActivity(SecurityScreens.enterIntent(activity)) },
        ),
    )
    SystemPrompt(
        request = screen.prompt,
        title = stringResource(R.string.sec_prompt_unlock),
        subtitle = stringResource(R.string.sec_prompt_subtitle),
        onResult = model::onPromptResult,
    )
}

@Composable
private fun Notice(notice: AppLockNotice, activity: ComponentActivity, watcher: AppLockWatcher) {
    val dialog = when (notice) {
        AppLockNotice.RESET -> AppLockDialog.RESET_NOTICE
        AppLockNotice.TURNED_OFF -> AppLockDialog.TURNED_OFF_NOTICE
    }
    AppLockDialogView(
        dialog = dialog,
        inPlace = false,
        lockAfter = watcher.lockAfter,
        onLockAfter = {},
        onConfirm = {
            val next = if (notice == AppLockNotice.RESET) SecurityScreens.enterIntent(activity) else SecurityScreens.appLockIntent(activity)
            activity.startActivity(next)
        },
        onDismiss = watcher::dismissNotice,
    )
}

/**
 * The ViewModel of type [T] of this screen, made once with [make] and kept
 * while the phone is turned. It ends when the screen finishes.
 */
internal inline fun <reified T : ViewModel> ComponentActivity.viewModelOf(crossinline make: () -> T): T {
    val factory = object : ViewModelProvider.Factory {
        override fun <V : ViewModel> create(modelClass: Class<V>): V = modelClass.cast(make())!!
    }
    return ViewModelProvider(this, factory)[T::class.java]
}
