package app.shkriuss.core.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CardElevation
import androidx.compose.material3.OutlinedCard
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A card: a raised surface that holds one item of content, such as a note
 * in a list of notes. Use it to set one thing apart from the things around
 * it. For a plain row in a list, use [ShkListItem] instead.
 *
 * It is the surface colour with a 1dp outline and [ShkShapes.Card]
 * corners, and has no shadow (ADR 0017, point 5). It fills the width it is
 * given, and its content sits [ShkSpacing.Large] in from its edges, one
 * item under the other. Text in it uses the normal text colour unless it
 * picks another.
 *
 * This card cannot be tapped, so it may hold buttons. TalkBack reads what
 * is in it one item at a time. For a card that opens something when
 * tapped, use the other [ShkCard], with `onClick`.
 */
@Composable
fun ShkCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    OutlinedCard(
        modifier = modifier.fillMaxWidth(),
        shape = ShkShapes.Card,
        colors = cardColors(),
        elevation = noCardElevation(),
        border = cardBorder(),
    ) {
        CardContent(content)
    }
}

/**
 * A card that opens something when tapped, such as a note that opens in
 * the editor. It looks like the other [ShkCard] and shows that it is
 * pressed.
 *
 * The whole card is one touch target, at least 48dp tall, and one
 * TalkBack item: TalkBack reads all the text in it, then "button". So put
 * at least one line of text in it, and never a button or another control:
 * it would sit inside the card's own touch target. For a card with
 * buttons, use the card without `onClick` and put the buttons in it.
 *
 * It has no disabled state. When the card cannot be opened, use the card
 * without `onClick`.
 */
@Composable
fun ShkCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    OutlinedCard(
        onClick = onClick,
        // Material 3 gives a card that can be tapped no role, so TalkBack
        // would not say what a tap does.
        modifier = modifier
            .fillMaxWidth()
            .semantics { role = Role.Button },
        shape = ShkShapes.Card,
        colors = cardColors(),
        elevation = noCardElevation(),
        border = cardBorder(),
    ) {
        CardContent(content)
    }
}

/** The content of a card, [ShkSpacing.Large] in from its edges. */
@Composable
private fun CardContent(content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(ShkSpacing.Large), content = content)
}

/** The surface colour, with the normal text colour on it. */
@Composable
private fun cardColors(): CardColors {
    val colors = ShkTheme.colors
    return CardDefaults.outlinedCardColors(containerColor = colors.surface, contentColor = colors.text)
}

/** The outline of every raised surface: 1dp in the outline colour. */
@Composable
private fun cardBorder(): BorderStroke = BorderStroke(CardOutlineWidth, ShkTheme.colors.outline)

/** No shadow in any state, also not while dragged (ADR 0017, point 5). */
@Composable
private fun noCardElevation(): CardElevation =
    CardDefaults.outlinedCardElevation(
        defaultElevation = 0.dp,
        pressedElevation = 0.dp,
        focusedElevation = 0.dp,
        hoveredElevation = 0.dp,
        draggedElevation = 0.dp,
        disabledElevation = 0.dp,
    )

/** The width of the outline of a raised surface (ADR 0017, point 5). */
private val CardOutlineWidth = 1.dp
