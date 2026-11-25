package app.shkriuss.core.design

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset

/**
 * One row in a list, such as a task, a setting or a file. Use it for
 * lists of things that look alike. To set one item apart, use a
 * [ShkCard]. For a setting that turns on and off, use [ShkSwitch].
 *
 * [headline] is the main line, in the subtitle style. [supportingText] is
 * an optional line of detail under it, [trailingText] an optional short
 * note at the end, such as a time or a count. [icon] is optional, sits at
 * the start, is decorative, and grows with the font size. [trailingIcon]
 * is optional too and the same, but sits at the very end, after
 * [trailingText], such as a check next to "Goal reached". Neither is a
 * label: say in the text what the icon shows. All text wraps, so nothing
 * is cut off at large font sizes.
 *
 * With [onClick], the whole row is one touch target, at least 48dp tall
 * and as wide as the space it is given, and TalkBack reads all its text,
 * then "button". Without it, TalkBack still reads the row as one item.
 * With [enabled] false, the row dims, ignores taps, and TalkBack reads
 * "disabled".
 *
 * With [selected], the row is marked as the one that is open, such as the
 * note shown beside the list in two panes of a [ShkListDetailScaffold].
 * It is filled with the higher surface colour and has a bar in the accent
 * colour along its start edge, so the mark does not rely on colour alone.
 * TalkBack reads "selected". Rows that are not selected say nothing about
 * it, so a list where nothing can be open sounds as before.
 *
 * With [onCheckedChange], the row has a tick box at its start, such as
 * the box of a task, ticked while [checked] is true. The box is a touch
 * target of its own, at least 48dp, beside the row's tap: a tap on the
 * box calls [onCheckedChange] with the new value, and a tap on the rest of
 * the row calls [onClick]. The caller changes [checked]. TalkBack still
 * reads the whole row as one item: its text, then [checkedDescription],
 * by default "Ticked" or "Not ticked". It offers the tick as an action
 * named [checkActionLabel], by default "Tick" or "Clear the tick", beside
 * the row's own tap. Give both in the app's words, such as "not done" and
 * "Mark as done". The box grows with the font size, as the box of a
 * [ShkCheckbox] does, and dims with the row. Without [onCheckedChange],
 * the row has no box and is as it always was.
 *
 * [image] is optional: a small picture at the start, in place of [icon],
 * such as an image the row's file holds. It is drawn as it is, not
 * tinted, cut to a 40dp square with round corners, and grows with the font
 * size as an icon does. It is decorative too: TalkBack reads nothing for
 * it, so say in the text what the row is.
 *
 * Its content starts and ends at the edges of the space it is given, so
 * its text lines up with the page title and the other text on the screen.
 * Only its touch target, its pressed state and its selected mark, a
 * rounded [ShkShapes.Field], reach 8dp past those edges, as those of a
 * checkbox or switch row do. The bar sits in that space, before the text.
 * The touch target of a tick box reaches into that space too, and the box
 * is drawn at the edge, where the box of a [ShkCheckbox] is.
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
    selected: Boolean = false,
    trailingIcon: Painter? = null,
    checked: Boolean = false,
    onCheckedChange: ((Boolean) -> Unit)? = null,
    checkedDescription: String? = null,
    checkActionLabel: String? = null,
    image: Painter? = null,
) {
    val colors = ShkTheme.colors
    val alpha = if (enabled) 1f else DisabledContentAlpha
    val action = if (onClick != null) {
        Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
    } else {
        // One TalkBack item, as a row that can be tapped is.
        Modifier.semantics(mergeDescendants = true) { if (!enabled) disabled() }
    }
    val tick = if (onCheckedChange != null) {
        val state = checkedDescription ?: stringResource(if (checked) R.string.shk_ticked else R.string.shk_not_ticked)
        val label = checkActionLabel ?: stringResource(if (checked) R.string.shk_clear_tick else R.string.shk_tick)
        Modifier.tickSemantics(checked, onCheckedChange, enabled, state, label)
    } else {
        Modifier
    }
    val mark = if (selected) {
        Modifier
            .selectedMark(fill = colors.surfaceHigh.copy(alpha = alpha), bar = colors.accent.copy(alpha = alpha))
            .semantics { this.selected = true }
    } else {
        Modifier
    }
    Row(
        // The mark comes before the action, so the pressed state is drawn over it.
        modifier = modifier.shkRow(action = mark.then(action).then(tick), verticalPadding = ShkSpacing.Small),
        horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Medium),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onCheckedChange != null) TickBox(checked, onCheckedChange, enabled)
        if (image != null) {
            Image(
                painter = image,
                contentDescription = null,
                modifier = Modifier
                    .size(shkListItemImageSide())
                    .clip(ShkShapes.Field),
                contentScale = ContentScale.Crop,
                alpha = alpha,
            )
        } else if (icon != null) {
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
        if (trailingIcon != null) {
            Icon(
                painter = trailingIcon,
                contentDescription = null,
                modifier = Modifier.size(iconSizeNextToText(ListItemIconSize)),
                tint = colors.textSecondary.copy(alpha = alpha),
            )
        }
    }
}

/**
 * What TalkBack hears of a row's tick box, on the row itself: the [state]
 * after the row's text, and the tick as an action named [label]. The box
 * has no TalkBack item of its own ([TickBox]), so the row stays one item.
 * A row that is turned off offers no action.
 */
