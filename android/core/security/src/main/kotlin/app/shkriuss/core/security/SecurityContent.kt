package app.shkriuss.core.security

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.HardwareKeyKind
import app.shkriuss.core.crypto.SecurityLevel
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTonalButton
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth

/** What the user can do on the security screen. Each one opens another screen or asks first. */
class SecurityActions(
    val onBack: () -> Unit = {},
    val onCreate: () -> Unit = {},
    val onEnter: () -> Unit = {},
    val onStartOverCreate: () -> Unit = {},
    val onStartOverEnter: () -> Unit = {},
    val onShow: () -> Unit = {},
    val onGiveUpFiles: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onAppLock: () -> Unit = {},
)

/**
 * The security screen: where the recovery key stands, whether this phone
 * keeps it, the screen lock, and each hardware key with where it lives
 * ("StrongBox and other hardware" in crypto-design.md).
 */
@SecurityScreenSamples
@Composable
fun SecurityContent(state: SecurityState, previewBuild: Boolean, actions: SecurityActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_security_title), actions.onBack, previewBuild, modifier) {
        when {
            !state.loaded -> ShkLoadingState(stringResource(R.string.sec_loading))
            state.failed -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_failed),
                action = ShkStateAction(stringResource(R.string.sec_try_again), actions.onRetry),
            )
            else -> {
                RecoveryKeySection(state, actions)
                if (state.needsRepair || state.filesCanBeGivenUp) RepairSection(state, actions)
                ShkSectionHeader(stringResource(R.string.sec_section_app_lock))
                Paragraph(
                    stringResource(
                        when (state.appLock) {
                            AppLockState.ON -> R.string.sec_security_lock_on
                            AppLockState.OFF -> R.string.sec_security_lock_off
                            AppLockState.RESET -> R.string.sec_security_lock_reset
                        },
                    ),
                )
                Buttons { ShkTonalButton(stringResource(R.string.sec_app_lock_button), actions.onAppLock) }
                ShkSectionHeader(stringResource(R.string.sec_section_screen_lock))
                Paragraph(stringResource(if (state.hasScreenLock) R.string.sec_screen_lock_on else R.string.sec_screen_lock_off))
                KeysSection(state)
            }
        }
    }
}

@Composable
private fun RecoveryKeySection(state: SecurityState, actions: SecurityActions) {
    ShkSectionHeader(stringResource(R.string.sec_section_recovery_key))
    when (state.recoveryKey) {
        RecoveryKeyState.NONE -> {
            Paragraph(stringResource(R.string.sec_no_key))
            Buttons {
                ShkFilledButton(stringResource(R.string.sec_create), actions.onCreate)
                ShkTonalButton(stringResource(R.string.sec_enter), actions.onEnter)
            }
        }
        RecoveryKeyState.UNFINISHED -> {
            var asking by rememberSaveable { mutableStateOf(false) }
            Paragraph(stringResource(R.string.sec_unfinished))
            Buttons {
                ShkFilledButton(stringResource(R.string.sec_finish), actions.onEnter)
                ShkTonalButton(stringResource(R.string.sec_start_over), { asking = true })
            }
            if (asking) StartOverDialog(actions, onDismiss = { asking = false })
        }
        RecoveryKeyState.SET_UP -> {
            val keyId = state.keyId
            Paragraph(if (keyId != null) stringResource(R.string.sec_set_up, keyId) else stringResource(R.string.sec_set_up_no_name))
            when (state.kept) {
                Kept.KEPT -> {
                    Paragraph(stringResource(R.string.sec_kept))
                    Buttons { ShkFilledButton(stringResource(R.string.sec_show), actions.onShow) }
                }
                Kept.NOT_KEPT -> {
                    Paragraph(stringResource(R.string.sec_not_kept))
                    Buttons { ShkTonalButton(stringResource(R.string.sec_keep_here), actions.onEnter) }
                }
                Kept.NO_SCREEN_LOCK -> Paragraph(stringResource(R.string.sec_not_kept_no_lock))
            }
        }
    }
}

@Composable
private fun RepairSection(state: SecurityState, actions: SecurityActions) {
    var asking by rememberSaveable { mutableStateOf(false) }
    ShkSectionHeader(stringResource(R.string.sec_section_repair))
    if (state.needsRepair) {
        Paragraph(stringResource(R.string.sec_repair))
        Buttons { ShkFilledButton(stringResource(R.string.sec_repair_button), actions.onEnter) }
    }
    if (state.filesCanBeGivenUp) {
        Paragraph(stringResource(R.string.sec_give_up_text))
        Buttons { ShkTonalButton(stringResource(R.string.sec_give_up_button), { asking = true }) }
    }
    if (asking) {
        ShkDialog(
            title = stringResource(R.string.sec_give_up_title),
            text = stringResource(R.string.sec_give_up_warning),
            confirmAction = ShkDialogAction(
                text = stringResource(R.string.sec_give_up_confirm),
                onClick = {
                    asking = false
                    actions.onGiveUpFiles()
                },
                destructive = true,
            ),
            dismissAction = ShkDialogAction(stringResource(R.string.sec_cancel), { asking = false }),
            onDismissRequest = { asking = false },
        )
    }
}

