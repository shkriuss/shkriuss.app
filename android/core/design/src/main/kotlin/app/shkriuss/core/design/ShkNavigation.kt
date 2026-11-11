package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * The navigation between the top-level places of an app, such as Today,
 * History and Settings in a water app. It switches by the width of the
 * window (CLAUDE.md, "UI and accessibility"):
 *
 * - [ShkWindowWidth.Compact], a phone held upright: a bar along the bottom,
 *   under [content], with the destinations side by side.
 * - [ShkWindowWidth.Medium] and [ShkWindowWidth.Expanded], a tablet or a
 *   phone held sideways: a rail along the start edge, beside [content],
 *   with the destinations one under the other.
 *
 * Use it for three to five [destinations] that people switch between
 * often. An app with one place needs none. For going deeper, from a list
 * to one item, use [ShkListDetailScaffold] and the Back button of
 * [ShkTopBar] instead.
 *
 * [selectedIndex] is the destination shown. A tap on a destination calls
 * [onSelect] with its index; the caller shows that destination's screen in
 * [content] and changes [selectedIndex]. The selected destination's icon
 * sits on a pill in the accent colour, so the choice does not rely on
 * colour alone. Each destination is one touch target, at least 48dp, that
 * TalkBack reads as its label, "tab", and whether it is selected. Labels
 * wrap at large font sizes. The rail grows wider with the font size, so a
 * label keeps the room it has at the default size.
 *
 * It fills the space it is given, which is normally the whole window, and
 * keeps the bar or the rail clear of the system bars. [windowWidth] is the
 * window's class; leave it out. The Catalog passes it to show the bar and
 * the rail side by side.
 */
@Composable
fun ShkNavigationScaffold(
    destinations: List<ShkDestination>,
    selectedIndex: Int,
    onSelect: (index: Int) -> Unit,
    modifier: Modifier = Modifier,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
    content: @Composable () -> Unit,
) {
    val rail = windowWidth != ShkWindowWidth.Compact
    // The bar or the rail keeps clear of the system bars on its side, so
    // the content does not do it again.
    val handled = NavigationInsets.only(if (rail) WindowInsetsSides.Start else WindowInsetsSides.Bottom)
    Layout(
        modifier = modifier,
        content = {
            // Content comes first and stays first, so it keeps its state
            // when the window changes and the bar becomes a rail.
            Box(Modifier.consumeWindowInsets(handled)) { content() }
            if (rail) {
                NavigationRail(destinations, selectedIndex, onSelect)
            } else {
                NavigationBar(destinations, selectedIndex, onSelect)
            }
        },
    ) { measurables, constraints ->
        check(constraints.hasBoundedWidth) { "ShkNavigationScaffold needs a bounded width." }
        val content = measurables[0]
        val navigation = measurables[1]
        val width = constraints.maxWidth
        val boundedHeight = constraints.hasBoundedHeight
        if (rail) {
            val railWidth = navigation.maxIntrinsicWidth(Constraints.Infinity).coerceAtMost(width)
            val contentWidth = width - railWidth
            val contentPlaceable = content.measure(
                Constraints(
                    minWidth = contentWidth,
                    maxWidth = contentWidth,
                    minHeight = if (boundedHeight) constraints.maxHeight else constraints.minHeight,
                    maxHeight = constraints.maxHeight,
                ),
            )
            // In a space of any height, as in the Catalog, the scaffold is
            // as tall as the content or the rail's destinations, whichever
            // is taller. The rail scrolls, so it always gets a fixed height.
            val height = if (boundedHeight) {
                contentPlaceable.height
            } else {
                maxOf(contentPlaceable.height, navigation.maxIntrinsicHeight(railWidth))
            }
            val railPlaceable = navigation.measure(Constraints.fixed(railWidth, height))
            layout(width, height) {
                railPlaceable.placeRelative(0, 0)
                contentPlaceable.placeRelative(railWidth, 0)
            }
        } else {
            val barPlaceable = navigation.measure(Constraints(minWidth = width, maxWidth = width, maxHeight = constraints.maxHeight))
            val contentMaxHeight = if (boundedHeight) {
                (constraints.maxHeight - barPlaceable.height).coerceAtLeast(0)
            } else {
                Constraints.Infinity
            }
            val contentPlaceable = content.measure(
                Constraints(
                    minWidth = width,
                    maxWidth = width,
                    minHeight = if (boundedHeight) contentMaxHeight else 0,
                    maxHeight = contentMaxHeight,
                ),
            )
            layout(width, contentPlaceable.height + barPlaceable.height) {
                contentPlaceable.placeRelative(0, 0)
                barPlaceable.placeRelative(0, contentPlaceable.height)
            }
        }
    }
}

/**
 * One top-level place of an app in a [ShkNavigationScaffold]: its label
 * and its icon. Both are always shown.
 */
class ShkDestination(
    /** One short word if possible, such as "History". TalkBack reads it. */
    val label: String,
    /** A vector drawable on the 24dp grid. It is decorative and grows with the font size. */
    val icon: Painter,
)

/**
 * The bar along the bottom of a narrow window: the surface colour, a line
 * in the divider colour along its top, and the destinations side by side,
 * each as wide as the others and as tall as the tallest.
 */