private fun Modifier.tickSemantics(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean,
    state: String,
    label: String,
): Modifier = semantics {
    stateDescription = state
    if (enabled) {
        customActions = listOf(
            CustomAccessibilityAction(label) {
                onCheckedChange(!checked)
                true
            },
        )
    }
}

/**
 * The tick box at the start of a [ShkListItem]: Material 3's checkbox in
 * a touch target of its own, at least 48dp wide and tall. The target
 * starts where the row's own reaches to, [RowReach] before the row's
 * content, and ends where the text starts: it takes the gap after it
 * too. The box is drawn at the content's edge, as the box of a
 * [ShkCheckbox] is. TalkBack skips it: the row says its state and offers
 * the tick ([tickSemantics]).
 */
@Composable
private fun TickBox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, enabled: Boolean) {
    val colors = ShkTheme.colors
    Box(
        modifier = Modifier
            .reachPast(start = RowReach, end = ShkSpacing.Medium)
            .sizeIn(minWidth = ShkSpacing.MinTouchTarget, minHeight = ShkSpacing.MinTouchTarget)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange)
            .semantics { hideFromAccessibility() }
            .padding(start = RowReach),
        contentAlignment = Alignment.CenterStart,
    ) {
        Checkbox(
            checked = checked,
            // The box around it takes the tap, so the checkbox has no action of its own.
            onCheckedChange = null,
            modifier = Modifier.grownBy(iconSizeNextToText(SelectionControlSize) / SelectionControlSize),
            enabled = enabled,
            colors = CheckboxDefaults.colors(
                checkedColor = colors.accent,
                uncheckedColor = colors.textSecondary,
                checkmarkColor = colors.textOnAccent,
            ),
        )
    }
}

/**
 * Lays out what follows [start] plus [end] wider than the space this
 * element takes: it reaches [start] back before that space, and [end] on
 * past it, into the gap the row leaves after it. The parent sees that much
 * less than what follows measured; touches and drawing reach past it. In
 * right-to-left languages it is mirrored.
 */
private fun Modifier.reachPast(start: Dp, end: Dp): Modifier = layout { measurable, constraints ->
    val before = start.roundToPx()
    val after = end.roundToPx()
    val placeable = measurable.measure(constraints.offset(horizontal = before + after))
    layout((placeable.width - before - after).coerceAtLeast(0), placeable.height) {
        placeable.placeRelative(x = -before, y = 0)
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

/** Draws the mark of a selected list item behind its content. See [drawSelectedMark]. */
private fun Modifier.selectedMark(fill: Color, bar: Color): Modifier = drawBehind { drawSelectedMark(fill, bar) }

/**
 * The mark of a selected list item or card, over the whole highlight,
 * which for a list item reaches [RowReach] past the row's edges: a [fill]
 * of the area, and a [bar] along its start edge. The bar is
 * [SelectedBarWidth] wide, inside the reach, so the text does not move. It
 * keeps clear of the rounded corners by [inset], their radius, at the top
 * and the bottom. It is on the right in right-to-left languages.
 */
internal fun DrawScope.drawSelectedMark(fill: Color, bar: Color, inset: Dp = ShkShapes.FieldCorner) {
    drawRect(fill)
    val width = SelectedBarWidth.toPx()
    val clear = inset.toPx()
    val x = if (layoutDirection == LayoutDirection.Ltr) 0f else size.width - width
    drawRoundRect(
        color = bar,
        topLeft = Offset(x, clear),
        size = Size(width, (size.height - 2 * clear).coerceAtLeast(0f)),
        cornerRadius = CornerRadius(width / 2),
    )
}

/** The width of the bar of a selected list item. Half the reach, so 4dp are left before the text. */
private val SelectedBarWidth = ShkSpacing.ExtraSmall

/** The size of the image at the start of a list item, as Material 3's image of a list item. */
private val ListItemImageSize = 40.dp

/**
 * The side of the square in which [ShkListItem] shows its `image`: 40 dp,
 * grown with the font size as an icon next to text is. A caller that
 * decodes the image, such as a photo, decodes it at this size, so it is
 * neither stretched nor larger than it shows.
 */
@Composable
fun shkListItemImageSide(): Dp = iconSizeNextToText(ListItemImageSize)

/** The size Material 3 draws the icon at the start of a list item. */
private val ListItemIconSize = 24.dp

/** The thickness of a divider, the same as the outline of a raised surface. */
private val DividerThickness = 1.dp
