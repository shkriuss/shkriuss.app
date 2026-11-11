package app.shkriuss.core.design

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * One row in a list, such as a task, a setting or a file. Use it for
 * lists of things that look alike. To set one item apart, use a
 * [ShkCard]. For a setting that turns on and off, use [ShkSwitch].
 *
 * [headline] is the main line, in the subtitle style. [supportingText] is
 * an optional line of detail under it, [trailingText] an optional short
 * note at the end, such as a time or a count. [icon] is optional, sits at
 * the start, is decorative, and grows with the font size. All text wraps,
 * so nothing is cut off at large font sizes.
 *
 * With [onClick], the whole row is one touch target, at least 48dp tall
 * and as wide as the space it is given, and TalkBack reads all its text,
 * then "button". Without it, TalkBack still reads the row as one item.
 * With [enabled] false, the row dims, ignores taps, and TalkBack reads
 * "disabled".
 *
 * Its content starts and ends at the edges of the space it is given, so
 * its text lines up with the page title and the other text on the screen.
 * Only its touch target and its pressed state, a rounded [ShkShapes.Field],
 * reach 8dp past those edges, as those of a checkbox or switch row do.
 */
@Composable
fun ShkListItem(
    headline: String,
    modifier: Modifier = Modifier,
    supportingText: String? = null,
    trailingText: String? = null,
    icon: Painter? = null,
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true,
) {
    val colors = ShkTheme.colors
    val alpha = if (enabled) 1f else DisabledContentAlpha
    val action = if (onClick != null) {
        Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
    } else {
        // One TalkBack item, as a row that can be tapped is.
        Modifier.semantics(mergeDescendants = true) { if (!enabled) disabled() }
    }
    Row(
        modifier = modifier.shkRow(action = action, verticalPadding = ShkSpacing.Small),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Medium),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(
                painter = icon,
                contentDescription = null,
                modifier = Modifier.size(iconSizeNextToText(ListItemIconSize)),
                tint = colors.textSecondary.copy(alpha = alpha),
            )
        }
        Column(Modifier.weight(1f)) {
            ShkText(text = headline, style = ShkTextStyle.Subtitle, color = colors.text.copy(alpha = alpha))
            if (supportingText != null) {
                ShkText(text = supportingText, color = colors.textSecondary.copy(alpha = alpha))
            }
        }
        if (trailingText != null) {
            ShkText(text = trailingText, style = ShkTextStyle.Caption, color = colors.textSecondary.copy(alpha = alpha))
        }
    }
}

/**
 * A thin line that separates groups of content, such as the items of a
 * list or the parts of a card. Use it only where space alone does not
 * show where one thing ends; most lists need none.
 *
 * It is 1dp in the divider colour, lighter than the outline of a control,
 * and fills the width it is given. It is decorative, so TalkBack skips it.
 */
@Composable
fun ShkDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier = modifier, thickness = DividerThickness, color = ShkTheme.colors.divider)
}

/**
 * The heading of a group of content on a screen, such as "Today" above a
 * list of tasks or "Reminders" above a group of settings. TalkBack reads
 * it as a heading, so its users can jump from group to group.
 *
 * It is in the subtitle style and the accent colour, so it does not look
 * like the first line of the list item under it. It brings the space that
 * separates sections, [ShkSpacing.ExtraLarge], above it, and
 * [ShkSpacing.Small] below it. Its text starts at the edge of the space it
 * is given, as the text of the [ShkListItem] rows under it does. Long text
 * wraps.
 */
@Composable
fun ShkSectionHeader(text: String, modifier: Modifier = Modifier) {
    ShkText(
        text = text,
        style = ShkTextStyle.Subtitle,
        color = ShkTheme.colors.accent,
        modifier = modifier
            .fillMaxWidth()
            .padding(top = ShkSpacing.ExtraLarge, bottom = ShkSpacing.Small)
            .semantics { heading() },
    )
}

/** The size Material 3 draws the icon at the start of a list item. */
private val ListItemIconSize = 24.dp

/** The thickness of a divider, the same as the outline of a raised surface. */
private val DividerThickness = 1.dp
