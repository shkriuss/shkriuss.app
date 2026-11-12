package app.shkriuss.core.design

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.style.TextAlign

/**
 * The button for the main action of a screen, such as "Save". It is filled
 * with the accent colour, so it stands out most. Use at most one on a
 * screen. Use [ShkTonalButton] or [ShkTextButton] for the other actions.
 *
 * TalkBack reads [text]. [icon] is optional, sits before the text and is
 * decorative. It grows with the font size. Long text wraps, so nothing is
 * cut off at large font sizes. The button is drawn 40dp tall, and its
 * touch target is at least 48dp.
 */
@Composable
fun ShkFilledButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Painter? = null,
) {
    val colors = ShkTheme.colors
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = ButtonShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.accent,
            contentColor = colors.textOnAccent,
        ),
        // No shadow in any state, also not when a mouse hovers (ADR 0017, point 5).
        elevation = null,
        contentPadding = if (icon == null) ButtonDefaults.ContentPadding else ButtonDefaults.ButtonWithIconContentPadding,
    ) {
        ButtonContent(text, icon)
    }
}

/**
 * A button for an action that matters, but less than the main one, such
 * as "Share" next to "Save". It is filled with the higher surface colour,
 * so it is quieter than [ShkFilledButton]. On a sheet or a dialog, which
 * is already the higher surface, use [ShkTextButton] instead.
 *
 * TalkBack reads [text]. [icon] is optional, sits before the text and is
 * decorative, and grows with the font size. Long text wraps. The touch
 * target is at least 48dp.
 */
@Composable
fun ShkTonalButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Painter? = null,
) {
    val colors = ShkTheme.colors
    FilledTonalButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = ButtonShape,
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = colors.surfaceHigh,
            contentColor = colors.text,
        ),
        elevation = null,
        contentPadding = if (icon == null) ButtonDefaults.ContentPadding else ButtonDefaults.ButtonWithIconContentPadding,
    ) {
        ButtonContent(text, icon)
    }
}

/**
 * The quietest button: accent text with no fill. Use it for actions in
 * dialogs and sheets ("Cancel", "Delete"), for actions inside a card or a
 * list, and next to a [ShkFilledButton] for the action people take less
 * often.
 *
 * TalkBack reads [text]. [icon] is optional, sits before the text and is
 * decorative, and grows with the font size. Long text wraps. The touch
 * target is at least 48dp.
 */
@Composable
fun ShkTextButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Painter? = null,
) {
    ColoredTextButton(
        text = text,
        onClick = onClick,
        color = ShkTheme.colors.accent,
        modifier = modifier,
        enabled = enabled,
        icon = icon,
    )
}

/**
 * A [ShkTextButton] whose text is [color] instead of the accent: the error
 * colour for a destructive action in a dialog, or the other theme's accent
 * on a snackbar. [color] must be a text colour on what the button sits on.
 */
@Composable
internal fun ColoredTextButton(
    text: String,
    onClick: () -> Unit,
    color: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: Painter? = null,
) {
    TextButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = ButtonShape,
        colors = ButtonDefaults.textButtonColors(contentColor = color),
        elevation = null,
        contentPadding = if (icon == null) {
            ButtonDefaults.TextButtonContentPadding
        } else {
            ButtonDefaults.TextButtonWithIconContentPadding
        },
    ) {
        ButtonContent(text, icon)
    }
}

/**
 * A button that shows only an icon, for a common action whose icon is
 * clear on its own, such as search in a top bar. If the icon is not clear
 * on its own, use a button with text instead.
 *
 * [contentDescription] is required: TalkBack reads it, because there is
 * no text. Say what the button does, for example "Search". The icon uses
 * the current content colour. The button is drawn 40dp wide and tall, and
 * its touch target is at least 48dp.
 */
@Composable
fun ShkIconButton(
    icon: Painter,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    IconButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = ShkShapes.Pill,
    ) {
        Icon(painter = icon, contentDescription = contentDescription)
    }
}

/**
 * The shape of every button with text. A button one line tall is a pill,
 * as ADR 0017 sets. When large text wraps onto more lines, the corners
 * keep that radius instead of growing with the height. A fully rounded end
 * on a tall button would cut off the corners of the text.
 */
internal val ButtonShape = RoundedCornerShape(ButtonDefaults.MinHeight / 2)

/**
 * The optional icon and the text of a button, in the label style. The
 * icon grows with the font size, so it keeps its proportion to the text.
 */
@Composable
private fun ButtonContent(text: String, icon: Painter?) {
    if (icon != null) {
        Icon(
            painter = icon,
            contentDescription = null,
            modifier = Modifier.size(iconSizeNextToText(ButtonDefaults.IconSize)),
        )
        Spacer(Modifier.width(ShkSpacing.Small))
    }
    Text(text = text, style = ShkTextStyle.Label.textStyle, textAlign = TextAlign.Center)
}