@Composable
private fun StartOverDialog(actions: SecurityActions, onDismiss: () -> Unit) {
    ShkDialog(
        title = stringResource(R.string.sec_start_over_title),
        text = stringResource(R.string.sec_start_over_text),
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.sec_start_over_create),
            onClick = {
                onDismiss()
                actions.onStartOverCreate()
            },
        ),
        dismissAction = ShkDialogAction(stringResource(R.string.sec_cancel), onDismiss),
        onDismissRequest = onDismiss,
        content = {
            ShkTonalButton(
                text = stringResource(R.string.sec_start_over_enter),
                onClick = {
                    onDismiss()
                    actions.onStartOverEnter()
                },
            )
        },
    )
}

@Composable
private fun KeysSection(state: SecurityState) {
    ShkSectionHeader(stringResource(R.string.sec_section_keys))
    Paragraph(stringResource(R.string.sec_keys_intro))
    if (state.keys.isEmpty()) {
        Paragraph(stringResource(R.string.sec_no_keys))
    } else {
        ShkCard {
            state.keys.forEach { key ->
                ShkListItem(headline = stringResource(nameOf(key.kind)), supportingText = stringResource(levelOf(key.level)))
            }
        }
    }
    if (state.softwareOnly) Paragraph(stringResource(R.string.sec_software_notice))
}

@StringRes
private fun nameOf(kind: HardwareKeyKind): Int = when (kind) {
    HardwareKeyKind.BACKGROUND -> R.string.sec_key_background
    HardwareKeyKind.UNLOCKED -> R.string.sec_key_unlocked
    HardwareKeyKind.LOCK -> R.string.sec_key_lock
    HardwareKeyKind.RECOVERY_GUARD -> R.string.sec_key_recovery_guard
}

@StringRes
private fun levelOf(level: SecurityLevel): Int = when (level) {
    SecurityLevel.STRONGBOX -> R.string.sec_level_strongbox
    SecurityLevel.TEE -> R.string.sec_level_tee
    SecurityLevel.SECURE_KIND_UNKNOWN -> R.string.sec_level_secure_unknown
    SecurityLevel.SOFTWARE -> R.string.sec_level_software
}

/**
 * Every screen of the module: the top bar with Back, the warning of a
 * preview build, and the content one item under the other. It scrolls.
 */
@Composable
internal fun FlowScaffold(
    title: String,
    onBack: () -> Unit,
    previewBuild: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    ShkScreen(modifier = modifier, scrollable = true, topBar = { ShkTopBar(title = title, onBack = onBack) }) {
        Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Medium)) {
            if (previewBuild) {
                ShkCard(Modifier.fillMaxWidth()) {
                    ShkText(text = stringResource(R.string.sec_preview_warning), style = ShkTextStyle.Label)
                }
            }
            content()
        }
    }
}

/** One paragraph of text. [error] draws it in the error colour. */
@Composable
internal fun Paragraph(text: String, error: Boolean = false) {
    ShkText(text = text, color = if (error) ShkTheme.colors.error else ShkTheme.colors.text)
}

/** Buttons, one under the other. */
@Composable
internal fun Buttons(content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small), content = content)
}

/**
 * The 24 words, numbered, in rows: four to a row in a wide window, two in
 * a narrow one, and one in a narrow window at a large font, so that a
 * number and its word never break apart. TalkBack reads them in order.
 * They are plain text, never selectable, so they cannot be copied.
 */
@Composable
internal fun WordsGrid(words: List<String>) {
    val columns = when {
        ShkWindowWidth.current != ShkWindowWidth.Compact -> 4
        LocalDensity.current.fontScale > LARGE_FONT -> 1
        else -> 2
    }
    ShkCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
            words.chunked(columns).forEachIndexed { row, chunk ->
                Row(horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Medium)) {
                    chunk.forEachIndexed { column, word ->
                        ShkText(
                            text = stringResource(R.string.sec_word_numbered, row * columns + column + 1, word),
                            style = ShkTextStyle.Subtitle,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/** Above this font scale, a narrow window shows one word to a row. */
private const val LARGE_FONT = 1.3f
