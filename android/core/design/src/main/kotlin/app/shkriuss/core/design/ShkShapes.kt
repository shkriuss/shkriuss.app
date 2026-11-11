package app.shkriuss.core.design

import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The four shapes of the suite (ADR 0017). Every rounded corner in every
 * app is one of these, so the apps look like one family.
 *
 * They are the same in both themes. Components in `core/design` pick their
 * shape from here. Apps use the components and rarely need a shape
 * themselves.
 */
object ShkShapes {
    /** The corner radius of [Field]. */
    val FieldCorner: Dp = 12.dp

    /** The corner radius of [Card]. */
    val CardCorner: Dp = 16.dp

    /** The corner radius of [Sheet]. */
    val SheetCorner: Dp = 28.dp

    /** Fully rounded ends, for buttons and chips. */
    val Pill: CornerBasedShape = RoundedCornerShape(percent = 50)

    /** Text fields and other inputs. 12dp corners. */
    val Field: CornerBasedShape = RoundedCornerShape(FieldCorner)

    /** Cards and other raised surfaces. 16dp corners. */
    val Card: CornerBasedShape = RoundedCornerShape(CardCorner)

    /** Bottom sheets and dialogs. 28dp corners. */
    val Sheet: CornerBasedShape = RoundedCornerShape(SheetCorner)
}
