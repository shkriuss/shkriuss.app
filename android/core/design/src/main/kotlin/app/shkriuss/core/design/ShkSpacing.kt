package app.shkriuss.core.design

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The spacing tokens of the suite (ADR 0017). Density is compact, on a 4dp
 * grid. Every gap and padding is one of these steps, so screens line up.
 *
 * They are the same in both themes and at every font scale. Text grows
 * with the font scale; the space around it does not.
 */
object ShkSpacing {
    /** 4dp. Between an icon and its label, or lines that belong together. */
    val ExtraSmall: Dp = 4.dp

    /** 8dp. Between items in a group. */
    val Small: Dp = 8.dp

    /** 12dp. Inside small controls, and between related groups. */
    val Medium: Dp = 12.dp

    /** 16dp. Inside cards and list items. */
    val Large: Dp = 16.dp

    /** 24dp. Between sections of a screen. */
    val ExtraLarge: Dp = 24.dp

    /** The margin of a screen in a narrow window, such as a phone held upright. */
    val ScreenMargin: Dp = 16.dp

    /** The margin of a screen in a window at least [WideWindowWidth] wide. */
    val ScreenMarginWide: Dp = 24.dp

    /**
     * The window width from which a screen uses [ScreenMarginWide]. It is
     * the start of the medium window size class: tablets, open foldables
     * and phones held sideways.
     */
    val WideWindowWidth: Dp = 600.dp

    /** The smallest width and height of anything that can be touched. */
    val MinTouchTarget: Dp = 48.dp

    /** The screen margin for a window of this width. */
    fun screenMargin(windowWidth: Dp): Dp =
        if (windowWidth >= WideWindowWidth) ScreenMarginWide else ScreenMargin
}
