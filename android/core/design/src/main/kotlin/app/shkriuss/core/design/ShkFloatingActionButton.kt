package app.shkriuss.core.design

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.FloatingActionButtonElevation
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * The floating button for the one action a screen is for, such as adding
 * a note to a list of notes. It sits above the content in the bottom end
 * corner. Use at most one on a screen, and only for a positive action:
 * add, write, start. Never for delete.
 *
 * [contentDescription] is required: TalkBack reads it, because there is
 * no text. Say what the button does, for example "New note". If the icon
 * alone is not clear, use [ShkExtendedFloatingActionButton].
 *
 * It has no disabled state. When the action is not possible, leave the
 * button out. It is 56dp square, with [ShkShapes.Card] corners, and has
 * no shadow (ADR 0017, point 5).
 */
@Composable
fun ShkFloatingActionButton(
    icon: Painter,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = ShkTheme.colors
    FloatingActionButton(
        onClick = onClick,
        modifier = modifier,
        shape = ShkShapes.Card,
        containerColor = colors.accent,
        contentColor = colors.textOnAccent,
        elevation = noElevation(),
    ) {
        // No text sits next to this icon, so it keeps its size.
        Icon(painter = icon, contentDescription = contentDescription, modifier = Modifier.size(FabIconSize))
    }
}

/**
 * A floating action button with an icon and text, for when the icon alone
 * is not clear. The same rules as [ShkFloatingActionButton] apply.
 *
 * TalkBack reads [text]. The icon is decorative. With [expanded] false it
 * shrinks to the icon alone, for example while a list scrolls, and
 * TalkBack still reads [text]. It is at least 56dp tall. Long text wraps,
 * and the icon grows with the font size.
 */
@Composable
fun ShkExtendedFloatingActionButton(
    text: String,
    icon: Painter,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    expanded: Boolean = true,
) {
    val colors = ShkTheme.colors
    ExtendedFloatingActionButton(
        text = {
            // The space above and below changes nothing at one line, where
            // the button is taller than the text. It keeps wrapped text
            // clear of the edges.
            Text(
                text = text,
                style = ShkTextStyle.Label.textStyle,
                modifier = Modifier.padding(vertical = ShkSpacing.Small),
            )
        },
        icon = {
            // The icon grows with the font size, so it keeps its
            // proportion to the text. It keeps that size while collapsed,
            // so it does not jump when the button shrinks.
            Icon(
                painter = icon,
                contentDescription = null,
                modifier = Modifier.size(iconSizeNextToText(FabIconSize)),
            )
        },
        onClick = onClick,
        // Material 3 1.4 hides the text from TalkBack, in both states, so
        // the button would be read as "Button" alone. This gives it its
        // label back, once.
        modifier = modifier.semantics { contentDescription = text },
        expanded = expanded,
        shape = ShkShapes.Card,
        containerColor = colors.accent,
        contentColor = colors.textOnAccent,
        elevation = noElevation(),
    )
}

/** The size Material 3 draws the icon of a floating action button. */
private val FabIconSize = 24.dp

/** No shadow in any state (ADR 0017, point 5). */
@Composable
private fun noElevation(): FloatingActionButtonElevation =
    FloatingActionButtonDefaults.elevation(
        defaultElevation = 0.dp,
        pressedElevation = 0.dp,
        focusedElevation = 0.dp,
        hoveredElevation = 0.dp,
    )
