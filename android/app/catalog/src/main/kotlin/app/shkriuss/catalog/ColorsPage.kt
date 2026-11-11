package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkColors
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkShapes
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.contrastRatio
import java.util.Locale

/**
 * The colour tokens of the theme in use, and the contrast of every text
 * colour on every background, as the contrast test checks them.
 */
@Composable
fun ColorsPage(modifier: Modifier = Modifier) {
    val colors = ShkTheme.colors
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_colors_title))
        PageIntro(stringResource(R.string.colors_intro))

        SectionHeading(stringResource(R.string.colors_tokens_heading))
        AdaptiveGrid(items = allTokens(colors), wideColumns = 3) { token, itemModifier ->
            TokenRow(token, itemModifier)
        }

        SectionHeading(stringResource(R.string.colors_pairs_heading))
        ShkText(stringResource(R.string.colors_pairs_intro), color = colors.textSecondary)
        Spacer(Modifier.height(ShkSpacing.Medium))
        AdaptiveGrid(items = backgroundTokens(colors), wideColumns = 3) { background, itemModifier ->
            PairsCard(background, textTokens(colors), colors, itemModifier)
        }

        SectionHeading(stringResource(R.string.colors_accent_heading))
        Box(
            Modifier
                .fillMaxWidth()
                .background(colors.accent, ShkShapes.Card)
                .padding(ShkSpacing.Large),
        ) {
            ContrastLine(R.string.color_text_on_accent, colors.textOnAccent, colors.accent)
        }
    }
}

/** One colour token: its name for people, its name in code, and its value. */
private class ColorToken(
    @param:StringRes val label: Int,
    @param:StringRes val code: Int,
    val color: Color,
)

private fun allTokens(colors: ShkColors): List<ColorToken> =
    backgroundTokens(colors) + textTokens(colors) + listOf(
        ColorToken(R.string.color_outline, R.string.token_outline, colors.outline),
        ColorToken(R.string.color_text_on_accent, R.string.token_text_on_accent, colors.textOnAccent),
    )

/** The colours that text is drawn on. */
private fun backgroundTokens(colors: ShkColors): List<ColorToken> = listOf(
    ColorToken(R.string.color_background, R.string.token_background, colors.background),
    ColorToken(R.string.color_surface, R.string.token_surface, colors.surface),
    ColorToken(R.string.color_surface_high, R.string.token_surface_high, colors.surfaceHigh),
)

/** The colours used for text and icons on any background. */
private fun textTokens(colors: ShkColors): List<ColorToken> = listOf(
    ColorToken(R.string.color_text, R.string.token_text, colors.text),
    ColorToken(R.string.color_text_secondary, R.string.token_text_secondary, colors.textSecondary),
    ColorToken(R.string.color_accent, R.string.token_accent, colors.accent),
    ColorToken(R.string.color_error, R.string.token_error, colors.error),
    ColorToken(R.string.color_success, R.string.token_success, colors.success),
    ColorToken(R.string.color_warning, R.string.token_warning, colors.warning),
)

/** A swatch with the token's name, code name and value. TalkBack reads it as one item. */
@Composable
private fun TokenRow(token: ColorToken, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(40.dp)
                .background(token.color, ShkShapes.Field)
                .border(1.dp, ShkTheme.colors.outline, ShkShapes.Field),
        )
        Spacer(Modifier.width(ShkSpacing.Medium))
        TokenLabel(
            name = stringResource(token.label),
            detail = stringResource(R.string.colors_token_value, stringResource(token.code), hex(token.color)),
        )
    }
}

/** A background with every text colour on it, and the outline, each with its contrast. */
@Composable
private fun PairsCard(
    background: ColorToken,
    texts: List<ColorToken>,
    colors: ShkColors,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .background(background.color, ShkShapes.Card)
            .border(1.dp, colors.outline, ShkShapes.Card)
            .padding(ShkSpacing.Large),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall),
    ) {
        ShkText(stringResource(background.label), style = ShkTextStyle.Subtitle, color = colors.text)
        texts.forEach { text -> ContrastLine(text.label, text.color, background.color) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(width = 40.dp, height = 20.dp)
                    .border(1.dp, colors.outline, ShkShapes.Field),
            )
            Spacer(Modifier.width(ShkSpacing.Small))
            ContrastLine(R.string.color_outline, colors.text, background.color, contrastOf = colors.outline)
        }
    }
}

/**
 * A colour's name and its contrast with [background], drawn in [color].
 * For the outline, the text is drawn in the text colour and [contrastOf]
 * names the colour whose contrast is shown.
 */
@Composable
private fun ContrastLine(
    @StringRes label: Int,
    color: Color,
    background: Color,
    contrastOf: Color = color,
) {
    val name = stringResource(label)
    val ratio = contrastRatio(contrastOf, background)
    val description = stringResource(R.string.colors_contrast_description, name, ratio)
    ShkText(
        text = stringResource(R.string.colors_contrast, name, ratio),
        color = color,
        modifier = Modifier.semantics { contentDescription = description },
    )
}

/** The colour as `#RRGGBB`. */
private fun hex(color: Color): String = String.format(Locale.ROOT, "#%06X", color.toArgb() and 0xFFFFFF)
