package app.shkriuss.core.design

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource

/**
 * A chip that turns a filter on or off, such as "Done" above a list of
 * tasks. Put several in a row. Tapping one calls [onClick]; the caller
 * changes [selected].
 *
 * A selected chip is filled with the accent colour and shows a check
 * mark, so the state does not rely on colour alone. TalkBack reads [text]
 * and whether the chip is selected. Long text wraps. The chip is drawn
 * 32dp tall, and its touch target is at least 48dp.
 */
@Composable
fun ShkFilterChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = ShkTheme.colors
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { ChipLabel(text) },
        modifier = modifier,
        enabled = enabled,
        leadingIcon = if (selected) {
            { ChipIcon(painterResource(R.drawable.shk_icon_check)) }
        } else {
            null
        },
        shape = ChipShape,
        colors = FilterChipDefaults.filterChipColors(
            labelColor = colors.text,
            selectedContainerColor = colors.accent,
            selectedLabelColor = colors.textOnAccent,
            selectedLeadingIconColor = colors.textOnAccent,
        ),
        // No shadow in any state, also not while dragged (ADR 0017, point 5).
        elevation = null,
        border = FilterChipDefaults.filterChipBorder(
            enabled = enabled,
            selected = selected,
            borderColor = colors.outline,
        ),
    )
}

/**
 * A chip that starts an action related to the content near it, such as
 * "Add a reminder" under a task. Use it for optional, smaller actions;
 * use a button for the main ones.
 *
 * TalkBack reads [text]. [icon] is optional, drawn in the accent colour
 * before the text, and decorative. Long text wraps. The chip is drawn 32dp
 * tall, and its touch target is at least 48dp.
 */
@Composable
fun ShkAssistChip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Painter? = null,
) {
    val colors = ShkTheme.colors
    AssistChip(
        onClick = onClick,
        label = { ChipLabel(text) },
        modifier = modifier,
        enabled = enabled,
        leadingIcon = icon?.let { { ChipIcon(it) } },
        shape = ChipShape,
        colors = AssistChipDefaults.assistChipColors(
            labelColor = colors.text,
            leadingIconContentColor = colors.accent,
        ),
        elevation = null,
        border = AssistChipDefaults.assistChipBorder(enabled = enabled, borderColor = colors.outline),
    )
}

/**
 * The shape of every chip. A chip one line tall is a pill, as ADR 0017
 * sets. When large text wraps onto more lines, the corners keep that
 * radius, so they never cut off the text.
 */
internal val ChipShape = RoundedCornerShape(FilterChipDefaults.Height / 2)

/**
 * The text of a chip, in the label style. The small space above and below
 * changes nothing at font scale 1.0, where the chip is taller than the
 * text. When large text makes the chip taller, it keeps the text clear of
 * the edges and the round ends.
 */
@Composable
private fun ChipLabel(text: String) {
    Text(
        text = text,
        style = ShkTextStyle.Label.textStyle,
        modifier = Modifier.padding(vertical = ShkSpacing.ExtraSmall),
    )
}

/** A decorative icon at the start of a chip. */
@Composable
private fun ChipIcon(icon: Painter) {
    Icon(painter = icon, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize))
}
