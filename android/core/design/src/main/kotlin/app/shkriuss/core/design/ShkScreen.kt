package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier

/**
 * The background and margins of a whole screen. Apps use it so they never
 * need Material 3 directly.
 *
 * It keeps content clear of the system bars and uses the screen margin
 * from [ShkSpacing.screenMargin]: 16dp in a narrow window, 24dp from 600dp
 * wide (tablets and phones held sideways).
 *
 * With [scrollable], content taller than the window scrolls, margins and
 * all. Use it for any screen whose content can outgrow the window at font
 * scale 2.0.
 *
 * This is a stub. The adaptive scaffold from Phase 1, step 2 replaces it.
 */
@Composable
fun ShkScreen(
    modifier: Modifier = Modifier,
    scrollable: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = ShkTheme.colors
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background)
            .safeDrawingPadding(),
    ) {
        val margin = ShkSpacing.screenMargin(maxWidth)
        val scroll = if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier
        CompositionLocalProvider(LocalContentColor provides colors.text) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .then(scroll)
                    .padding(margin),
                content = content,
            )
        }
    }
}
