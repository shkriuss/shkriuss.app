package app.shkriuss.feature.water.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import app.shkriuss.core.design.ShkBottomSheet
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTimePicker
import app.shkriuss.feature.water.DayScreen
import app.shkriuss.feature.water.DayViewModel
import app.shkriuss.feature.water.DrinkSheet
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.WaterUnit
import java.time.LocalTime

/**
 * The sheet "Add a drink" or "Edit drink" of a day
 * (docs/apps/water/spec.md, "Add a drink and edit a drink"). It is a
 * bottom sheet on every width. What is typed lives in the [DayViewModel],
 * so it stays when the phone is turned.
 */
@Composable
internal fun DrinkSheetHost(screen: DayScreen, model: DayViewModel, format: WaterFormat) {
    val open = screen.sheet
    // The sheet slides down after it closes. Until then it shows what it showed.
    var shown by remember { mutableStateOf(open) }
    if (open != null) shown = open
    val sheet = shown
    ShkBottomSheet(
        visible = open != null,
        onDismissRequest = model::cancel,
        title = sheet?.let { stringResource(if (it.isEdit) R.string.water_edit_drink else R.string.water_add_drink) },
    ) {
        if (sheet != null) SheetFields(sheet, screen.unit, model, format)
    }
}

/** The amount, the time, and the buttons of the sheet. */
@Composable
private fun SheetFields(sheet: DrinkSheet, unit: WaterUnit, model: DayViewModel, format: WaterFormat) {
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val limits = unit.drinkLimits
    ShkTextField(
        value = sheet.amountText,
        onValueChange = model::onAmountChange,
        label = stringResource(R.string.water_amount),
        errorText = if (sheet.amountError) {
            stringResource(R.string.water_amount_error, format.number(limits.first), format.inUnit(limits.last, unit))
        } else {
            null
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        suffix = format.unitShort(unit),
        suffixDescription = format.unitSpoken(unit),
    )
    Spacer(Modifier.height(ShkSpacing.Small))
    val time = stringResource(R.string.water_time)
    ShkListItem(
        headline = time,
        supportingText = format.time(sheet.minuteOfDay),
        onClick = { pickingTime = true },
    )
    if (sheet.timeError) {
        // A live region, so TalkBack announces it when it appears.
        ShkText(
            text = stringResource(R.string.water_time_not_yet),
            color = ShkTheme.colors.error,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    Spacer(Modifier.height(ShkSpacing.Large))
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small, alignment = Alignment.End),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
    ) {
        if (sheet.isEdit) ShkTextButton(text = stringResource(R.string.water_delete), onClick = model::delete)
        ShkTextButton(text = stringResource(R.string.water_cancel), onClick = model::cancel)
        ShkFilledButton(text = stringResource(R.string.water_save), onClick = model::save)
    }
    Spacer(Modifier.height(ShkSpacing.Large))
    if (pickingTime) {
        ShkTimePicker(
            title = time,
            initialTime = LocalTime.of(sheet.minuteOfDay / MINUTES_PER_HOUR, sheet.minuteOfDay % MINUTES_PER_HOUR),
            onTimeChosen = { model.onTimeChange(it.hour * MINUTES_PER_HOUR + it.minute) },
            onDismissRequest = { pickingTime = false },
        )
    }
}

private const val MINUTES_PER_HOUR = 60
