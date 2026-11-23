package app.shkriuss.feature.tasks.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.notify.Notify
import app.shkriuss.feature.tasks.NotificationLine
import app.shkriuss.feature.tasks.NotificationsViewModel
import app.shkriuss.feature.tasks.R

/**
 * The line at the top of Today while an open task has a reminder to come
 * and notifications cannot show (docs/apps/tasks/spec.md, "Today", point
 * 2, which takes the line of Reminders' Upcoming), with its button:
 * **Allow**, which starts the question, or **Open settings**, which opens
 * Android's page. TalkBack reads the line, then the button, before the
 * sections.
 */
@Composable
internal fun NotificationLineRow(line: NotificationLine, model: NotificationsViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall)) {
        ShkText(text = stringResource(wordsOf(line)), color = ShkTheme.colors.textSecondary)
        when (line) {
            NotificationLine.NOT_ASKED -> ShkTextButton(text = stringResource(R.string.tasks_allow), onClick = model::allow)
            NotificationLine.DENIED, NotificationLine.CHANNEL_OFF -> ShkTextButton(
                text = stringResource(R.string.tasks_open_settings),
                onClick = { context.startActivity(model.settingsIntent()) },
            )
        }
    }
}

/** The words of [line]. */
private fun wordsOf(line: NotificationLine): Int = when (line) {
    NotificationLine.NOT_ASKED -> R.string.tasks_line_not_asked
    NotificationLine.DENIED -> R.string.tasks_line_denied
    NotificationLine.CHANNEL_OFF -> R.string.tasks_line_channel_off
}

/**
 * The question for notifications (spec, "As in Water and Reminders",
 * asking for notifications): a dialog that explains, with **Continue**
 * and **Not now**. **Continue** starts Android's own question for
 * `Notify.PERMISSION`, and the answer, yes or no, is passed on. It is
 * drawn once, over every destination, from inside the app lock's gate:
 * a save of the form on Today or in a list can start it.
 */
@Composable
internal fun NotificationQuestion(model: NotificationsViewModel) {
    val screen by model.state.collectAsState()
    val androidAsks = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { model.answered() }
    if (!screen.asking) return
    ShkDialog(
        title = stringResource(R.string.tasks_question_title),
        text = stringResource(R.string.tasks_question_text),
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.tasks_continue),
            onClick = {
                model.continueAsking()
                androidAsks.launch(Notify.PERMISSION)
            },
        ),
        dismissAction = ShkDialogAction(text = stringResource(R.string.tasks_not_now), onClick = model::notNow),
        onDismissRequest = model::notNow,
    )
}