@Composable
private fun NavigationBar(destinations: List<ShkDestination>, selectedIndex: Int, onSelect: (Int) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ShkTheme.colors.surface)
            .lineOnEdge(LineEdge.Top, ShkTheme.colors.divider)
            .windowInsetsPadding(NavigationInsets.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))
            .height(IntrinsicSize.Min)
            .selectableGroup(),
    ) {
        destinations.forEachIndexed { index, destination ->
            NavigationItem(
                destination = destination,
                selected = index == selectedIndex,
                onClick = { onSelect(index) },
                verticalPadding = ShkSpacing.Medium,
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

/**
 * The rail along the start edge of a wide window: the surface colour, a
 * line in the divider colour along its end, and the destinations one
 * under the other from the top. It is [RailWidth] wide at the default
 * font size and grows as its labels do. If the destinations are taller
 * than the window, as at a large font size on a phone held sideways, the
 * rail scrolls.
 */
@Composable
private fun NavigationRail(destinations: List<ShkDestination>, selectedIndex: Int, onSelect: (Int) -> Unit) {
    val growth = with(LocalDensity.current) { LabelSize.toDp() } / LabelSize.value.dp
    Column(
        modifier = Modifier
            .fillMaxHeight()
            .background(ShkTheme.colors.surface)
            .lineOnEdge(LineEdge.End, ShkTheme.colors.divider)
            .windowInsetsPadding(NavigationInsets.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start))
            .width(RailWidth * maxOf(1f, growth))
            .verticalScroll(rememberScrollState())
            .selectableGroup()
            .padding(vertical = ShkSpacing.Medium),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall),
    ) {
        destinations.forEachIndexed { index, destination ->
            NavigationItem(
                destination = destination,
                selected = index == selectedIndex,
                onClick = { onSelect(index) },
                verticalPadding = ShkSpacing.ExtraSmall,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * One destination in the bar or the rail: its icon on a pill, and its
 * label under it. The whole item is one touch target and one TalkBack
 * item, a tab. As in Material 3, only the pill shows that it is pressed.
 */
@Composable
private fun NavigationItem(
    destination: ShkDestination,
    selected: Boolean,
    onClick: () -> Unit,
    verticalPadding: Dp,
    modifier: Modifier,
) {
    val colors = ShkTheme.colors
    val labelColor = if (selected) colors.text else colors.textSecondary
    val interactionSource = remember { MutableInteractionSource() }
    CompositionLocalProvider(LocalContentColor provides labelColor) {
        Column(
            modifier = modifier
                .selectable(
                    selected = selected,
                    onClick = onClick,
                    role = Role.Tab,
                    interactionSource = interactionSource,
                    indication = null,
                )
                .padding(horizontal = ShkSpacing.ExtraSmall, vertical = verticalPadding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .clip(ShkShapes.Pill)
                    .background(if (selected) colors.accent else Color.Transparent)
                    .indication(interactionSource, ripple())
                    .padding(horizontal = ShkSpacing.Large, vertical = ShkSpacing.ExtraSmall),
            ) {
                Icon(
                    painter = destination.icon,
                    contentDescription = null,
                    modifier = Modifier.size(iconSizeNextToText(NavigationIconSize)),
                    tint = if (selected) colors.textOnAccent else colors.textSecondary,
                )
            }
            Spacer(Modifier.height(ShkSpacing.ExtraSmall))
            Text(
                text = destination.label,
                color = labelColor,
                style = ShkTextStyle.Label.textStyle,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The edge of a bar, a rail or a pane that [lineOnEdge] draws on. */
internal enum class LineEdge { Top, End }

/**
 * Draws a 1dp line in [color] along one edge, over the content, so a
 * filled pane cannot hide it. It is how the bar, the rail and the panes of
 * [ShkListDetailScaffold] are set apart from the content beside them: a
 * line that only separates, in the divider colour (ADR 0017, point 13).
 */
internal fun Modifier.lineOnEdge(edge: LineEdge, color: Color): Modifier = drawWithContent {
    drawContent()
    val thickness = EdgeLineThickness.toPx()
    when (edge) {
        LineEdge.Top -> drawRect(color, size = Size(size.width, thickness))
        LineEdge.End -> {
            val x = if (layoutDirection == LayoutDirection.Ltr) size.width - thickness else 0f
            drawRect(color, topLeft = Offset(x, 0f), size = Size(thickness, size.height))
        }
    }
}

/** The system bars and cut-outs the bar and the rail keep clear of, each on its own sides. */
private val NavigationInsets: WindowInsets
    @Composable
    get() = WindowInsets.systemBars.union(WindowInsets.displayCutout)

/** The width of the rail at the default font size, as in Material 3. */
private val RailWidth = 80.dp

/** The size of a destination's icon at the default font size, as in Material 3. */
private val NavigationIconSize = 24.dp

/** The size of a destination's label. The rail grows as text of this size does. */
private val LabelSize = ShkTextStyle.Label.fontSize

/** The thickness of the line along a bar, a rail or a pane, as of a divider. */
private val EdgeLineThickness = 1.dp
