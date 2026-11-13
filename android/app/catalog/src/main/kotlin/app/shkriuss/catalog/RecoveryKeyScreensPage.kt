package app.shkriuss.catalog

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.crypto.HardwareKeyKind
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.SecurityLevel
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSwitch
import app.shkriuss.core.security.CreateActions
import app.shkriuss.core.security.CreateConfirm
import app.shkriuss.core.security.CreateContent
import app.shkriuss.core.security.CreateIntro
import app.shkriuss.core.security.CreateWords
import app.shkriuss.core.security.EnterActions
import app.shkriuss.core.security.EnterContent
import app.shkriuss.core.security.EnterStartOverOffer
import app.shkriuss.core.security.EnterWords
import app.shkriuss.core.security.FlowDone
import app.shkriuss.core.security.FlowKeeping
import app.shkriuss.core.security.KeepNote
import app.shkriuss.core.security.Kept
import app.shkriuss.core.security.KeyRow
import app.shkriuss.core.security.RecoveryKeyState
import app.shkriuss.core.security.SecurityActions
import app.shkriuss.core.security.SecurityContent
import app.shkriuss.core.security.SecurityScreenSamples
import app.shkriuss.core.security.SecurityState
import app.shkriuss.core.security.ShowActions
import app.shkriuss.core.security.ShowContent
import app.shkriuss.core.security.ShowWords
import app.shkriuss.core.security.secureWindow

/** The states of the recovery key screens that the page shows, in this order. */
enum class SecuritySample(@param:StringRes val title: Int) {
    SecurityNoKey(R.string.sample_security_no_key),
    SecuritySetUp(R.string.sample_security_set_up),
    SecurityNoScreenLock(R.string.sample_security_no_screen_lock),
    SecurityProblems(R.string.sample_security_problems),
    CreateIntroduction(R.string.sample_create_intro),
    CreateTheWords(R.string.sample_create_words),
    CreateConfirmFour(R.string.sample_create_confirm),
    CreateKeeping(R.string.sample_create_keeping),
    CreateDone(R.string.sample_create_done),
    EnterTheWords(R.string.sample_enter_words),
    EnterStartOver(R.string.sample_enter_start_over),
    ShowTheWords(R.string.sample_show_words),
}

/**
 * The screens of the recovery key from `core/security`, each state with
 * sample data, full window. Catalog holds no keys, so nothing here makes,
 * stores or shows a real key. In an app these screens always block
 * screenshots; here a switch does, so that the owner can still send
 * screenshots of the page.
 */
@Composable
fun RecoveryKeyScreensPage(modifier: Modifier = Modifier) {
    var open by rememberSaveable { mutableStateOf<SecuritySample?>(null) }
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
            PageTitle(stringResource(R.string.page_recovery_key_title))
            PageIntro(stringResource(R.string.recovery_key_intro))
            SectionHeading(stringResource(R.string.recovery_key_block_heading))
            ShkSwitch(
                text = stringResource(R.string.recovery_key_block),
                checked = blocked,
                onCheckedChange = { blocked = it },
            )
            SectionHeading(stringResource(R.string.recovery_key_states_heading))
            ShkCard {
                SecuritySample.entries.forEach { entry ->
                    ShkListItem(headline = stringResource(entry.title), onClick = { open = entry })
                }
            }
        }
    }
}

/** Sample words, from the word list. They are no real recovery key: their checksum is not checked here. */
private val sampleWords: List<String> by lazy { List(24) { RecoveryWords.list[it * 85] } }

