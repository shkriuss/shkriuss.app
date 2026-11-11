package app.shkriuss.core.design

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role

/**
 * A checkbox with its text, for an option the user turns on or off as
 * part of a form that is saved or sent later, such as "Remind me" in a
 * new task. Several checkboxes in a group can each be on. For a setting
 * that takes effect at once, use [ShkSwitch]. For one choice out of a few,
 * use [ShkRadioButton].
 *
 * The whole row is one touch target, at least 48dp tall, so a tap on the
 * text works too. Tapping it calls [onCheckedChange] with the new value;
 * the caller changes [checked]. TalkBack reads [text], "checkbox" and
 * whether it is checked. Long text wraps.
 */
@Composable
fun ShkCheckbox(
    text: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = ShkTheme.colors
    SelectionRow(
        modifier = modifier,
        action = Modifier.toggleable(
            value = checked,
            enabled = enabled,
            role = Role.Checkbox,
            onValueChange = onCheckedChange,
        ),
    ) {
        Checkbox(
            checked = checked,
            // The row takes the tap, so the checkbox has no action of its own.
            onCheckedChange = null,
            enabled = enabled,
            colors = CheckboxDefaults.colors(
                checkedColor = colors.accent,
                uncheckedColor = colors.textSecondary,
                checkmarkColor = colors.textOnAccent,
            ),
        )
        SelectionText(text, enabled, Modifier.weight(1f))
    }
}

/**
 * A switch with its text, for a setting that takes effect as soon as it is
 * turned on or off, such as "Daily reminder" on a settings screen. For an
 * option in a form that is saved later, use [ShkCheckbox].
 *
 * The text comes first and the switch sits at the end of the row. When on,
 * the switch is filled with the accent colour and its thumb shows a check
 * mark, so the state does not rely on colour or position alone.
 *
 * The whole row is one touch target, at least 48dp tall. Tapping it calls
 * [onCheckedChange] with the new value; the caller changes [checked].
 * TalkBack reads [text], "switch" and whether it is on. Long text wraps.
 */
@Composable
fun ShkSwitch(
    text: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = ShkTheme.colors
    // Shared with the switch, so its thumb grows while the row is pressed.
    val interactionSource = remember { MutableInteractionSource() }
    SelectionRow(
        modifier = modifier,
        action = Modifier.toggleable(
            value = checked,
            interactionSource = interactionSource,
            indication = ripple(),
            enabled = enabled,
            role = Role.Switch,
            onValueChange = onCheckedChange,
        ),
    ) {
        SelectionText(text, enabled, Modifier.weight(1f))
        Switch(
            checked = checked,
            // The row takes the tap, so the switch has no action of its own.
            onCheckedChange = null,
            thumbContent = if (checked) {
                { SwitchCheckMark() }
            } else {
                null
            },
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = colors.textOnAccent,
                checkedTrackColor = colors.accent,
                // Material 3 draws this in its "on primary container" colour,
                // which is the thumb's colour in this theme, so the check
                // mark would not show.
                checkedIconColor = colors.accent,
                uncheckedThumbColor = colors.outline,
                uncheckedTrackColor = colors.surfaceHigh,
                uncheckedBorderColor = colors.outline,
            ),
            interactionSource = interactionSource,
        )
    }
}

/**
 * A radio button with its text, for one choice out of a few that are all
 * shown, such as the unit "Millilitres" or "Ounces". Put every option of
 * one choice in a [ShkRadioGroup]. Exactly one is selected. For more than
 * about six options, or options that change, use a list instead.
 *
 * The whole row is one touch target, at least 48dp tall. Tapping it calls
 * [onClick]; the caller selects this option and clears the others.
 * TalkBack reads [text], "radio button", whether it is selected, and its
 * place in the group. Long text wraps.
 */
@Composable
fun ShkRadioButton(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = ShkTheme.colors
    SelectionRow(
        modifier = modifier,
        action = Modifier.selectable(
            selected = selected,
            enabled = enabled,
            role = Role.RadioButton,
            onClick = onClick,
        ),
    ) {
        RadioButton(
            selected = selected,
            // The row takes the tap, so the radio button has no action of its own.
            onClick = null,
            enabled = enabled,
            colors = RadioButtonDefaults.colors(
                selectedColor = colors.accent,
                unselectedColor = colors.textSecondary,
            ),
        )
        SelectionText(text, enabled, Modifier.weight(1f))
    }
}

/**
 * The options of one choice, one [ShkRadioButton] each, one under the
 * other. It tells TalkBack they belong together, so it reads, for example,
 * "2 of 3".
 */
@Composable
fun ShkRadioGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.selectableGroup(), content = content)
}

/**
 * The row a checkbox, switch or radio button sits in with its text. It
 * fills the width, is at least 48dp tall, and [action] makes the whole row
 * one touch target and one TalkBack item. Its pressed state is a rounded
 * [ShkShapes.Field], the shape of inputs.
 */
@Composable
private fun SelectionRow(
    modifier: Modifier,
    action: Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = ShkSpacing.MinTouchTarget)
            .clip(ShkShapes.Field)
            .then(action)
            .padding(horizontal = ShkSpacing.Small, vertical = ShkSpacing.ExtraSmall),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Medium),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * The text of a selection control, in the body style. It wraps, and
 * dims when the control is turned off, as Material 3 dims the control.
 */
@Composable
private fun SelectionText(text: String, enabled: Boolean, modifier: Modifier) {
    val color = ShkTheme.colors.text
    ShkText(
        text = text,
        modifier = modifier,
        color = if (enabled) color else color.copy(alpha = DisabledContentAlpha),
    )
}

/**
 * The check mark on the thumb of a switch that is on. The thumb has a
 * fixed size, so this icon keeps Material 3's size at every font size.
 */
@Composable
private fun SwitchCheckMark() {
    Icon(
        painter = painterResource(R.drawable.shk_icon_check),
        contentDescription = null,
        modifier = Modifier.size(SwitchDefaults.IconSize),
    )
}
