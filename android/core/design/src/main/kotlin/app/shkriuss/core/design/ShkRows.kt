package app.shkriuss.core.design

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.offset

/**
 * The layout of every row that is one touch target: a list item, and a
 * checkbox, switch or radio button with its text. It exists so they all
 * follow one rule (owner decision on pull request 15):
 *
 * - The row's content starts and ends at the edges of the space it is
 *   given, where the page title and all other text start, so the text of
 *   rows lines up with everything else.
 * - Only its touch target and its pressed state, a rounded
 *   [ShkShapes.Field], reach [RowReach] past those edges on both sides, so
 *   the highlight does not touch the text.
 *
 * The row fills the width and is at least [ShkSpacing.MinTouchTarget]
 * tall. [action] makes it one touch target and one TalkBack item.
 * [verticalPadding] is the space above and below its content.
 */
internal fun Modifier.shkRow(action: Modifier, verticalPadding: Dp): Modifier =
    fillMaxWidth()
        .heightIn(min = ShkSpacing.MinTouchTarget)
        .reachPastEdges(RowReach)
        .clip(ShkShapes.Field)
        .then(action)
        .padding(horizontal = RowReach, vertical = verticalPadding)

/**
 * How far the touch target and the pressed state of a row reach past the
 * edges of its content, on each side. The screen margins and the padding
 * of a card are wider, so the highlight stays inside them.
 */
internal val RowReach: Dp = ShkSpacing.Small

/**
 * Lays out what follows [amount] wider on each side than the space this
 * element takes, centred on it. The parent sees the size it gave; touches
 * and drawing reach past it. Padding of [amount] inside brings the content
 * back to the parent's edges.
 */
private fun Modifier.reachPastEdges(amount: Dp): Modifier = layout { measurable, constraints ->
    val reach = amount.roundToPx()
    val placeable = measurable.measure(constraints.offset(horizontal = 2 * reach))
    val width = (placeable.width - 2 * reach).coerceAtLeast(0)
    layout(width, placeable.height) {
        placeable.placeRelative(x = -reach, y = 0)
    }
}
