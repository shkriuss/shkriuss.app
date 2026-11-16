package app.shkriuss.feature.water.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkSwitch
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTimePicker
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.security.RecoveryKeyFirstNeedState
import app.shkriuss.feature.water.AmountInput
import app.shkriuss.feature.water.BackupViewModel
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.RemindersViewModel
import app.shkriuss.feature.water.SettingsRules
import app.shkriuss.feature.water.SettingsScreen
import app.shkriuss.feature.water.SettingsViewModel
import app.shkriuss.feature.water.WaterUnit
import java.time.LocalTime

/**
 * Settings (docs/apps/water/spec.md, "Settings screen"): one column of
 * items under section headers, each with its value under its name. A tap
 * opens a dialog, and a change takes effect at once.
 *
 * It shows Drinking; Reminders, with the switch "Remind me to drink", the
 * hours and, while reminders are on, the same reminder line as Today under
 * the hours (the owner's decision); Backup and Security
 * ([BackupAndSecuritySections]), whose rows start [firstNeed]; and About,
 * with the version and Licences, which [onLicences] opens.
 */
@Composable
internal fun SettingsContent(
    model: SettingsViewModel,
    reminders: RemindersViewModel,
    backup: BackupViewModel,
    firstNeed: RecoveryKeyFirstNeedState,
    versionName: String,
    onLicences: () -> Unit,
) {
    val screen by model.state.collectAsState()
    val keys by backup.state.collectAsState()
    val format = rememberWaterFormat()
    var dialog by rememberSaveable { mutableStateOf<SettingsDialog?>(null) }
    val close = { dialog = null }
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.water_settings)) }, scrollable = true) {
        if (!screen.loaded) return@ShkScreen
        val settings = screen.settings
        val unit = settings.unit

        ShkSectionHeader(stringResource(R.string.water_section_drinking))
        SettingItem(
            name = stringResource(R.string.water_daily_goal),
            value = format.amount(screen.goalMl, unit),
            spokenValue = format.amountSpoken(screen.goalMl, unit),
            onClick = { dialog = SettingsDialog.GOAL },
        )
        SettingItem(
            name = stringResource(R.string.water_unit),
            value = format.unitName(unit),
            onClick = { dialog = SettingsDialog.UNIT },
        )
        val amounts = settings.quickAmountsMl
        SettingItem(
            name = stringResource(R.string.water_quick_amounts),
            value = stringResource(R.string.water_three_amounts, *amounts.map { format.amount(it, unit) }.toTypedArray()),
            spokenValue = stringResource(R.string.water_three_amounts, *amounts.map { format.amountSpoken(it, unit) }.toTypedArray()),
            onClick = { dialog = SettingsDialog.QUICK_AMOUNTS },
        )

        ShkSectionHeader(stringResource(R.string.water_section_reminders))
        ShkSwitch(
            text = stringResource(R.string.water_remind_me),
            checked = settings.remindersOn,
            onCheckedChange = { on ->
                model.setRemindersOn(on)
                // Turning it on may start the question for notifications (spec, "Asking for notifications").
                if (on) reminders.remindersTurnedOn()
            },
        )
        SettingItem(
            name = stringResource(R.string.water_every),
            value = format.interval(settings.intervalMinutes),
            onClick = { dialog = SettingsDialog.EVERY },
        )
        SettingItem(
            name = stringResource(R.string.water_from),
            value = format.time(settings.fromMinute),
            onClick = { dialog = SettingsDialog.FROM },
        )
        SettingItem(
            name = stringResource(R.string.water_until),
            value = format.time(settings.untilMinute),
            onClick = { dialog = SettingsDialog.UNTIL },
        )
        if (screen.noReminderFits) {
            Spacer(Modifier.height(ShkSpacing.Small))
            ShkText(text = stringResource(R.string.water_no_reminder_fits), color = ShkTheme.colors.textSecondary)
        }
        ReminderLineRow(reminders, format, Modifier.padding(top = ShkSpacing.Small))

        BackupAndSecuritySections(keys, firstNeed)

        ShkSectionHeader(stringResource(R.string.water_section_about))
        ShkListItem(headline = stringResource(R.string.water_version), supportingText = versionName)
        ShkListItem(headline = stringResource(R.string.water_licences), onClick = onLicences)
    }

    when (dialog) {
        SettingsDialog.GOAL -> GoalDialog(screen, model, format, close)
        SettingsDialog.UNIT -> UnitDialog(screen.settings.unit, model, format, close)
        SettingsDialog.QUICK_AMOUNTS -> QuickAmountsDialog(screen, model, format, close)
        SettingsDialog.EVERY -> EveryDialog(screen.settings.intervalMinutes, model, format, close)
        SettingsDialog.FROM -> HoursPicker(screen, isFrom = true, model, close)
        SettingsDialog.UNTIL -> HoursPicker(screen, isFrom = false, model, close)
        null -> Unit
    }
    NotificationQuestion(reminders)
}

