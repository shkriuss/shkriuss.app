package app.shkriuss.feature.water.ui

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
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.ReminderLine
import app.shkriuss.feature.water.RemindersViewModel

/**
 * The reminder line of Today and of Settings (docs/apps/water/spec.md,
 * "Today", the table of the reminder line), with its button: **Allow**,
 * which starts the question, or **Open settings**, which opens Android's
 * page. Nothing while reminders are off. TalkBack reads the line, then
 * the button.
 */
@Composable
internal fun ReminderLineRow(model: RemindersViewModel, format: WaterFormat, modifier: Modifier = Modifier) {
    val screen by model.state.collectAsState()
    val line = screen.line ?: return
    val context = LocalContext.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall)) {
        ShkText(text = wordsOf(line, format), color = ShkTheme.colors.textSecondary)
        when (line) {
            ReminderLine.NotAsked -> ShkTextButton(text = stringResource(R.string.water_allow), onClick = model::allow)
            ReminderLine.Denied, ReminderLine.ChannelOff -> ShkTextButton(
                text = stringResource(R.string.water_open_settings),
                onClick = { context.startActivity(model.settingsIntent()) },
            )
            is ReminderLine.NextAt, ReminderLine.GoalReached, ReminderLine.NoneLeftToday -> Unit
        }
    }
}

/** The words of [line]. */
@Composable
private fun wordsOf(line: ReminderLine, format: WaterFormat): String = when (line) {
    is ReminderLine.NextAt -> stringResource(R.string.water_reminder_next, format.time(line.minuteOfDay))
    ReminderLine.GoalReached -> stringResource(R.string.water_reminder_goal_reached)
    ReminderLine.NoneLeftToday -> stringResource(R.string.water_reminder_none_left)
    ReminderLine.NotAsked -> stringResource(R.string.water_reminder_not_asked)
    ReminderLine.Denied -> stringResource(R.string.water_reminder_denied)
    ReminderLine.ChannelOff -> stringResource(R.string.water_reminder_channel_off)
}

/**
 * The question for notifications (spec, "Asking for notifications"): a
 * dialog that explains, with **Continue** and **Not now**. **Continue**
 * starts Android's own question for `Notify.PERMISSION`, and the answer,
 * yes or no, is passed on. Each screen that can start the question draws
 * this, from inside the app lock's gate.
 */
@Composable
internal fun NotificationQuestion(model: RemindersViewModel) {
    val screen by model.state.collectAsState()
    val androidAsks = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { model.answered() }
    if (!screen.asking) return
    ShkDialog(
        title = stringResource(R.string.water_question_title),
        text = stringResource(R.string.water_question_text),
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.water_continue),
            onClick = {
                model.continueAsking()
                androidAsks.launch(Notify.PERMISSION)
            },
        ),
        dismissAction = ShkDialogAction(text = stringResource(R.string.water_not_now), onClick = model::notNow),
        onDismissRequest = model::notNow,
    )
}
