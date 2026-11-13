package app.shkriuss.catalog

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSwitch
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.security.AppLockActions
import app.shkriuss.core.security.AppLockAsking
import app.shkriuss.core.security.AppLockContent
import app.shkriuss.core.security.AppLockDialog
import app.shkriuss.core.security.AppLockDialogSample
import app.shkriuss.core.security.AppLockSettingsScreen
import app.shkriuss.core.security.CannotTurnOn
import app.shkriuss.core.security.EnterWords
import app.shkriuss.core.security.KeepNote
import app.shkriuss.core.security.LockActions
import app.shkriuss.core.security.LockAfter
import app.shkriuss.core.security.LockContent
import app.shkriuss.core.security.LockNote
import app.shkriuss.core.security.LockScreen
import app.shkriuss.core.security.SecurityScreenSamples
import app.shkriuss.core.security.TurnOnActions
import app.shkriuss.core.security.TurnOnAllWords
import app.shkriuss.core.security.TurnOnContent
import app.shkriuss.core.security.TurnOnDone
import app.shkriuss.core.security.TurnOnFourWords
import app.shkriuss.core.security.TurnOnIntro
import app.shkriuss.core.security.TurnOnLocking
import app.shkriuss.core.security.secureWindow

/** The states of the app lock screens that the page shows, in this order. */
enum class AppLockSample(@param:StringRes val title: Int) {
    LockLocked(R.string.sample_lock_locked),
    LockFailed(R.string.sample_lock_failed),
    LockDamaged(R.string.sample_lock_damaged),
    SettingsAsking(R.string.sample_lock_settings_asking),
    SettingsOff(R.string.sample_lock_settings_off),
    SettingsNoScreenLock(R.string.sample_lock_settings_no_screen_lock),
    SettingsNoRecoveryKey(R.string.sample_lock_settings_no_key),
    SettingsOn(R.string.sample_lock_settings_on),
    SettingsReset(R.string.sample_lock_settings_reset),
    DialogLockAfter(R.string.sample_lock_dialog_lock_after),
    DialogTurnOff(R.string.sample_lock_dialog_turn_off),
    NoticeReset(R.string.sample_lock_notice_reset),
    NoticeTurnedOff(R.string.sample_lock_notice_turned_off),
    TurnOnKeeper(R.string.sample_lock_turn_on_keeper),
    TurnOnNotKeeper(R.string.sample_lock_turn_on_not_keeper),
    TurnOnFourWordsMissed(R.string.sample_lock_turn_on_four),
    TurnOnAllWords(R.string.sample_lock_turn_on_all),
    TurnOnPromptClosed(R.string.sample_lock_turn_on_prompt),
    TurnOnDone(R.string.sample_lock_turn_on_done),
}

/**
 * The app lock screens from `core/security`, each state with sample data,
 * full window: the lock screen, the app lock screen, its dialogs, and
 * turning the app lock on. Catalog holds no keys and has no app lock, so
 * nothing here locks, unlocks or shows the system prompt. The screens
 * that take words block screenshots in an app; here a switch does.
 */
@Composable
fun AppLockScreensPage(modifier: Modifier = Modifier) {
    var open by rememberSaveable { mutableStateOf<AppLockSample?>(null) }
    var blocked by rememberSaveable { mutableStateOf(false) }
    val activity = LocalActivity.current
    DisposableEffect(blocked, activity) {
        if (activity != null && blocked) secureWindow(activity, on = true)
        onDispose { if (activity != null && blocked) secureWindow(activity, on = false) }
    }
    val sample = open
    if (sample != null) {
        BackHandler { open = null }
        Sample(sample, onBack = { open = null }, modifier = modifier)
    } else {
        ShkScreen(modifier = modifier, scrollable = true) {
            PageTitle(stringResource(R.string.page_app_lock_title))
            PageIntro(stringResource(R.string.app_lock_intro))
            SectionHeading(stringResource(R.string.recovery_key_block_heading))
            ShkSwitch(
                text = stringResource(R.string.recovery_key_block),
                checked = blocked,
                onCheckedChange = { blocked = it },
            )
            SectionHeading(stringResource(R.string.recovery_key_states_heading))
            ShkCard {
                AppLockSample.entries.forEach { entry ->
                    ShkListItem(headline = stringResource(entry.title), onClick = { open = entry })
                }
            }
        }
    }
}

