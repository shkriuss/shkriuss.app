package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkShapes
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkSwitch
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme

/** The title at the top of a Catalog page. TalkBack announces it as a heading. */
@Composable
fun PageTitle(text: String) {
    ShkText(
        text = text,
        style = ShkTextStyle.Headline,
        modifier = Modifier.semantics { heading() },
    )
}

/** The line under a page's title, in the secondary text colour. */
@Composable
fun PageIntro(text: String) {
    Spacer(Modifier.height(ShkSpacing.Small))
    ShkText(text = text, color = ShkTheme.colors.textSecondary)
}

/**
 * The switch of the two pages of shared screens. It protects the page as
 * an app protects these screens (`secureWindow` of `core/security`), so
 * that the owner can try it on a phone. It starts off, so that screenshots
 * of the page can be sent. The line under it says what it does.
 */
@Composable
fun ProtectionSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    SectionHeading(stringResource(R.string.recovery_key_block_heading))
    ShkSwitch(text = stringResource(R.string.recovery_key_block), checked = checked, onCheckedChange = onCheckedChange)
    ShkText(text = stringResource(R.string.recovery_key_block_help), color = ShkTheme.colors.textSecondary)
}

/** The heading of a section of a page, with the space of a new section above it. */
@Composable
fun SectionHeading(text: String) {
    ShkText(
        text = text,
        style = ShkTextStyle.Subtitle,
        modifier = Modifier
            .padding(top = ShkSpacing.ExtraLarge, bottom = ShkSpacing.Small)
            .semantics { heading() },
    )
}

/**
 * The heading of a component's section on a component page, with the
 * line on when to use it under it.
 */
@Composable
fun ComponentHeading(title: String, use: String) {
    SectionHeading(title)
    ShkText(text = use, color = ShkTheme.colors.textSecondary)
    Spacer(Modifier.height(ShkSpacing.Medium))
}

/** One state of a component: the caption that names it, and the component drawn in it. */
class ComponentState(
    @param:StringRes val caption: Int,
    val content: @Composable () -> Unit,
)

/**
 * The states of one component, each under its caption: one under the
 * other in a narrow window, [wideColumns] to a row in a wide one. Each
 * component keeps its own width, so long labels wrap the way they would in
 * an app. Pass 1 for samples that need the whole width, such as a layout
 * in a frame. Pass [equalHeights] false for samples that hold a list that
 * scrolls sideways, such as the months of a date picker: such a list
 * cannot say how tall it would be before it is laid out.
 */
@Composable
fun ComponentStates(states: List<ComponentState>, wideColumns: Int = 3, equalHeights: Boolean = true) {
    AdaptiveGrid(
        items = states,
        wideColumns = wideColumns,
        spacing = ShkSpacing.Large,
        equalHeights = equalHeights,
    ) { state, itemModifier ->
        Column(itemModifier, verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall)) {
            ShkText(
                text = stringResource(state.caption),
                style = ShkTextStyle.Caption,
                color = ShkTheme.colors.textSecondary,
            )
            state.content()
        }
    }
}

/**
 * A frame that stands for a window or the top of a screen, for the
 * samples of the layout components: the background colour inside an
 * outline with card corners. It is as wide as the space it is given, and
 * [height] tall, or as tall as its content without one.
 */
@Composable
fun WindowFrame(modifier: Modifier = Modifier, height: Dp? = null, content: @Composable () -> Unit) {
    val colors = ShkTheme.colors
    Box(
        modifier = modifier
            .fillMaxWidth()
            .then(if (height != null) Modifier.height(height) else Modifier)
            .clip(ShkShapes.Card)
            .background(colors.background)
            .border(1.dp, colors.outline, ShkShapes.Card),
    ) {
        content()
    }
}

/** A token's name, and under it a detail such as its value, in the caption style. */
@Composable
fun TokenLabel(name: String, detail: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        ShkText(text = name, style = ShkTextStyle.Subtitle)
        ShkText(text = detail, style = ShkTextStyle.Caption, color = ShkTheme.colors.textSecondary)
    }
}

/**
 * Lays out [items] one under the other in a narrow window, and in rows of
 * [wideColumns] in a window at least [ShkSpacing.WideWindowWidth] wide.
 * Items in a row get the same width, and with [equalHeights] the same
 * height. [spacing] is the gap between items, both ways.
 */
@Composable
fun <T> AdaptiveGrid(
    items: List<T>,
    wideColumns: Int,
    spacing: Dp = ShkSpacing.Small,
    equalHeights: Boolean = true,
    content: @Composable (item: T, modifier: Modifier) -> Unit,
) {
    val columns = if (windowWidthIsWide()) wideColumns else 1
    val rowHeight = if (equalHeights) Modifier.height(IntrinsicSize.Min) else Modifier
    val itemHeight = if (equalHeights) Modifier.fillMaxHeight() else Modifier
    Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
        items.chunked(columns).forEach { row ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(rowHeight),
                horizontalArrangement = Arrangement.spacedBy(spacing),
            ) {
                row.forEach { item ->
                    Box(Modifier.weight(1f).then(itemHeight)) {
                        content(item, Modifier.fillMaxWidth().then(itemHeight))
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** True in a window at least [ShkSpacing.WideWindowWidth] wide. */
@Composable
private fun windowWidthIsWide(): Boolean {
    val width = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
    return width >= ShkSpacing.WideWindowWidth
}
