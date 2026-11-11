package app.shkriuss.core.design

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * What a screen or a list shows when it has nothing in it yet, such as
 * "No notes yet" before the first note, or "No results" after a search.
 * Use it instead of an empty space, so people know the screen works and
 * what to do next. While content is still on its way, use
 * [ShkLoadingState]. When it could not be shown, use [ShkErrorState].
 *
 * [title] says what is missing. [body] is an optional line on what to do
 * about it. [icon] is optional and decorative. Pass [actionText] and
 * [onAction] together for a button that does it, such as "New note". Leave
 * the button out when the screen already has a floating action button for
 * the same action.
 *
 * It fills the width it is given and centres its content. Give it the
 * whole height of the screen or list, for example with `weight(1f)`, to
 * centre it there too. TalkBack reads the title and the body as one item,
 * then the button. All text wraps, and the icon grows with the font size.
 */
@Composable
fun ShkEmptyState(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    icon: Painter? = null,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
) {
    StateMessage(
        title = title,
        body = body,
        icon = icon,
        iconColor = ShkTheme.colors.textSecondary,
        actionText = actionText,
        onAction = onAction,
        modifier = modifier,
    )
}

/**
 * What a screen or a list shows while its content is on its way, such as
 * while a backup is read. Use it when loading takes long enough to notice.
 * For a short wait, show nothing; a flash of this is worse.
 *
 * [text] says what is loading, such as "Loading notes". It is required,
 * so TalkBack never says only "in progress": it reads the text and "in
 * progress" as one item.
 *
 * A circle in the accent colour turns above the text. It keeps Material
 * 3's size, 40dp, at every font size; the text grows and wraps. It fills
 * the width it is given and centres its content, as [ShkEmptyState] does.
 */
@Composable
fun ShkLoadingState(text: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = ShkSpacing.ExtraLarge)
            .semantics(mergeDescendants = true) { progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Material 3 makes the circle a TalkBack item of its own, read as
        // "in progress" apart from the text. The column above says it
        // instead, with the text, as one item.
        Box(Modifier.clearAndSetSemantics {}) {
            CircularProgressIndicator(color = ShkTheme.colors.accent, trackColor = Color.Transparent)
        }
        Spacer(Modifier.height(ShkSpacing.Large))
        CentredText(text = text, style = ShkTextStyle.Body, color = ShkTheme.colors.textSecondary)
    }
}

/**
 * What a screen or a list shows when its content could not be shown, such
 * as "Could not open the backup". Use it in place of the content. For a
 * problem with one value the user typed, use the error of a
 * [ShkTextField] instead.
 *
 * [title] says what went wrong, in plain words. [body] is an optional line
 * on why, or what to do. Pass [actionText] and [onAction] together for a
 * button that tries again or fixes it, such as "Try again".
 *
 * It shows the suite's error icon in the error colour, so the state does
 * not rely on the words alone. The icon is decorative. Otherwise it is
 * laid out, read by TalkBack and grows as [ShkEmptyState] does.
 */
@Composable
fun ShkErrorState(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
) {
    StateMessage(
        title = title,
        body = body,
        icon = painterResource(R.drawable.shk_icon_error),
        iconColor = ShkTheme.colors.error,
        actionText = actionText,
        onAction = onAction,
        modifier = modifier,
    )
}

/**
 * The layout of the empty and the error state: the icon, the title and
 * the body, centred one under the other, and the button under them.
 * TalkBack reads the title and the body as one item.
 */
@Composable
private fun StateMessage(
    title: String,
    body: String?,
    icon: Painter?,
    iconColor: Color,
    actionText: String?,
    onAction: (() -> Unit)?,
    modifier: Modifier,
) {
    require((actionText == null) == (onAction == null)) { "Pass actionText and onAction together, or neither" }
    val colors = ShkTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = ShkSpacing.ExtraLarge),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon != null) {
            Icon(
                painter = icon,
                contentDescription = null,
                modifier = Modifier.size(iconSizeNextToText(StateIconSize)),
                tint = iconColor,
            )
            Spacer(Modifier.height(ShkSpacing.Large))
        }
        Column(
            modifier = Modifier.semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CentredText(text = title, style = ShkTextStyle.Title, color = colors.text)
            if (body != null) {
                CentredText(text = body, style = ShkTextStyle.Body, color = colors.textSecondary)
            }
        }
        if (actionText != null && onAction != null) {
            Spacer(Modifier.height(ShkSpacing.Large))
            ShkTonalButton(text = actionText, onClick = onAction)
        }
    }
}

/**
 * Text centred line by line, for the states above. [ShkText] keeps text
 * at the start, as every other screen does.
 */
@Composable
private fun CentredText(text: String, style: ShkTextStyle, color: Color) {
    Text(
        text = text,
        color = color,
        style = style.textStyle,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The size of the icon above the title of an empty or an error state, at
 * the default font size. It is larger than an icon in a control, because
 * it stands for the whole screen. It grows with the font size, as an icon
 * next to text does.
 */
private val StateIconSize = 48.dp
