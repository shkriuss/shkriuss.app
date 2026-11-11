package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import app.shkriuss.core.design.ShkTheme

/**
 * The spacing steps, each drawn as a bar of its width, then the screen
 * margins and the smallest touch target. The numbers are read from the
 * tokens, so the page cannot drift from them.
 */
@Composable
fun SpacingPage(modifier: Modifier = Modifier) {
    val colors = ShkTheme.colors
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_spacing_title))
        PageIntro(stringResource(R.string.spacing_intro))

        SectionHeading(stringResource(R.string.spacing_steps_heading))
        SPACING_SAMPLES.forEach { sample ->
            SpacingSample(sample)
            Spacer(Modifier.height(ShkSpacing.Medium))
        }

        SectionHeading(stringResource(R.string.spacing_margins_heading))
        ShkText(
            text = stringResource(
                R.string.spacing_margins_body,
                ShkSpacing.ScreenMargin.value.toInt(),
                ShkSpacing.ScreenMarginWide.value.toInt(),
                ShkSpacing.WideWindowWidth.value.toInt(),
            ),
        )

        SectionHeading(stringResource(R.string.spacing_touch_heading))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(ShkSpacing.MinTouchTarget)
                    .border(1.dp, colors.outline, ShkShapes.Field),
            )
            Spacer(Modifier.width(ShkSpacing.Large))
            ShkText(
                text = stringResource(R.string.spacing_touch_body, ShkSpacing.MinTouchTarget.value.toInt()),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** One spacing step, with the string resources that name it and say what it is for. */
private class SpacingSampleInfo(
    val size: Dp,
    @param:StringRes val name: Int,
    @param:StringRes val use: Int,
)

private val SPACING_SAMPLES = listOf(
    SpacingSampleInfo(ShkSpacing.ExtraSmall, R.string.spacing_extra_small, R.string.spacing_extra_small_use),
    SpacingSampleInfo(ShkSpacing.Small, R.string.spacing_small, R.string.spacing_small_use),
    SpacingSampleInfo(ShkSpacing.Medium, R.string.spacing_medium, R.string.spacing_medium_use),
    SpacingSampleInfo(ShkSpacing.Large, R.string.spacing_large, R.string.spacing_large_use),
    SpacingSampleInfo(ShkSpacing.ExtraLarge, R.string.spacing_extra_large, R.string.spacing_extra_large_use),
)

/** An accent bar as wide as the step, then the step's name, size and use. TalkBack reads it as one item. */
@Composable
private fun SpacingSample(sample: SpacingSampleInfo) {
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The widest step fits, so the labels line up.
        Box(Modifier.width(ShkSpacing.ExtraLarge), contentAlignment = Alignment.CenterStart) {
            Box(
                Modifier
                    .size(width = sample.size, height = ShkSpacing.ExtraLarge)
                    .background(ShkTheme.colors.accent),
            )
        }
        Spacer(Modifier.width(ShkSpacing.Large))
        TokenLabel(
            name = stringResource(R.string.spacing_step, stringResource(sample.name), sample.size.value.toInt()),
            detail = stringResource(sample.use),
            modifier = Modifier.weight(1f),
        )
    }
}
