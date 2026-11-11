package app.shkriuss.core.design

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset

/**
 * The bar at the top of a screen: the screen's title, a Back button when
 * the screen was opened from another one, and up to three actions for the
 * whole screen, such as search. Give every screen one, through the
 * `topBar` of [ShkScreen], which keeps it clear of the status bar and
 * keeps it in place while the content scrolls.
 *
 * [title] is in the headline style, and TalkBack reads it as a heading.
 * Long titles wrap, so nothing is cut off at large font sizes; the bar
 * grows taller. Pass [onBack] for the Back button, which TalkBack reads as
 * "Back". Each of [actions] is an icon button that TalkBack reads by its
 * label. Use at most three; an action that needs words belongs in the
 * content as a button. Every button's touch target is 48dp.
 *
 * The bar is at least 64dp tall and has no fill of its own: it is part of
 * the screen. The title starts at the screen margin, where the content
 * under it starts, and the icons of the Back button and the last action
 * sit on the margins. Only their touch targets reach past them, as those
 * of rows do.
 */
@Composable
fun ShkTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    actions: List<ShkTopBarAction> = emptyList(),
) {
    CompositionLocalProvider(LocalContentColor provides ShkTheme.colors.text) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .heightIn(min = TopBarMinHeight)
                .screenMarginLessIconReach(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                ShkIconButton(
                    icon = painterResource(R.drawable.shk_icon_back),
                    contentDescription = stringResource(R.string.shk_back),
                    onClick = onBack,
                )
            }
            // Without a button beside it, the title moves in to the
            // margin. Beside a button it starts where the button's touch
            // target ends, 12dp from its icon.
            ShkText(
                text = title,
                style = ShkTextStyle.Headline,
                modifier = Modifier
                    .weight(1f)
                    .padding(
                        start = if (onBack == null) IconReach else 0.dp,
                        end = if (actions.isEmpty()) IconReach else 0.dp,
                    )
                    .padding(vertical = ShkSpacing.Medium)
                    .semantics { heading() },
            )
            actions.forEach { action ->
                ShkIconButton(
                    icon = action.icon,
                    contentDescription = action.label,
                    onClick = action.onClick,
                    enabled = action.enabled,
                )
            }
        }
    }
}

/**
 * Pads both sides by the screen margin for the width given, as
 * [ShkScreen] does, less [IconReach], so the icons of the buttons sit on
 * the margins. It reads the width from the constraints rather than with
 * `BoxWithConstraints`, so the bar still answers intrinsic measurements,
 * as in a row of equal heights.
 */
private fun Modifier.screenMarginLessIconReach(): Modifier = layout { measurable, constraints ->
    val margin = if (constraints.hasBoundedWidth) {
        ShkSpacing.screenMargin(constraints.maxWidth.toDp())
    } else {
        ShkSpacing.ScreenMargin
    }
    val padding = (margin - IconReach).roundToPx()
    val placeable = measurable.measure(constraints.offset(horizontal = -2 * padding))
    val width = constraints.constrainWidth(placeable.width + 2 * padding)
    layout(width, placeable.height) { placeable.placeRelative(padding, 0) }
}

/**
 * An action at the end of a [ShkTopBar]: its icon, the words TalkBack
 * reads for it, and what a tap does. They come as one value, so an action
 * can never be shown without its label (as with [ShkStateAction]).
 */
class ShkTopBarAction(
    /** The icon, a vector drawable on the 24dp grid. It keeps its size at every font size. */
    val icon: Painter,
    /** What TalkBack reads, saying what the action does, such as "Search". */
    val label: String,
    /** What a tap does. */
    val onClick: () -> Unit,
    /** False while the action is not possible. The icon dims, and TalkBack reads "disabled". */
    val enabled: Boolean = true,
)

/** The smallest height of a top bar, as in Material 3. */
private val TopBarMinHeight = 64.dp

/**
 * How far the touch target of an icon button reaches past its 24dp icon,
 * on each side. The bar's icons sit on the screen margins, and only their
 * touch targets reach past them.
 */
private val IconReach = (ShkSpacing.MinTouchTarget - 24.dp) / 2
