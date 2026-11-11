package app.shkriuss.core.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp

/**
 * The size of an icon that sits next to text, such as the plus in an
 * "Add" button. It exists so the icon keeps its proportion to the text
 * when the user makes text larger (owner decision on pull request 13).
 *
 * At the default font size it is [size]. At a larger font size it grows
 * the way text of that size grows: an 18dp icon grows like 18sp text,
 * along Android's own font size curve. It is never smaller than [size].
 * Icons with no text next to them, as in an icon button, keep [size].
 */
@Composable
internal fun iconSizeNextToText(size: Dp): Dp {
    val grown = with(LocalDensity.current) { size.value.sp.toDp() }
    return maxOf(size, grown)
}
