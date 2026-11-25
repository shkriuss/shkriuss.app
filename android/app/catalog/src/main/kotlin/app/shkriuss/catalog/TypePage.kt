package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme

/**
 * The six text styles, each shown in itself, with its size, line height,
 * weight and use. The sizes are read from the tokens, so the page cannot
 * drift from them. Then the two parts of text: cut at two lines, and a
 * range in bold.
 */
@Composable
fun TypePage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_type_title))
        PageIntro(stringResource(R.string.type_intro))
        Spacer(Modifier.height(ShkSpacing.ExtraLarge))
        TYPE_SAMPLES.forEach { sample ->
            TypeSample(sample)
            Spacer(Modifier.height(ShkSpacing.Large))
        }
        ComponentHeading(stringResource(R.string.type_parts_title), stringResource(R.string.type_parts_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_cut_at_two_lines) {
                    ShkText(text = stringResource(R.string.sample_preview), color = ShkTheme.colors.textSecondary, maxLines = 2)
                },
                // "Pass" in bold, as a search for it shows it.
                ComponentState(R.string.state_bold_range) {
                    ShkText(text = stringResource(R.string.sample_match), bold = listOf(BOLD_SAMPLE))
                },
            ),
        )
    }
}

/** The range of the sample of bold text: "Pass" in "- [ ] Passport". */
private val BOLD_SAMPLE = 6..9

/** One style, with the string resources that name it and say what it is for. */
private class TypeSampleInfo(
    val style: ShkTextStyle,
    @param:StringRes val name: Int,
    @param:StringRes val use: Int,
)

private val TYPE_SAMPLES = listOf(
    TypeSampleInfo(ShkTextStyle.Headline, R.string.type_headline, R.string.type_headline_use),
    TypeSampleInfo(ShkTextStyle.Title, R.string.type_title, R.string.type_title_use),
    TypeSampleInfo(ShkTextStyle.Subtitle, R.string.type_subtitle, R.string.type_subtitle_use),
    TypeSampleInfo(ShkTextStyle.Body, R.string.type_body, R.string.type_body_use),
    TypeSampleInfo(ShkTextStyle.Label, R.string.type_label, R.string.type_label_use),
    TypeSampleInfo(ShkTextStyle.Caption, R.string.type_caption, R.string.type_caption_use),
)

/** The style's name in the style itself, then its use and its numbers. TalkBack reads it as one item. */
@Composable
private fun TypeSample(sample: TypeSampleInfo) {
    val style = sample.style
    val weight = stringResource(
        if (style.fontWeight == FontWeight.Medium) R.string.type_weight_medium else R.string.type_weight_regular,
    )
    Column(Modifier.semantics(mergeDescendants = true) {}) {
        ShkText(text = stringResource(sample.name), style = style)
        ShkText(text = stringResource(sample.use), color = ShkTheme.colors.textSecondary)
        ShkText(
            text = stringResource(
                R.string.type_spec,
                style.fontSize.value.toInt(),
                style.lineHeight.value.toInt(),
                weight,
            ),
            style = ShkTextStyle.Caption,
            color = ShkTheme.colors.textSecondary,
        )
    }
}
