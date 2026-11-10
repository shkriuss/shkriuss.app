package app.shkriuss.core.design

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

/**
 * Text in the suite's type styles and the current content colour. Apps use
 * it so they never need Material 3 directly.
 *
 * This is a stub from Phase 0 with two of the six styles. Phase 1, step 1
 * adds the others.
 */
@Composable
fun ShkText(
    text: String,
    modifier: Modifier = Modifier,
    style: ShkTextStyle = ShkTextStyle.Body,
) {
    Text(
        text = text,
        modifier = modifier,
        color = LocalContentColor.current,
        style = style.textStyle,
    )
}

/**
 * The type styles available so far. Sizes are the starting values in
 * ADR 0017. The system font is used, so text follows the user's font and
 * font size settings.
 */
enum class ShkTextStyle(internal val textStyle: TextStyle) {
    /** The title at the top of a screen. 24sp on 32sp lines. */
    Headline(TextStyle(fontFamily = FontFamily.Default, fontSize = 24.sp, lineHeight = 32.sp)),

    /** Normal text. 14sp on 20sp lines. */
    Body(TextStyle(fontFamily = FontFamily.Default, fontSize = 14.sp, lineHeight = 20.sp)),
}