/** Sample words, from the word list. They are no real recovery key. */
private val sampleWords: List<String> by lazy { List(24) { RecoveryWords.list[it * 85] } }

/** The name the lock screen samples give the app. */
private const val SAMPLE_APP = "Water"

@OptIn(SecurityScreenSamples::class)
@Composable
private fun Sample(sample: AppLockSample, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val settings = AppLockActions(onBack = onBack)
    val turnOn = TurnOnActions(onBack = onBack)
    when (sample) {
        AppLockSample.LockLocked -> LockContent(LockScreen(), SAMPLE_APP, LockActions(), modifier)
        AppLockSample.LockFailed -> LockContent(LockScreen(note = LockNote.FAILED), SAMPLE_APP, LockActions(), modifier)
        AppLockSample.LockDamaged -> LockContent(LockScreen(note = LockNote.DAMAGED), SAMPLE_APP, LockActions(), modifier)
        AppLockSample.SettingsAsking -> AppLockContent(AppLockAsking(), false, settings, modifier)
        AppLockSample.SettingsOff -> AppLockContent(AppLockSettingsScreen(AppLockState.OFF), false, settings, modifier)
        AppLockSample.SettingsNoScreenLock -> AppLockContent(
            AppLockSettingsScreen(AppLockState.OFF, cannotTurnOn = CannotTurnOn.NO_SCREEN_LOCK),
            false,
            settings,
            modifier,
        )
        AppLockSample.SettingsNoRecoveryKey -> AppLockContent(
            AppLockSettingsScreen(AppLockState.OFF, cannotTurnOn = CannotTurnOn.NO_RECOVERY_KEY),
            true,
            settings,
            modifier,
        )
        AppLockSample.SettingsOn -> AppLockContent(
            AppLockSettingsScreen(AppLockState.ON, lockAfter = LockAfter.FIVE_MINUTES, blockScreenshots = true),
            false,
            settings,
            modifier,
        )
        AppLockSample.SettingsReset -> AppLockContent(AppLockSettingsScreen(AppLockState.RESET), false, settings, modifier)
        AppLockSample.DialogLockAfter -> DialogSample(sample, AppLockDialog.LOCK_AFTER, onBack, modifier)
        AppLockSample.DialogTurnOff -> DialogSample(sample, AppLockDialog.TURN_OFF, onBack, modifier)
        AppLockSample.NoticeReset -> DialogSample(sample, AppLockDialog.RESET_NOTICE, onBack, modifier)
        AppLockSample.NoticeTurnedOff -> DialogSample(sample, AppLockDialog.TURNED_OFF_NOTICE, onBack, modifier)
        AppLockSample.TurnOnKeeper -> TurnOnContent(TurnOnIntro(keeper = true), false, turnOn, modifier)
        AppLockSample.TurnOnNotKeeper -> TurnOnContent(TurnOnIntro(keeper = false), false, turnOn, modifier)
        AppLockSample.TurnOnFourWordsMissed -> TurnOnContent(
            TurnOnFourWords(listOf(2, 9, 15, 24), listOf(sampleWords[1], sampleWords[8], "zoo", sampleWords[23]), mismatch = true),
            false,
            turnOn,
            modifier,
        )
        AppLockSample.TurnOnAllWords -> TurnOnContent(
            TurnOnAllWords(EnterWords(sampleWords.take(5) + List(19) { "" }, current = 5, typed = "")),
            false,
            turnOn,
            modifier,
        )
        AppLockSample.TurnOnPromptClosed -> TurnOnContent(TurnOnLocking(note = KeepNote.CANCELLED), false, turnOn, modifier)
        AppLockSample.TurnOnDone -> TurnOnContent(TurnOnDone, false, turnOn, modifier)
    }
}

/** A dialog of the app lock, drawn in place on a screen of its own, with the timer at five minutes. */
@OptIn(SecurityScreenSamples::class)
@Composable
private fun DialogSample(sample: AppLockSample, dialog: AppLockDialog, onBack: () -> Unit, modifier: Modifier) {
    ShkScreen(modifier = modifier, scrollable = true, topBar = { ShkTopBar(title = stringResource(sample.title), onBack = onBack) }) {
        AppLockDialogSample(dialog, lockAfter = LockAfter.FIVE_MINUTES)
    }
}