/** The dialogs of Settings. At most one is open; which one is kept while the phone is turned. */
private enum class SettingsDialog { GOAL, UNIT, QUICK_AMOUNTS, EVERY, FROM, UNTIL }

/**
 * One setting: its [name], and its [value] under it. TalkBack reads both,
 * with [spokenValue] in place of the value where the value has a short
 * unit, such as "2,000 millilitres" for "2,000 ml".
 */
@Composable
internal fun SettingItem(name: String, value: String, onClick: () -> Unit, spokenValue: String = value) {
    val spoken = stringResource(R.string.water_setting_spoken, name, spokenValue)
    ShkListItem(
        headline = name,
        supportingText = value,
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}

/**
 * The daily goal. Save checks the goal first: outside 500 to 10,000 ml
 * (17 to 338 fl oz) the field says so in the unit in use, the dialog stays
 * open, and the old goal stays. The new goal counts from today.
 */
@Composable
private fun GoalDialog(screen: SettingsScreen, model: SettingsViewModel, format: WaterFormat, onClose: () -> Unit) {
    val unit = screen.settings.unit
    // The goal the dialog opened with. A field that still shows it was not changed, whatever today's goal is by now.
    val openedMl = rememberSaveable { screen.goalMl }
    var text by rememberSaveable { mutableStateOf(AmountInput.textOf(openedMl, unit)) }
    var refused by rememberSaveable { mutableStateOf(false) }
    val limits = unit.goalLimits
    val name = stringResource(R.string.water_daily_goal)
    ShkDialog(
        title = name,
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.water_save),
            onClick = { if (model.setGoal(text, openedMl)) onClose() else refused = true },
            closesDialog = false,
        ),
        dismissAction = ShkDialogAction(text = stringResource(R.string.water_cancel), onClick = {}),
        onDismissRequest = onClose,
    ) {
        AmountField(
            value = text,
            onValueChange = {
                text = it
                refused = false
            },
            label = name,
            unit = unit,
            format = format,
            errorText = if (refused) {
                stringResource(R.string.water_goal_error, format.number(limits.first), format.inUnit(limits.last, unit))
            } else {
                null
            },
        )
        Spacer(Modifier.height(ShkSpacing.Small))
        ShkText(text = stringResource(R.string.water_goal_note), color = ShkTheme.colors.textSecondary)
    }
}

/** The unit: millilitres or US fluid ounces. The choice takes effect on Save. */
@Composable
private fun UnitDialog(current: WaterUnit, model: SettingsViewModel, format: WaterFormat, onClose: () -> Unit) {
    var choice by rememberSaveable { mutableStateOf(current) }
    ShkDialog(
        title = stringResource(R.string.water_unit),
        confirmAction = ShkDialogAction(text = stringResource(R.string.water_save), onClick = { model.setUnit(choice) }),
        dismissAction = ShkDialogAction(text = stringResource(R.string.water_cancel), onClick = {}),
        onDismissRequest = onClose,
    ) {
        ShkRadioGroup {
            WaterUnit.entries.forEach { unit ->
                ShkRadioButton(text = format.unitName(unit), selected = choice == unit, onClick = { choice = unit })
            }
        }
    }
}

/**
 * The three quick amounts. Save checks all three first: each one outside
 * 1 to 3,000 ml (1 to 101 fl oz) says so under it, the dialog stays open,
 * and the old amounts stay.
 */
