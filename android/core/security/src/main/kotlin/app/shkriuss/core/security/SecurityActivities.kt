package app.shkriuss.core.security

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.design.ShkTheme

/**
 * The ViewModel of this screen, made once with the app's [ShkCrypto] and
 * kept while the phone is turned. It ends when the screen finishes, and
 * the recovery key it holds goes with it.
 */
private inline fun <reified T : ViewModel> ComponentActivity.flowViewModel(crossinline make: (ShkCrypto) -> T): T {
    val crypto = securityHost.crypto
    return viewModelOf { make(crypto) }
}

/** The security screen. Its window blocks screenshots like every screen of this module. */
@OptIn(SecurityScreenSamples::class)
class SecurityActivity : ComponentActivity(), WordsScreen {
    private lateinit var model: SecurityViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val suite = AndroidSuiteApps(this)
        model = flowViewModel { SecurityViewModel(it, suite = suite) }
        val actions = SecurityActions(
            onBack = ::finish,
            onCreate = { startActivity(SecurityScreens.createIntent(this)) },
            onEnter = { startActivity(SecurityScreens.enterIntent(this)) },
            onStartOverCreate = { startActivity(SecurityScreens.startOverIntent(this, create = true)) },
            onStartOverEnter = { startActivity(SecurityScreens.startOverIntent(this, create = false)) },
            onShow = { startActivity(SecurityScreens.showIntent(this)) },
            onGiveUpFiles = model::onGiveUpFiles,
            onRetry = model::refresh,
            onAppLock = { startActivity(SecurityScreens.appLockIntent(this)) },
            onGetKeys = { startActivity(SecurityScreens.getKeysIntent(this, it.packageName)) },
            onOpenKeeper = { keeper -> suite.launchIntent(keeper.packageName)?.let(::startActivity) },
        )
        setContent {
            ShkTheme {
                val state by model.state.collectAsState()
                SecurityContent(state, isPreviewBuild, actions)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        model.refresh()
    }
}

/** Creating a recovery key. With the extra of [SecurityScreens.startOverIntent], it starts a stopped setup over. */
@OptIn(SecurityScreenSamples::class)
class CreateRecoveryKeyActivity : ComponentActivity(), WordsScreen {
    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val startOver = intent.getBooleanExtra(SecurityScreens.EXTRA_START_OVER, false)
        val suite = AndroidSuiteApps(this)
        val model = flowViewModel { CreateViewModel(it, startOver, suite = suite) }
        val actions = CreateActions(
            onBack = ::finish,
            onShowWords = model::onShowWords,
            onWordsWritten = model::onWordsWritten,
            onAnswerChange = model::onAnswerChange,
            onCheck = model::onCheck,
            step = FlowStepActions(
                onKeep = model::onKeepAgain,
                onSkipKeeping = model::onSkipKeeping,
                onDone = ::finish,
                onKeepHereToo = model::onKeepHereToo,
            ),
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                CreateContent(screen, isPreviewBuild, actions)
                SystemPrompt(
                    request = (screen as? FlowKeeping)?.prompt,
                    title = stringResource(R.string.sec_prompt_keep),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }
}

/** Entering the words. With the extra of [SecurityScreens.startOverIntent], they start a stopped setup over. */
@OptIn(SecurityScreenSamples::class)
class EnterRecoveryKeyActivity : ComponentActivity(), WordsScreen {
    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val startOver = intent.getBooleanExtra(SecurityScreens.EXTRA_START_OVER, false)
        val watcher = securityHost.appLock
        val suite = AndroidSuiteApps(this)
        val model = flowViewModel {
            EnterViewModel(it, startOver, onAppLockChanged = { watcher.refresh(announce = false) }, suite = suite)
        }
        val actions = EnterActions(
            onBack = ::finish,
            onTyped = model::onTyped,
            onWord = model::onWord,
            onEditWord = model::onEditWord,
            onCheck = model::onCheck,
            onStartOverWithThese = model::onStartOverWithThese,
            onEnterOther = model::onEnterOther,
            step = FlowStepActions(
                onKeep = model::onKeepAgain,
                onSkipKeeping = model::onSkipKeeping,
                onDone = ::finish,
                onAppLock = {
                    startActivity(SecurityScreens.appLockIntent(this))
                    finish()
                },
                onKeepHereToo = model::onKeepHereToo,
            ),
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                EnterContent(screen, isPreviewBuild, actions)
                SystemPrompt(
                    request = (screen as? FlowKeeping)?.prompt,
                    title = stringResource(R.string.sec_prompt_keep),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }
}

/** Showing the kept recovery key again. The words leave the screen when it stops. */
@OptIn(SecurityScreenSamples::class)
class ShowRecoveryKeyActivity : ComponentActivity(), WordsScreen {
    private lateinit var model: ShowViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model = flowViewModel { ShowViewModel(it) }
        val actions = ShowActions(
            onBack = ::finish,
            onShow = model::onShow,
            onEnterWords = {
                startActivity(SecurityScreens.enterIntent(this))
                finish()
            },
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                ShowContent(screen, isPreviewBuild, actions)
                SystemPrompt(
                    request = (screen as? ShowIntro)?.prompt,
                    title = stringResource(R.string.sec_prompt_show),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }

    override fun onStop() {
        super.onStop()
        model.onStop()
    }
}

/**
 * The app lock screen. While the app lock is on, it asks for the system
 * prompt each time it opens, and again after the app locked, before it
 * shows anything. Closing that prompt closes the screen. Whether the
 * window blocks screenshots follows the app's settings, as for every
 * screen of the app. Like the other screens of this module, it ignores
 * covered taps, speaks only to accessibility tools and hides other apps'
 * windows.
 */
@OptIn(SecurityScreenSamples::class)
class AppLockActivity : ComponentActivity(), ShieldedScreen {
    private lateinit var model: AppLockViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        shieldWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val watcher = securityHost.appLock
        model = flowViewModel { AppLockViewModel(it, watcher) }
        val actions = AppLockActions(
            onBack = ::finish,
            onTurnOn = { startActivity(SecurityScreens.turnOnIntent(this)) },
            onTurnOff = model::onTurnOff,
            onLockAfter = model::onLockAfter,
            onBlockScreenshots = model::onBlockScreenshots,
            onNotificationText = model::onNotificationText,
            onSecurity = { startActivity(SecurityScreens.securityIntent(this)) },
            onEnterWords = { startActivity(SecurityScreens.enterIntent(this)) },
            onRetry = model::refresh,
        )
        setContent {
            ShkTheme {
                val state by model.state.collectAsState()
                // The watcher locks in Android's callback before this screen starts again. Its state is read here
                // directly, so the first frame after a lock shows nothing of the settings.
                val screen = if (watcher.gateNow == AppGate.LOCKED && state is AppLockSettingsScreen) AppLockAsking() else state
                LaunchedEffect(screen) {
                    when (screen) {
                        is AppLockAsking -> if (screen.prompt == null) model.onAsk()
                        AppLockClosed -> finish()
                        else -> Unit
                    }
                }
                AppLockContent(screen, isPreviewBuild, actions)
                SystemPrompt(
                    request = (screen as? AppLockAsking)?.prompt,
                    title = stringResource(R.string.sec_prompt_app_lock),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        model.refresh()
    }
}

/** Turning the app lock on. It takes recovery words, so its window blocks screenshots like the recovery key screens. */
@OptIn(SecurityScreenSamples::class)
class TurnOnAppLockActivity : ComponentActivity(), WordsScreen {
    private lateinit var model: TurnOnViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val watcher = securityHost.appLock
        val suite = AndroidSuiteApps(this)
        model = flowViewModel { TurnOnViewModel(it, unlockMark = watcher::unlockMark, onTurnedOn = watcher::turnedOn, suite = suite) }
        val model = model
        // Made in onCreate, so that the keeper's answer comes straight to the model, never into a saved state.
        val keeperCall = KeeperCall(this, suite, keeper = { model.checkingAt }, onAnswer = model::onKeeperAnswer)
        val actions = TurnOnActions(
            onBack = ::finish,
            onContinue = model::onContinue,
            onRead = model::onRead,
            onAnswerChange = model::onAnswerChange,
            onCheckFour = model::onCheckFour,
            words = EnterActions(
                onBack = ::finish,
                onTyped = model::onTyped,
                onWord = model::onWord,
                onEditWord = model::onEditWord,
                onCheck = model::onCheckAll,
            ),
            onLockAgain = model::onLockAgain,
            onDone = ::finish,
            onCheckAtKeeper = { keeper ->
                model.onCheckAtKeeper(keeper)
                keeperCall.ask(HandoverMode.CHECK_WORDS)
            },
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                TurnOnContent(screen, isPreviewBuild, actions)
                val reading = screen as? TurnOnReading
                SystemPrompt(
                    request = reading?.prompt ?: (screen as? TurnOnLocking)?.prompt,
                    title = stringResource(if (reading != null) R.string.sec_prompt_check_words else R.string.sec_prompt_turn_on),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        model.onStart()
    }

    // The kept recovery key leaves memory when the screen stops, as the words
    // do on the show screen. A turn of the phone does not count.
    override fun onStop() {
        super.onStop()
        model.onStop(isChangingConfigurations)
    }
}

/**
 * A keeper's handover screen (ADR 0041): another app of the suite asks for
 * its own keys, or for four words to be checked first. Exported, and
 * protected by the handover permission. It checks the caller itself
 * before it shows anything, and again before it hands the keys over. A
 * caller that fails gets a cancelled result and no screen. It may take
 * four words, so its window blocks screenshots like the recovery key
 * screens.
 */
@OptIn(SecurityScreenSamples::class)
class HandoverActivity : ComponentActivity(), WordsScreen {
    private var model: HandoverViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val suite = AndroidSuiteApps(this)
        val request = HandoverRequest.of(callingPackage, intent.extras, suite)
        if (request !is HandoverRequest.Valid) {
            setResult(Activity.RESULT_CANCELED, refusalResult(if (request == HandoverRequest.Newer) HandoverRefusal.UPDATE else null))
            finish()
            return
        }
        val model = flowViewModel { HandoverViewModel(it, request.asker, request.mode) }.also { this.model = it }
        val asker = suite.labelOf(request.askerPackage)
        val keeper = applicationInfo.loadLabel(packageManager).toString()
        val actions = HandoverActions(
            onAllow = model::onAllow,
            onDeny = ::finish,
            onAnswerChange = model::onAnswerChange,
            onCheck = model::onCheckFour,
            onClose = {
                val refusal = if (model.state.value == HandoverNotKept) HandoverRefusal.NOT_KEEPER else null
                setResult(Activity.RESULT_CANCELED, refusalResult(refusal))
                finish()
            },
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                LaunchedEffect(screen) { if (screen == HandoverReady) handOver(model, request, suite) }
                HandoverContent(screen, asker, keeper, isPreviewBuild, actions)
                SystemPrompt(
                    request = (screen as? HandoverAsk)?.prompt,
                    title = stringResource(
                        if (request.mode == HandoverMode.KEYS) R.string.sec_prompt_handover else R.string.sec_prompt_handover_check,
                        asker,
                    ),
                    subtitle = stringResource(R.string.sec_prompt_subtitle),
                    onResult = model::onPromptResult,
                )
            }
        }
    }

    /** Checks the caller once more, then gives it the keys and closes. The keys are never kept here after that. */
    private fun handOver(model: HandoverViewModel, request: HandoverRequest.Valid, suite: SuiteApps) {
        val keys = model.takeKeys() ?: return
        val caller = callingPackage
        if (caller != request.askerPackage || suite.peerName(caller) != request.asker) {
            setResult(Activity.RESULT_CANCELED)
        } else {
            setResult(Activity.RESULT_OK, keysResult(keys))
        }
        finish()
    }

    // The kept key, and keys not handed over yet, leave memory when the screen stops. A turn of the phone does not count.
    override fun onStop() {
        super.onStop()
        model?.onStop(isChangingConfigurations)
    }
}

/**
 * The asking app's "Get the keys" screen (ADR 0041): it opens the
 * keeper's handover screen at once, stores the keys that come back, and
 * says how it went. Not exported. It shows no words, but blocks
 * screenshots like every screen of this module.
 */
@OptIn(SecurityScreenSamples::class)
class GetKeysActivity : ComponentActivity(), WordsScreen {
    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        hideOtherAppsWindows(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val keeper = intent.getStringExtra(SecurityScreens.EXTRA_KEEPER)
        val suite = AndroidSuiteApps(this)
        val watcher = securityHost.appLock
        val model = flowViewModel { GetKeysViewModel(it, onAppLockChanged = { watcher.refresh(announce = false) }) }
        // Made in onCreate, so that the answer comes straight to the model, never into a saved state.
        val call = KeeperCall(this, suite, keeper = { keeper }, onAnswer = model::onAnswer)
        // Only on the first start: after a turn of the phone the keeper's screen is open already.
        if (savedInstanceState == null) {
            if (keeper == null) model.onAnswer(KeeperAnswer.NotASuiteApp) else call.ask(HandoverMode.KEYS)
        }
        val label = keeper?.let(suite::labelOf).orEmpty()
        val actions = GetKeysActions(
            onDone = ::finish,
            onAppLock = {
                startActivity(SecurityScreens.appLockIntent(this))
                finish()
            },
        )
        setContent {
            ShkTheme {
                val screen by model.state.collectAsState()
                LaunchedEffect(screen) { if (screen == GetKeysClosed) finish() }
                GetKeysContent(screen, label, isPreviewBuild, actions)
            }
        }
    }
}