@OptIn(SecurityScreenSamples::class)
@Composable
private fun Sample(sample: SecuritySample, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val security = SecurityActions(onBack = onBack)
    val create = CreateActions(onBack = onBack)
    when (sample) {
        SecuritySample.SecurityNoKey -> SecurityContent(SecurityState(loaded = true), false, security, modifier)
        SecuritySample.SecuritySetUp -> SecurityContent(
            SecurityState(
                loaded = true,
                recoveryKey = RecoveryKeyState.SET_UP,
                keyId = SAMPLE_KEY_ID,
                kept = Kept.KEPT,
                keys = listOf(
                    KeyRow(HardwareKeyKind.BACKGROUND, SecurityLevel.STRONGBOX),
                    KeyRow(HardwareKeyKind.UNLOCKED, SecurityLevel.STRONGBOX),
                    KeyRow(HardwareKeyKind.RECOVERY_GUARD, SecurityLevel.STRONGBOX),
                ),
            ),
            false,
            security,
            modifier,
        )
        SecuritySample.SecurityNoScreenLock -> SecurityContent(
            SecurityState(
                loaded = true,
                recoveryKey = RecoveryKeyState.SET_UP,
                keyId = SAMPLE_KEY_ID,
                kept = Kept.NO_SCREEN_LOCK,
                hasScreenLock = false,
                keys = listOf(
                    KeyRow(HardwareKeyKind.BACKGROUND, SecurityLevel.SOFTWARE),
                    KeyRow(HardwareKeyKind.UNLOCKED, SecurityLevel.SOFTWARE),
                ),
            ),
            false,
            security,
            modifier,
        )
        SecuritySample.SecurityProblems -> SecurityContent(
            SecurityState(
                loaded = true,
                recoveryKey = RecoveryKeyState.UNFINISHED,
                needsRepair = true,
                filesCanBeGivenUp = true,
                keys = listOf(KeyRow(HardwareKeyKind.UNLOCKED, SecurityLevel.TEE)),
            ),
            true,
            security,
            modifier,
        )
        SecuritySample.CreateIntroduction -> CreateContent(CreateIntro, false, create, modifier)
        SecuritySample.CreateTheWords -> CreateContent(CreateWords(sampleWords), false, create, modifier)
        SecuritySample.CreateConfirmFour -> ConfirmSample(onBack, modifier)
        SecuritySample.CreateKeeping -> CreateContent(FlowKeeping(note = KeepNote.CANCELLED), false, create, modifier)
        SecuritySample.CreateDone -> CreateContent(FlowDone(Kept.KEPT), false, create, modifier)
        SecuritySample.EnterTheWords -> EnterSample(onBack, modifier)
        SecuritySample.EnterStartOver -> EnterContent(EnterStartOverOffer, false, EnterActions(onBack = onBack), modifier)
        SecuritySample.ShowTheWords -> ShowContent(ShowWords(sampleWords), false, ShowActions(onBack = onBack), modifier)
    }
}

/** The four words to confirm. The fields can be typed into, so the owner can try them. */
@OptIn(SecurityScreenSamples::class)
@Composable
private fun ConfirmSample(onBack: () -> Unit, modifier: Modifier) {
    var confirm by remember { mutableStateOf(CreateConfirm(listOf(3, 9, 15, 22), listOf(sampleWords[2], "ab", "", ""))) }
    CreateContent(
        screen = confirm,
        previewBuild = false,
        actions = CreateActions(
            onBack = onBack,
            onAnswerChange = { index, text ->
                confirm = confirm.copy(answers = confirm.answers.toMutableList().also { it[index] = text })
            },
        ),
        modifier = modifier,
    )
}

/** Entering the words. The field can be typed into and a suggestion picked, so the owner can try them. */
@OptIn(SecurityScreenSamples::class)
@Composable
private fun EnterSample(onBack: () -> Unit, modifier: Modifier) {
    var screen by remember {
        mutableStateOf(EnterWords(sampleWords.take(5) + List(19) { "" }, current = 5, typed = "ab"))
    }
    EnterContent(
        screen = screen,
        previewBuild = false,
        actions = EnterActions(
            onBack = onBack,
            onTyped = { screen = screen.copy(typed = it) },
            onWord = { word ->
                val words = screen.words.toMutableList().also { it[screen.current] = word }
                val next = words.indexOfFirst { it.isEmpty() }.takeIf { it >= 0 } ?: screen.current
                screen = EnterWords(words, current = next, typed = "")
            },
            onEditWord = { index -> screen = screen.copy(current = index, typed = screen.words[index]) },
        ),
        modifier = modifier,
    )
}

/** The public short name the samples show. It is no real key ID. */
private const val SAMPLE_KEY_ID = "1a2b3c4d"
