package app.shkriuss.core.design

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter

/**
 * An icon for tests that draws nothing and has no size of its own, so the
 * component sets its size.
 */
internal class BlankIcon : Painter() {
    override val intrinsicSize: Size = Size.Unspecified

    override fun DrawScope.onDraw() = Unit
}
