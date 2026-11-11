package app.shkriuss.catalog

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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.shkriuss.core.design.ShkSpacing
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
 * Items in a row get the same width and height. [spacing] is the gap
 * between items, both ways.
 */
@Composable
fun <T> AdaptiveGrid(
    items: List<T>,
    wideColumns: Int,
    spacing: Dp = ShkSpacing.Small,
    content: @Composable (item: T, modifier: Modifier) -> Unit,
) {
    val columns = if (windowWidthIsWide()) wideColumns else 1
    Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
        items.chunked(columns).forEach { row ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(spacing),
            ) {
                row.forEach { item ->
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        content(item, Modifier.fillMaxWidth().fillMaxHeight())
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
