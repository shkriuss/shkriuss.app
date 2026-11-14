package app.shkriuss.core.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * A bar that shows how far something has got, such as how much of a
 * daily goal is drunk. It cannot be moved: to pick a value, use a
 * [ShkSlider].
 *
 * [value] is from 0 to 1. The bar fills from the start edge, so from the
 * right in a right-to-left language. Below 0 it is empty, and at 1 and
 * above it is full, so a total past its goal shows a full bar.
 *
 * It shows no text. [label] names what it measures and [valueText] says
 * how far it is in words, such as "62 percent". TalkBack reads both, and
 * never a bare number, so the caller formats [valueText] from a string
 * resource. When the screen already says the same in a line that
 * TalkBack reads, as in a summary read as one item, clear its semantics
 * there, so it is not read twice.
 *
 * It fills the width it is given and is 8dp tall, with round ends. The
 * part not yet reached is the outline colour, at least 3:1 on the
 * background, and the part reached is the accent, as on a [ShkSlider].
 * Material 3's own bar is not used: it leaves a gap between the two parts
 * and draws a dot at the end.
 */
@Composable
fun ShkProgressBar(
    value: Float,
    label: String,
    valueText: String,
    modifier: Modifier = Modifier,
) {
    val colors = ShkTheme.colors
    val shown = shownValue(value)
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(ProgressBarHeight)
            .semantics {
                contentDescription = label
                stateDescription = valueText
                progressBarRangeInfo = ProgressBarRangeInfo(shown, 0f..1f)
            },
    ) {
        drawProgressBar(shown, track = colors.outline, reached = colors.accent)
    }
}

/**
 * Draws a progress bar at [value], from 0 to 1, over the whole size: the
 * [track] with round ends, and over it the part [reached] from the start
 * edge of the layout direction, inside the same round ends.
 */
internal fun DrawScope.drawProgressBar(value: Float, track: Color, reached: Color) {
    val ends = CornerRadius(size.height / 2)
    val shape = Path().apply { addRoundRect(RoundRect(Rect(Offset.Zero, size), ends)) }
    clipPath(shape) {
        drawRect(color = track)
        val width = size.width * value
        val start = if (layoutDirection == LayoutDirection.Rtl) size.width - width else 0f
        drawRect(color = reached, topLeft = Offset(start, 0f), size = Size(width, size.height))
    }
}

/** The share of the bar that is filled: [value] kept from 0 to 1. Not a number counts as 0. */
internal fun shownValue(value: Float): Float = if (value.isNaN()) 0f else value.coerceIn(0f, 1f)

/** How tall a [ShkProgressBar] is drawn. */
internal val ProgressBarHeight: Dp = 8.dp
