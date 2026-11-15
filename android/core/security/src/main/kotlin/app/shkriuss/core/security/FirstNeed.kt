package app.shkriuss.core.security

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkDialogInPlace
import app.shkriuss.core.design.ShkInPlace
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * What the user started that needs the recovery key (ADR 0035, "The
 * recovery key comes when it is first needed"). An app opens on its main
 * screen with no setup, and the recovery key comes only when one of these
 * is first asked for.
 */
enum class RecoveryKeyNeed {
    /** Making a backup: it is locked with a key made from the recovery key. */
    BACKUP,

    /** Restoring a backup: it opens only with the recovery key it was made with. */
    RESTORE,

    /** The app lock: the recovery key is the way back in. */
    APP_LOCK,
}

/** The forms of the dialog that shows when the recovery key is first needed and the app has none. */
enum class FirstNeedForm {
    /** "Set up your recovery key first", for a backup: create one, enter one, or not now. */
    SET_UP_FOR_BACKUP,

    /** "Set up your recovery key first", for the app lock: create one, enter one, or not now. */
    SET_UP_FOR_APP_LOCK,

    /** "Enter your recovery key first", for a restore: enter the words, or cancel. A new key cannot open an old backup. */
    ENTER_FOR_RESTORE,

    /** "Finish your recovery key", after a setup that stopped: open the security screen, or not now. */
    FINISH,
}

/**
 * The form of the dialog for [need], or null if the app has its keys from
 * a recovery key and can go on at once. A setup that stopped comes first,
 * whatever the need: the security screen finishes it or starts it over.
 */
internal fun firstNeedForm(need: RecoveryKeyNeed, hasDerivedKeys: Boolean, setupIsUnfinished: Boolean): FirstNeedForm? = when {
    setupIsUnfinished -> FirstNeedForm.FINISH
    hasDerivedKeys -> null
    need == RecoveryKeyNeed.BACKUP -> FirstNeedForm.SET_UP_FOR_BACKUP
    need == RecoveryKeyNeed.APP_LOCK -> FirstNeedForm.SET_UP_FOR_APP_LOCK
    else -> FirstNeedForm.ENTER_FOR_RESTORE
}

/**
 * Where the moment "the recovery key is first needed" stands on a screen:
 * what the user started, and whether the dialog shows or a screen of the
 * recovery key is open for it. An app's screen makes one with
 * [rememberRecoveryKeyFirstNeedState], calls [start] from its buttons, and
 * draws [RecoveryKeyFirstNeed] with it. It is kept while the phone is
 * turned and when Android stops the app, so the app still goes on after a
 * long setup.
 */
@Stable
class RecoveryKeyFirstNeedState internal constructor(need: RecoveryKeyNeed?, form: FirstNeedForm?, away: Boolean, back: Boolean) {
    /** What the user started and is not done with yet, or null. */
    internal var need by mutableStateOf(need)
        private set

    /** The dialog that shows now, or null. */
    internal var form by mutableStateOf(form)

    /** True while a screen of the recovery key is open for [need]. */
    internal var away by mutableStateOf(away)
        private set

    /** True once that screen has closed, until the keys are read again. */
    internal var back by mutableStateOf(back)
        private set

    /** Counts the starts, so that the keys are read anew for each. Not saved: a new screen reads them anyway. */
    internal var starts by mutableIntStateOf(0)
        private set

    /**
     * The user started [need]: a backup, a restore or the app lock. With
     * the keys of a recovery key, the `onReady` of [RecoveryKeyFirstNeed]
     * runs at once. Without them the dialog shows first. A start while
     * another one is not done yet is ignored.
     */
    fun start(need: RecoveryKeyNeed) {
        if (this.need != null) return
        this.need = need
        starts++
    }

    /** A button of the dialog opens a screen of the recovery key. */
    internal fun leave() {
        form = null
        back = false
        away = true
    }

    /** That screen has closed, however it was closed. The keys are read again. */
    internal fun returned() {
        if (!away) return
        away = false
        back = true
    }

    /** The need is done with: the app went on, or the user said not now, or left the flow without the keys. */
    internal fun done() {
        need = null
        form = null
        away = false
        back = false
    }

    internal companion object {
        /** Saves what the user started and where it stands. No key and no word is ever in it. */
        val Saver: Saver<RecoveryKeyFirstNeedState, Any> = listSaver(
            save = { listOf(it.need?.name, it.form?.name, it.away, it.back) },
            restore = { saved ->
                RecoveryKeyFirstNeedState(
                    need = (saved[0] as String?)?.let(RecoveryKeyNeed::valueOf),
                    form = (saved[1] as String?)?.let(FirstNeedForm::valueOf),
                    away = saved[2] as Boolean,
                    back = saved[3] as Boolean,
                )
            },
        )
    }
}

/** The [RecoveryKeyFirstNeedState] of a screen, kept in its saved state. */
@Composable
fun rememberRecoveryKeyFirstNeedState(): RecoveryKeyFirstNeedState =
    rememberSaveable(saver = RecoveryKeyFirstNeedState.Saver) { RecoveryKeyFirstNeedState(need = null, form = null, away = false, back = false) }

/**
 * The moment the recovery key is first needed (ADR 0035), the same in
 * every app. An app draws it once on the screen whose buttons start a
 * backup, a restore or the app lock, inside `AppLockGate`:
 *
 * ```kotlin
 * val firstNeed = rememberRecoveryKeyFirstNeedState()
 * RecoveryKeyFirstNeed(firstNeed, onReady = { need -> model.goOn(need) })
 * ShkListItem(headline = "Make a backup", onClick = { firstNeed.start(RecoveryKeyNeed.BACKUP) })
 * ```
 *
 * After [RecoveryKeyFirstNeedState.start] it reads the app's keys:
 *
 * 1. The app has its keys from a recovery key: [onReady] runs at once.
 * 2. It has none: one dialog shows, in the form for what was started
 *    ([FirstNeedForm]). Its buttons open "Create your recovery key",
 *    "Enter your recovery key" or the security screen.
 * 3. When that screen closes, the keys are read again. If the app now has
 *    its keys, [onReady] runs, so the app goes on with what the user
 *    started, without another tap. If not, nothing else happens.
 *
 * [onReady] runs on the main thread. It gets what was started, so one
 * function can open the right next screen.
 */
@Composable
fun RecoveryKeyFirstNeed(state: RecoveryKeyFirstNeedState, onReady: (RecoveryKeyNeed) -> Unit) {
    RecoveryKeyFirstNeed(state, onReady, Dispatchers.IO)
}

/** [RecoveryKeyFirstNeed] with the thread the keys are read on. A hardware key can be slow; tests pass their own. */
@Composable
internal fun RecoveryKeyFirstNeed(state: RecoveryKeyFirstNeedState, onReady: (RecoveryKeyNeed) -> Unit, background: CoroutineDispatcher) {
    val activity = LocalActivity.current as? ComponentActivity ?: error("RecoveryKeyFirstNeed needs the screen's ComponentActivity")
    val crypto = activity.securityHost.crypto
    val goOn by rememberUpdatedState(onReady)
    // The result itself says nothing: the screens of the recovery key only close. The keys say whether they are there.
    val flow = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { state.returned() }

    val need = state.need
    if (need != null && state.form == null && !state.away) {
        // Runs for each start, and again when a screen of the recovery key has closed.
        LaunchedEffect(need, state.starts, state.back) {
            val form = try {
                withContext(background) {
                    val status = crypto.status()
                    firstNeedForm(need, status.hasDerivedKeys, status.setupIsUnfinished)
                }
            } catch (_: BlobException) {
                // The keys cannot be read now. Nothing happens; the security screen says what is wrong.
                state.done()
                return@LaunchedEffect
            }
            when {
                form == null -> {
                    state.done()
                    goOn(need)
                }
                // The user left the flow before the keys were stored: back on the screen, and nothing else happens.
                state.back -> state.done()
                else -> state.form = form
            }
        }
    }

    val form = state.form ?: return
    FirstNeedDialogView(
        form = form,
        inPlace = false,
        onCreate = {
            state.leave()
            flow.launch(SecurityScreens.createIntent(activity))
        },
        onEnter = {
            state.leave()
            flow.launch(SecurityScreens.enterIntent(activity))
        },
        onSecurity = {
            state.leave()
            flow.launch(SecurityScreens.securityIntent(activity))
        },
        onDismiss = state::done,
    )
}

/**
 * The dialog of [RecoveryKeyFirstNeed] in one of its forms, drawn in place
 * for the Catalog's samples. In an app it is a real dialog over the app's
 * screen.
 */
@SecurityScreenSamples
@Composable
fun RecoveryKeyFirstNeedSample(form: FirstNeedForm, modifier: Modifier = Modifier) {
    FirstNeedDialogView(form, inPlace = true, onCreate = {}, onEnter = {}, onSecurity = {}, onDismiss = {}, modifier = modifier)
}

/**
 * The dialog in the form [form]. A button that opens a screen only calls
 * its action: the caller stops showing the dialog. The way out, a tap
 * outside and Back call [onDismiss]. [inPlace] draws it without its
 * window, for the Catalog. In its window it takes the shield of the screen
 * it opens over, if that has one ([shieldedLike]).
 */
@OptIn(ShkInPlace::class)
@Composable
internal fun FirstNeedDialogView(
    form: FirstNeedForm,
    inPlace: Boolean,
    onCreate: () -> Unit,
    onEnter: () -> Unit,
    onSecurity: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title: String
    val text: String
    val confirm: ShkDialogAction
    val dismiss: ShkDialogAction
    var other: ShkDialogAction? = null
    when (form) {
        FirstNeedForm.SET_UP_FOR_BACKUP, FirstNeedForm.SET_UP_FOR_APP_LOCK -> {
            title = stringResource(R.string.sec_first_need_set_up_title)
            text = stringResource(
                if (form == FirstNeedForm.SET_UP_FOR_BACKUP) R.string.sec_first_need_backup_text else R.string.sec_first_need_app_lock_text,
            )
            confirm = ShkDialogAction(stringResource(R.string.sec_first_need_create), onCreate, closesDialog = false)
            other = ShkDialogAction(stringResource(R.string.sec_first_need_have_one), onEnter, closesDialog = false)
            dismiss = ShkDialogAction(stringResource(R.string.sec_first_need_not_now), {})
        }
        FirstNeedForm.ENTER_FOR_RESTORE -> {
            title = stringResource(R.string.sec_first_need_enter_title)
            text = stringResource(R.string.sec_first_need_restore_text)
            confirm = ShkDialogAction(stringResource(R.string.sec_first_need_enter), onEnter, closesDialog = false)
            dismiss = ShkDialogAction(stringResource(R.string.sec_cancel), {})
        }
        FirstNeedForm.FINISH -> {
            title = stringResource(R.string.sec_first_need_finish_title)
            text = stringResource(R.string.sec_first_need_finish_text)
            confirm = ShkDialogAction(stringResource(R.string.sec_first_need_open_security), onSecurity, closesDialog = false)
            dismiss = ShkDialogAction(stringResource(R.string.sec_first_need_not_now), {})
        }
    }
    if (inPlace) {
        ShkDialogInPlace(title = title, confirmAction = confirm, modifier = modifier, text = text, dismissAction = dismiss, otherAction = other)
    } else {
        ShkDialog(
            title = title,
            confirmAction = confirm,
            onDismissRequest = onDismiss,
            modifier = modifier.shieldedLike(LocalView.current),
            text = text,
            dismissAction = dismiss,
            otherAction = other,
        )
    }
}
