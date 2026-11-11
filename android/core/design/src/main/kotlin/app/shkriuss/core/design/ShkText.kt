package app.shkriuss.core.design

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Text in one of the suite's six type styles. Apps use it so they never
 * need Material 3 directly.
 *
 * The colour is the current content colour unless [color] is given. Use a
 * colour from [ShkTheme.colors] that is meant for text, so the contrast
 * stays checked.
 */
@Composable
fun ShkText(
    text: String,
    modifier: Modifier = Modifier,
    style: ShkTextStyle = ShkTextStyle.Body,
    color: Color = Color.Unspecified,
) {
    Text(
        text = text,
        modifier = modifier,
        color = if (color.isSpecified) color else LocalContentColor.current,
        style = style.textStyle,
    )
}

/**
 * The six type styles of the suite (ADR 0017). There are no others.
 *
 * Every style uses the system font, so text follows the user's font and
 * font size settings and covers every script the system covers. Sizes and
 * line heights are in sp, so they grow with the font scale.
 */
enum class ShkTextStyle(
    /** The size of the text. */
    val fontSize: TextUnit,
    /** The distance from one line to the next. */
    val lineHeight: TextUnit,
    /** Regular, or medium for styles that label or group. */
    val fontWeight: FontWeight,
) {
    /** The title at the top of a screen. 24sp on 32sp lines. */
    Headline(24.sp, 32.sp, FontWeight.Normal),

    /** The title of a dialog, sheet or large section. 20sp on 28sp lines. */
    Title(20.sp, 28.sp, FontWeight.Normal),

    /** The heading of a group, or the main line of a list item. 16sp on 24sp lines, medium. */
    Subtitle(16.sp, 24.sp, FontWeight.Medium),

    /** Normal text. 14sp on 20sp lines. */
    Body(14.sp, 20.sp, FontWeight.Normal),

    /** Text on buttons, chips and tabs. 14sp on 20sp lines, medium. */
    Label(14.sp, 20.sp, FontWeight.Medium),

    /** Small notes, such as a time or a count. 12sp on 16sp lines. */
    Caption(12.sp, 16.sp, FontWeight.Normal),
    ;

    /** The Compose text style for this style. */
    val textStyle: TextStyle = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = fontWeight,
        fontSize = fontSize,
        lineHeight = lineHeight,
        letterSpacing = 0.sp,
        // Puts the extra space of a line evenly above and below the text,
        // as Material 3 does, so short text sits in the middle of its line.
        lineHeightStyle = LineHeightStyle(
            alignment = LineHeightStyle.Alignment.Center,
            trim = LineHeightStyle.Trim.None,
        ),
    )
}