@Composable
private fun QuickAmountsDialog(screen: SettingsScreen, model: SettingsViewModel, format: WaterFormat, onClose: () -> Unit) {
    val unit = screen.settings.unit
    // The amounts the dialog opened with. A field that still shows its amount was not changed.
    val amounts = rememberSaveable { screen.settings.quickAmountsMl.toIntArray() }
    var first by rememberSaveable { mutableStateOf(AmountInput.textOf(amounts[0], unit)) }
    var second by rememberSaveable { mutableStateOf(AmountInput.textOf(amounts[1], unit)) }
    var third by rememberSaveable { mutableStateOf(AmountInput.textOf(amounts[2], unit)) }
    var wrong by rememberSaveable { mutableIntStateOf(0) }
    val limits = unit.drinkLimits
    val error = stringResource(R.string.water_amount_error, format.number(limits.first), format.inUnit(limits.last, unit))
    ShkDialog(
        title = stringResource(R.string.water_quick_amounts),
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.water_save),
            onClick = {
                val refused = model.setQuickAmounts(listOf(first, second, third), amounts.toList())
                if (refused.isEmpty()) onClose() else wrong = refused.fold(0) { bits, place -> bits or (1 shl place) }
            },
            closesDialog = false,
        ),
        dismissAction = ShkDialogAction(text = stringResource(R.string.water_cancel), onClick = {}),
        onDismissRequest = onClose,
    ) {
        val labels = listOf(R.string.water_first, R.string.water_second, R.string.water_third)
        val values = listOf(first, second, third)
        val setters = listOf<(String) -> Unit>({ first = it }, { second = it }, { third = it })
        labels.forEachIndexed { place, label ->
            if (place > 0) Spacer(Modifier.height(ShkSpacing.Small))
            AmountField(
                value = values[place],
                onValueChange = {
                    setters[place](it)
                    wrong = wrong and (1 shl place).inv()
                },
                label = stringResource(label),
                unit = unit,
                format = format,
                errorText = if (wrong and (1 shl place) != 0) error else null,
                last = place == labels.lastIndex,
            )
        }
        Spacer(Modifier.height(ShkSpacing.Small))
        ShkText(text = stringResource(R.string.water_quick_amounts_note), color = ShkTheme.colors.textSecondary)
    }
}

/** "Every": six intervals, from 30 minutes to 3 hours. The choice takes effect on Save. */
@Composable
private fun EveryDialog(current: Int, model: SettingsViewModel, format: WaterFormat, onClose: () -> Unit) {
    var choice by rememberSaveable { mutableIntStateOf(current) }
    ShkDialog(
        title = stringResource(R.string.water_every),
        confirmAction = ShkDialogAction(text = stringResource(R.string.water_save), onClick = { model.setInterval(choice) }),
        dismissAction = ShkDialogAction(text = stringResource(R.string.water_cancel), onClick = {}),
        onDismissRequest = onClose,
    ) {
        ShkRadioGroup {
            SettingsRules.INTERVALS.forEach { minutes ->
                ShkRadioButton(text = format.interval(minutes), selected = choice == minutes, onClick = { choice = minutes })
            }
        }
    }
}

/**
 * "From" or "Until". A time that would leave less than 30 minutes between
 * them is refused in the picker, which says why and stays open; the old
 * time stays.
 */
@Composable
private fun HoursPicker(screen: SettingsScreen, isFrom: Boolean, model: SettingsViewModel, onClose: () -> Unit) {
    val settings = screen.settings
    val minute = if (isFrom) settings.fromMinute else settings.untilMinute
    val tooEarly = stringResource(R.string.water_until_too_early)
    ShkTimePicker(
        title = stringResource(if (isFrom) R.string.water_from else R.string.water_until),
        initialTime = LocalTime.of(minute / MINUTES_PER_HOUR, minute % MINUTES_PER_HOUR),
        onTimeChosen = { time ->
            val chosen = time.hour * MINUTES_PER_HOUR + time.minute
            if (isFrom) model.setFrom(chosen) else model.setUntil(chosen)
        },
        onDismissRequest = onClose,
        refuse = { time ->
            val chosen = time.hour * MINUTES_PER_HOUR + time.minute
            val allowed = if (isFrom) {
                SettingsRules.hoursAllowed(chosen, settings.untilMinute)
            } else {
                SettingsRules.hoursAllowed(settings.fromMinute, chosen)
            }
            if (allowed) null else tooEarly
        },
    )
}

/** A field for an amount in [unit], whole numbers, with the unit after it. */
@Composable
private fun AmountField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    unit: WaterUnit,
    format: WaterFormat,
    errorText: String?,
    last: Boolean = true,
) {
    ShkTextField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        errorText = errorText,
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Number,
            imeAction = if (last) ImeAction.Done else ImeAction.Next,
        ),
        suffix = format.unitShort(unit),
        suffixDescription = format.unitSpoken(unit),
    )
}

private const val MINUTES_PER_HOUR = 60
