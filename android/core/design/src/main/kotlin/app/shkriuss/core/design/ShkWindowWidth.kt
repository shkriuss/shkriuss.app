package app.shkriuss.core.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The three window widths the suite's layouts switch at. They are
 * Android's window size classes for width, so the apps adapt the way the
 * rest of the system does (CLAUDE.md, "UI and accessibility").
 *
 * [ShkNavigationScaffold] and [ShkListDetailScaffold] switch by it. Read
 * the width of the app's window with [current].
 */
enum class ShkWindowWidth {
    /** Narrower than 600dp: a phone held upright. */
    Compact,

    /** From 600dp to just under 840dp: a tablet held upright, an open foldable. */
    Medium,

    /** 840dp and wider: a tablet held sideways, a phone held sideways. */
    Expanded,
    ;

    companion object {
        /**
         * Where [Medium] starts. It is [ShkSpacing.WideWindowWidth], where
         * the wide screen margin starts too.
         */
        val MediumMinWidth: Dp = ShkSpacing.WideWindowWidth

        /** Where [Expanded] starts. */
        val ExpandedMinWidth: Dp = 840.dp

        /** The class of a window this wide. */
        fun of(width: Dp): ShkWindowWidth = when {
            width >= ExpandedMinWidth -> Expanded
            width >= MediumMinWidth -> Medium
            else -> Compact
        }

        /**
         * The class of the window the app is drawn in. It changes when the
         * window does: when the phone turns, a foldable opens, or the
         * window is resized.
         */
        val current: ShkWindowWidth
            @Composable
            @ReadOnlyComposable
            get() {
                val width = LocalWindowInfo.current.containerSize.width
                return of(with(LocalDensity.current) { width.toDp() })
            }
    }
}
