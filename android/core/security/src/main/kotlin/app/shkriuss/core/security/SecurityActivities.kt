package app.shkriuss.core.security

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
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model = flowViewModel { SecurityViewModel(it) }
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
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val startOver = intent.getBooleanExtra(SecurityScreens.EXTRA_START_OVER, false)
        val model = flowViewModel { CreateViewModel(it, startOver) }
        val actions = CreateActions(
            onBack = ::finish,
            onShowWords = model::onShowWords,
            onWordsWritten = model::onWordsWritten,
            onAnswerChange = model::onAnswerChange,
            onCheck = model::onCheck,
            step = FlowStepActions(onKeep = model::onKeepAgain, onSkipKeeping = model::onSkipKeeping, onDone = ::finish),
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
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val startOver = intent.getBooleanExtra(SecurityScreens.EXTRA_START_OVER, false)
        val watcher = securityHost.appLock
        val model = flowViewModel { EnterViewModel(it, startOver, onAppLockChanged = { watcher.refresh(announce = false) }) }
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
 * shows anything. Closing that prompt closes the screen. The window
 * follows the app's settings, as every screen of the app does.
 */
@OptIn(SecurityScreenSamples::class)
class AppLockActivity : ComponentActivity() {
    private lateinit var model: AppLockViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
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
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val watcher = securityHost.appLock
        model = flowViewModel { TurnOnViewModel(it, onTurnedOn = watcher::turnedOn) }
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
