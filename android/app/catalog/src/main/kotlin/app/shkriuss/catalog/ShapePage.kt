package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkShapes
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme

/**
 * The four shapes, each drawn the way raised surfaces are: a surface
 * colour and an outline, no shadow.
 */
@Composable
fun ShapePage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_shape_title))
        PageIntro(stringResource(R.string.shape_intro))
        Spacer(Modifier.height(ShkSpacing.ExtraLarge))
        // A section's worth of space between samples, so each use line
        // reads as part of the shape above it, not the one below.
        AdaptiveGrid(items = SHAPE_SAMPLES, wideColumns = 2, spacing = ShkSpacing.ExtraLarge) { sample, itemModifier ->
            ShapeSample(sample, itemModifier)
        }
    }
}

/**
 * One shape, with the string resources that name it and say what it is
 * for, and its corner radius. The pill has no fixed radius.
 */
private class ShapeSampleInfo(
    val shape: CornerBasedShape,
    val corner: Dp?,
    @param:StringRes val name: Int,
    @param:StringRes val use: Int,
    val minHeight: Dp,
)

private val SHAPE_SAMPLES = listOf(
    ShapeSampleInfo(ShkShapes.Pill, null, R.string.shape_pill, R.string.shape_pill_use, 48.dp),
    ShapeSampleInfo(ShkShapes.Field, ShkShapes.FieldCorner, R.string.shape_field, R.string.shape_field_use, 56.dp),
    ShapeSampleInfo(ShkShapes.Card, ShkShapes.CardCorner, R.string.shape_card, R.string.shape_card_use, 96.dp),
    ShapeSampleInfo(ShkShapes.Sheet, ShkShapes.SheetCorner, R.string.shape_sheet, R.string.shape_sheet_use, 128.dp),
)

/**
 * The shape filled with the higher surface and outlined, with its name
 * inside and its use below. TalkBack reads it as one item.
 */
@Composable
private fun ShapeSample(sample: ShapeSampleInfo, modifier: Modifier = Modifier) {
    val colors = ShkTheme.colors
    val use = if (sample.corner == null) {
        stringResource(sample.use)
    } else {
        stringResource(sample.use, sample.corner.value.toInt())
    }
    Column(modifier.semantics(mergeDescendants = true) {}) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = sample.minHeight)
                .background(colors.surfaceHigh, sample.shape)
                .border(1.dp, colors.outline, sample.shape)
                .padding(horizontal = ShkSpacing.ExtraLarge, vertical = ShkSpacing.Medium),
            contentAlignment = Alignment.CenterStart,
        ) {
            ShkText(text = stringResource(sample.name), style = ShkTextStyle.Subtitle)
        }
        Spacer(Modifier.height(ShkSpacing.Small))
        ShkText(text = use, color = colors.textSecondary)
    }
}
