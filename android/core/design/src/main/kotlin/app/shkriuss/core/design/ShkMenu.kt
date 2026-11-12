package app.shkriuss.core.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A menu: a short list of actions that opens from a button, such as
 * Rename, Share and Delete behind "More options". Use it for actions that
 * are needed now and then, so they do not crowd the screen. For actions
 * that need a second line of text, or more than about six, use a
 * [ShkBottomSheet]. A [ShkTopBar] makes its own menu from `menuItems`.
 *
 * Put the menu in a `Box` with the button that opens it. It opens over
 * the button, inside the window, while [expanded] is true. Each of
 * [items] is a row with its text, and an optional icon before it. A tap
 * on one calls [onDismissRequest], then its action. A tap outside the
 * menu and Back call only [onDismissRequest]. Set [expanded] to false
 * there.
 *
 * Each row is one touch target, at least 48dp tall, and TalkBack reads it
 * by its text, then "button". Icons are decorative and grow with the font
 * size. The menu is as wide as its widest row, from 112 to 280dp, and
 * text wraps beyond that, so nothing is cut off. A menu taller than the
 * window scrolls.
 *
 * It is the higher surface colour with a 1dp outline and [ShkShapes.Card]
 * corners, and has no shadow (ADR 0017, point 5).
 */
@Composable
fun ShkMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    items: List<ShkMenuItem>,
    modifier: Modifier = Modifier,
) {
    val colors = ShkTheme.colors
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        shape = ShkShapes.Card,
        containerColor = colors.surfaceHigh,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        border = BorderStroke(PanelOutlineWidth, colors.outline),
    ) {
        items.forEach { item ->
            MenuRow(
                item = item,
                onClick = {
                    onDismissRequest()
                    item.onClick()
                },
            )
        }
    }
}

/**
 * Draws an open [ShkMenu] in place, without its window, for the
 * Catalog's samples (see [ShkInPlace]). A tap on a row only calls its
 * action.
 */
@ShkInPlace
@Composable
fun ShkMenuInPlace(items: List<ShkMenuItem>, modifier: Modifier = Modifier) {
    val colors = ShkTheme.colors
    // The same surface and column that Material 3's menu draws.
    Surface(
        modifier = modifier,
        shape = ShkShapes.Card,
        color = colors.surfaceHigh,
        contentColor = colors.text,
        border = BorderStroke(PanelOutlineWidth, colors.outline),
    ) {
        Column(Modifier.padding(vertical = MenuVerticalPadding).width(IntrinsicSize.Max)) {
            items.forEach { item -> MenuRow(item = item, onClick = item.onClick) }
        }
    }
}

/**
 * One action in a [ShkMenu]: its words, what a tap does, and an optional
 * icon. They come as one value, so a row is never shown without its
 * words.
 */
class ShkMenuItem(
    /** The words of the row, such as "Rename". TalkBack reads them. */
    val text: String,
    /** What a tap does. The menu closes first. */
    val onClick: () -> Unit,
    /** An optional icon before the text, a vector drawable on the 24dp grid. It is decorative. */
    val icon: Painter? = null,
    /** False while the action is not possible. The row dims, and TalkBack reads "disabled". */
    val enabled: Boolean = true,
    /** True for an action that destroys something, such as "Delete". Its text and icon are the error colour. */
    val destructive: Boolean = false,
)

/** One row of a menu, in Material 3's menu item, in the label style. */
@Composable
private fun MenuRow(item: ShkMenuItem, onClick: () -> Unit) {
    val colors = ShkTheme.colors
    val icon = item.icon
    DropdownMenuItem(
        text = { Text(text = item.text, style = ShkTextStyle.Label.textStyle) },
        onClick = onClick,
        // Material 3 gives a menu row no role, so TalkBack would not say
        // what a tap does.
        modifier = Modifier.semantics { role = Role.Button },
        leadingIcon = icon?.let {
            {
                Icon(
                    painter = it,
                    contentDescription = null,
                    modifier = Modifier.size(iconSizeNextToText(MenuIconSize)),
                )
            }
        },
        enabled = item.enabled,
        colors = MenuDefaults.itemColors(
            textColor = if (item.destructive) colors.error else colors.text,
            leadingIconColor = if (item.destructive) colors.error else colors.textSecondary,
        ),
    )
}

/** The size Material 3 draws the icon of a menu row. It grows with the font size. */
private val MenuIconSize = 24.dp

/** The space above the first row and below the last, as in Material 3. */
private val MenuVerticalPadding = ShkSpacing.Small
