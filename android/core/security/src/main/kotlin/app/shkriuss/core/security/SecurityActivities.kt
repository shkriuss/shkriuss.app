package app.shkriuss.core.security

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.design.ShkTheme

/**
 * The ViewModel of this screen, made once with the app's [ShkCrypto] and
 * kept while the phone is turned. It ends when the screen finishes, and
 * the recovery key it holds goes with it.
 */
private inline fun <reified T : ViewModel> ComponentActivity.flowViewModel(crossinline make: (ShkCrypto) -> T): T {
    val crypto = securityHost.crypto
    val factory = object : ViewModelProvider.Factory {
        override fun <V : ViewModel> create(modelClass: Class<V>): V = modelClass.cast(make(crypto))!!
    }
    return ViewModelProvider(this, factory)[T::class.java]
}

/** The security screen. Its window blocks screenshots like every screen of this module. */
@OptIn(SecurityScreenSamples::class)
class SecurityActivity : ComponentActivity() {
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
class CreateRecoveryKeyActivity : ComponentActivity() {
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
class EnterRecoveryKeyActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        secureWindow(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val startOver = intent.getBooleanExtra(SecurityScreens.EXTRA_START_OVER, false)
        val model = flowViewModel { EnterViewModel(it, startOver) }
        val actions = EnterActions(
            onBack = ::finish,
            onTyped = model::onTyped,
            onWord = model::onWord,
            onEditWord = model::onEditWord,
            onCheck = model::onCheck,
            onStartOverWithThese = model::onStartOverWithThese,
            onEnterOther = model::onEnterOther,
            step = FlowStepActions(onKeep = model::onKeepAgain, onSkipKeeping = model::onSkipKeeping, onDone = ::finish),
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
class ShowRecoveryKeyActivity : ComponentActivity() {
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
